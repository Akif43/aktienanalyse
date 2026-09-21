import { AdapterError } from '../errors';
import { hashString } from '../hash';
import { computeTechnicalSnapshot, type TechnicalSnapshot } from '../indicators/snapshot';
import type { MarketDataAdapter } from '../adapters/market/types';
import type { NewsService } from '../adapters/news/service';
import { instrumentKey, MARKET_CURRENCY, MARKET_TIMEZONE } from '../symbols';
import type { Candle, Instrument } from '../types';
import { buildCandidates } from './candidates';
import { DEMO_PROVIDER_ID } from './demo';
import { computeFxPerformance, type FxPerformance } from './fx';
import type { KeyValueStore } from './kv';
import { buildNewsPayload, NEWS_PROMPT_VERSION, runNewsAnalysis, selectNewsItems, type NewsAnalysis } from './news-analysis';
import { buildTechnicalPayload, runTechnicalAnalysis, TECHNICAL_PROMPT_VERSION, type TechnicalAnalysis } from './technical-analysis';
import type { LLMProvider } from './types';

/** Höchstens eine neue Auswertung je Aktie und Stunde, außer bei manueller Aktualisierung. */
export const MIN_INTERVAL_MS = 60 * 60_000;
/** Auch bei manueller Aktualisierung mindestens so viel Abstand (schützt das Gratis-Kontingent). */
export const FORCE_INTERVAL_MS = 10 * 60_000;
export const DEFAULT_DAILY_LIMIT = 300;

export interface AnalysisMeta {
  provider: string;
  model: string;
  /** Zeitpunkt der Erstellung (Unix-Millisekunden). */
  generatedAt: number;
  cached: boolean;
  /** true, wenn eine neue Auswertung nötig gewesen wäre, aber nicht möglich war (Fehler oder Tageslimit). */
  stale: boolean;
  /** true, wenn eine manuelle Aktualisierung wegen des Mindestabstands abgelehnt wurde. */
  refreshBlocked: boolean;
  note?: string;
  attempts: number;
  guardRemoved: number;
  /** true bei Platzhaltertexten des Demo-Anbieters (keine echte KI). */
  demo: boolean;
}

export interface Envelope<T> {
  analysis: T;
  meta: AnalysisMeta;
}

interface Stored<T> {
  promptVersion: number;
  createdAt: number;
  inputHash: string;
  provider: string;
  model: string;
  attempts: number;
  guardRemoved: number;
  analysis: T;
}

export interface AnalysisDeps {
  llm: LLMProvider | null;
  kv: KeyValueStore;
  market: MarketDataAdapter;
  news: NewsService;
  now?: () => number;
  dailyLimit?: number;
}

export interface AnalysisOptions {
  /** Manuelle Aktualisierung (mit Mindestabstand). */
  force?: boolean;
  /** Firmenname für die News-Suche. */
  name?: string;
}

const NOT_CONFIGURED = 'Die KI-Auswertung ist nicht eingerichtet: Es fehlt ein API-Key (GEMINI_API_KEY oder GROQ_API_KEY).';

export class AnalysisService {
  private readonly now: () => number;
  private readonly dailyLimit: number;

  constructor(private readonly deps: AnalysisDeps) {
    this.now = deps.now ?? Date.now;
    this.dailyLimit = deps.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  }

  get configured(): boolean {
    return this.deps.llm !== null;
  }

  // --- Technische Auswertung -----------------------------------------------------------------

  async technical(instrument: Instrument, opts: AnalysisOptions = {}): Promise<Envelope<TechnicalAnalysis>> {
    return this.cached<TechnicalAnalysis>({
      key: `analysis:technical:${instrumentKey(instrument)}`,
      promptVersion: TECHNICAL_PROMPT_VERSION,
      force: opts.force ?? false,
      prepare: async (llm) => {
        const [history, quote, fx] = await Promise.all([
          this.deps.market.getDailyHistory(instrument),
          this.deps.market.getQuote(instrument).catch(() => null),
          this.fxSeries(instrument),
        ]);
        const dataWarnings: string[] = [];
        if (history.droppedBars > 0) dataWarnings.push(`Die Datenquelle lieferte ${history.droppedBars} unvollständige Kerzen, sie wurden übersprungen.`);
        if (history.approximate) dataWarnings.push('Tagesdaten der Ausweichquelle: Eröffnungskurs und Volumen sind angenähert.');
        if (instrument.market === 'BIST' && fx.length === 0) dataWarnings.push('Wechselkursdaten (USD/EUR) waren nicht verfügbar.');

        const snapshot = computeTechnicalSnapshot(history.candles);
        const candidates = buildCandidates(snapshot);
        const tz = MARKET_TIMEZONE[instrument.market];
        const fxPerformance = fx.map((f) => computeFxPerformance(history.candles, f.candles, f.currency, tz)).filter((p) => p.periods.length > 0);
        const payload = buildTechnicalPayload({
          instrument: { ...instrument, currency: quote?.currency ?? MARKET_CURRENCY[instrument.market] },
          quote: quote ? { price: quote.price, changePercent: quote.changePercent, dayHigh: quote.dayHigh, dayLow: quote.dayLow, freshness: quote.freshness } : null,
          snapshot,
          candidates,
          fxPerformance,
          dataWarnings,
        });
        return {
          inputHash: technicalInputHash(snapshot),
          run: async () => {
            const r = await runTechnicalAnalysis({ llm, payload, candidates });
            return { analysis: r.analysis, provider: r.provider, model: r.model, attempts: r.attempts, guardRemoved: r.guardRemoved };
          },
        };
      },
    });
  }

  // --- News-Auswertung -------------------------------------------------------------------------

  async news(instrument: Instrument, opts: AnalysisOptions = {}): Promise<Envelope<NewsAnalysis>> {
    const inst: Instrument = { ...instrument, name: opts.name ?? instrument.name };
    return this.cached<NewsAnalysis>({
      key: `analysis:news:${instrumentKey(inst)}`,
      promptVersion: NEWS_PROMPT_VERSION,
      force: opts.force ?? false,
      prepare: async (llm) => {
        const { items } = await this.deps.news.getNews(inst);
        const selected = selectNewsItems(items);
        const { payload, idMap } = buildNewsPayload(inst, selected, new Date(this.now()));
        return {
          inputHash: hashString(`${NEWS_PROMPT_VERSION}|${selected.map((n) => n.id).sort().join(',')}`),
          // Ohne Meldungen gibt es nichts einzuordnen: keine KI-Anfrage, kein Kontingentverbrauch
          skipLlm: selected.length === 0 ? ({ byId: {}, overall: { summary: 'Keine aktuellen Meldungen vorhanden.', argumentsFor: [], argumentsAgainst: [] }, notes: [] } satisfies NewsAnalysis) : undefined,
          run: async () => {
            const r = await runNewsAnalysis({ llm, payload, idMap });
            return { analysis: r.analysis, provider: r.provider, model: r.model, attempts: r.attempts, guardRemoved: r.guardRemoved };
          },
        };
      },
    });
  }

  // --- Gemeinsame Ablauflogik ----------------------------------------------------------------

  private async cached<T>(o: {
    key: string;
    promptVersion: number;
    force: boolean;
    prepare: (llm: LLMProvider) => Promise<{
      inputHash: string;
      skipLlm?: T;
      run: () => Promise<{ analysis: T; provider: string; model: string; attempts: number; guardRemoved: number }>;
    }>;
  }): Promise<Envelope<T>> {
    const llm = this.deps.llm;
    if (!llm) throw new AdapterError('CONFIG', NOT_CONFIGURED, 'analysis');

    const now = this.now();
    const stored = await this.deps.kv.get<Stored<T>>(o.key);
    const entry = stored && stored.value.promptVersion === o.promptVersion ? stored.value : null;
    const age = entry ? now - entry.createdAt : Infinity;

    // 1. Frische Auswertung vorhanden: ohne jeden Datenabruf zurückgeben
    if (entry && !o.force && age < MIN_INTERVAL_MS) return this.envelope(entry, { cached: true });
    if (entry && o.force && age < FORCE_INTERVAL_MS) {
      const wait = Math.ceil((FORCE_INTERVAL_MS - age) / 60_000);
      return this.envelope(entry, { cached: true, refreshBlocked: true, note: `Neue Auswertung frühestens in ${wait} Min. möglich.` });
    }

    // 2. Daten holen. Bei unveränderten Eingaben bleibt die alte Auswertung gültig.
    let prepared: Awaited<ReturnType<typeof o.prepare>>;
    try {
      prepared = await o.prepare(llm);
    } catch (err) {
      if (entry) return this.envelope(entry, { cached: true, stale: true, note: `Daten konnten nicht aktualisiert werden: ${(err as Error).message}` });
      throw err;
    }
    if (entry && !o.force && entry.inputHash === prepared.inputHash) return this.envelope(entry, { cached: true });

    if (prepared.skipLlm !== undefined) {
      const fresh: Stored<T> = { promptVersion: o.promptVersion, createdAt: now, inputHash: prepared.inputHash, provider: 'none', model: '-', attempts: 0, guardRemoved: 0, analysis: prepared.skipLlm };
      await this.deps.kv.set(o.key, fresh);
      return this.envelope(fresh, { cached: false });
    }

    // 3. Neue KI-Auswertung, sofern das Tageslimit es zulässt
    const budgetKey = `budget:${new Date(now).toISOString().slice(0, 10)}`;
    const used = (await this.deps.kv.get<{ count: number }>(budgetKey).catch(() => null))?.value.count ?? 0;
    if (used >= this.dailyLimit) {
      const note = `Tageslimit für KI-Abfragen erreicht (${this.dailyLimit}).`;
      if (entry) return this.envelope(entry, { cached: true, stale: true, note });
      throw new AdapterError('RATE_LIMITED', note, 'analysis');
    }

    try {
      const r = await prepared.run();
      await this.deps.kv.set(budgetKey, { count: used + Math.max(1, r.attempts) }).catch(() => undefined);
      const fresh: Stored<T> = { promptVersion: o.promptVersion, createdAt: now, inputHash: prepared.inputHash, provider: r.provider, model: r.model, attempts: r.attempts, guardRemoved: r.guardRemoved, analysis: r.analysis };
      await this.deps.kv.set(o.key, fresh).catch(() => undefined);
      return this.envelope(fresh, { cached: false });
    } catch (err) {
      if (entry) return this.envelope(entry, { cached: true, stale: true, note: `Neue Auswertung fehlgeschlagen: ${(err as Error).message}` });
      throw err;
    }
  }

  private envelope<T>(s: Stored<T>, extra: { cached: boolean; stale?: boolean; refreshBlocked?: boolean; note?: string }): Envelope<T> {
    return {
      analysis: s.analysis,
      meta: {
        provider: s.provider,
        model: s.model,
        generatedAt: s.createdAt,
        cached: extra.cached,
        stale: extra.stale ?? false,
        refreshBlocked: extra.refreshBlocked ?? false,
        note: extra.note,
        attempts: s.attempts,
        guardRemoved: s.guardRemoved,
        demo: s.provider === DEMO_PROVIDER_ID,
      },
    };
  }

  /** Wechselkursreihen für BIST-Aktien: TRY je USD und je EUR. Fehler führen nur zum Weglassen. */
  private async fxSeries(instrument: Instrument): Promise<{ currency: string; candles: Candle[] }[]> {
    if (instrument.market !== 'BIST') return [];
    const pairs = [
      { currency: 'USD', symbol: 'USDTRY=X' },
      { currency: 'EUR', symbol: 'EURTRY=X' },
    ];
    const results = await Promise.all(
      pairs.map(async (p) => {
        try {
          const s = await this.deps.market.getDailyHistory({ symbol: p.symbol, market: 'US' });
          return { currency: p.currency, candles: s.candles };
        } catch {
          return null;
        }
      }),
    );
    return results.filter((r): r is { currency: string; candles: Candle[] } => r !== null && r.candles.length > 0);
  }
}

/**
 * Fingerabdruck der Eingabedaten: ändert sich bei einer neuen Tageskerze, einer Kursbewegung von etwa
 * einer halben ATR oder einem Wechsel bei Trend oder Signalen. Kleine Kursschwankungen erzeugen
 * keine neue (kostenpflichtige) Auswertung.
 */
export function technicalInputHash(s: TechnicalSnapshot): string {
  const step = (s.atr14.value ?? s.price * 0.02) * 0.5;
  const parts = {
    v: TECHNICAL_PROMPT_VERSION,
    day: new Date(s.asOf * 1000).toISOString().slice(0, 10),
    bucket: Math.round(s.price / step),
    trend: s.trend.state,
    macd: s.macd.state.position,
    rsi: s.rsi14.zone,
    cross: s.crossSma50Sma200.regime,
    // Bewusst ohne Zonen: Sie entstehen aus bestätigten Swing-Punkten und ändern sich nur mit einer neuen Tageskerze (`day`).
    // Als Liste würden sie bloß beim Kreuzen einer Zone kippen, weil pro Seite nur die 3 nächsten gezeigt werden.
  };
  return hashString(JSON.stringify(parts));
}
