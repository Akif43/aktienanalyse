import type { KeyValueStore } from '../../ai/kv';
import { AdapterError } from '../../errors';
import type { HttpOptions } from '../../http';
import type { Instrument } from '../../types';
import { IS_YATIRIM_MAX_BLOCKS, IsYatirimFundamentals } from './isyatirim-fundamentals';
import { SecFundamentals } from './sec-fundamentals';
import type { Fundamentals, FundamentalsWarning, FundamentalsYear } from './types';
import { YahooFundamentals, type YahooStatementYear } from './yahoo-fundamentals';

/** Verhältnis İş-TL-Gewinn zu Yahoo-Gewinn: ab hier berichtet das Unternehmen in USD (z. B. THY), nicht in TL. */
const USD_REPORTER_RATIO = 3;
/** Ab so vielen gespeicherten Jahren genügt bei İş Yatırım der jüngste Block (4 Jahre), die älteren kommen aus dem Speicher. */
const MIN_STORED_YEARS = 8;
/** EDGAR-Reihen werden höchstens so oft neu geholt (Jahresberichte erscheinen nur einmal im Jahr). */
const EDGAR_REFRESH_MS = 3 * 86_400_000;

export interface FundamentalsServiceOptions extends HttpOptions {
  now?: () => Date;
  /** Dauerhafter Speicher (Supabase) für die einmal geladene Gewinnhistorie. Ohne ihn wird jedes Mal neu geladen. */
  kv?: KeyValueStore;
  /** Kontaktadresse für den User-Agent der SEC. Ohne sie wird EDGAR übersprungen (es bleiben Yahoos 4 Jahre). */
  secContact?: string;
}

/** Gewinnreihe einer Quelle, wie sie im Speicher liegt (ohne Wechselkurse, die kommen bei jedem Abruf frisch dazu). */
interface StoredYear {
  year: number;
  netIncome: number;
  ebit: number | null;
}

interface StoredHistory {
  source: 'isyatirim' | 'edgar';
  years: StoredYear[];
  /** Zeitpunkt des letzten vollständigen Abrufs (Unix-Millisekunden). */
  fetchedAt: number;
}

/**
 * Holt die Bilanzdaten für die Graham-Bewertung. BIST: İş Yatırım (bis zu 12 Jahre, TL) als Hauptquelle, Yahoo nur
 * zur Erkennung von USD-Berichtern, für Dividenden und den USD/TRY-Jahresschnitt, notfalls als Ersatzreihe.
 * US und SEC-Melder an der XETRA (z. B. SAP): SEC EDGAR (bis zu 12 Jahre), sonst Yahoo (4 Jahre). Aktienzahl,
 * Nettoverschuldung und Eigenkapital kommen immer als Einzelwerte von Yahoo bzw. İş Yatırım. Eine Gewinnreihe stammt nie
 * aus gemischten Quellen, weil die Quellen im letzten Jahr um ca. 18 % auseinanderliegen (unterschiedliche
 * Inflationsbasis). Einmal geladene Jahre bleiben im dauerhaften Speicher, danach wird nur noch das Neueste geholt.
 */
export class FundamentalsService {
  private readonly yahoo: YahooFundamentals;
  private readonly isYatirim: IsYatirimFundamentals;
  private readonly sec: SecFundamentals | null;
  private readonly kv: KeyValueStore | null;
  private readonly now: () => Date;

  constructor(opts: FundamentalsServiceOptions = {}) {
    const { now, kv, secContact, ...http } = opts;
    this.yahoo = new YahooFundamentals(http);
    this.isYatirim = new IsYatirimFundamentals(http);
    this.sec = secContact?.trim() ? new SecFundamentals(secContact, http) : null;
    this.kv = kv ?? null;
    this.now = now ?? (() => new Date());
  }

  async get(instrument: Instrument): Promise<Fundamentals> {
    return instrument.market === 'BIST' ? this.getBist(instrument) : this.getOther(instrument);
  }

  private async getBist(instrument: Instrument): Promise<Fundamentals> {
    const year = this.now().getFullYear();
    // Sind ältere Jahre schon gespeichert und schließen an das aktuelle Fenster an, genügt der jüngste Block.
    const stored = await this.readHistory(instrument, 'isyatirim');
    const recentOnly = stored !== null && stored.years.length >= MIN_STORED_YEARS && newestYear(stored.years) >= year - 1 - 3;
    const [isR, yhR, divR, fxR] = await Promise.allSettled([
      this.isYatirim.getStatements(instrument.symbol, year - 1, recentOnly ? 1 : IS_YATIRIM_MAX_BLOCKS),
      this.yahoo.getStatements(instrument),
      this.yahoo.getDividends(instrument, year),
      this.yahoo.getUsdTry(),
    ]);

    const warnings: FundamentalsWarning[] = [];
    const avgFx = fxR.status === 'fulfilled' ? fxR.value.avgByYear : {};
    const currentFx = fxR.status === 'fulfilled' ? fxR.value.current : null;
    if (fxR.status === 'rejected' || currentFx === null) warnings.push({ code: 'missingFx' });
    const dividends = divR.status === 'fulfilled' ? divR.value.dividends : [];
    const dividendCoverageFromYear = divR.status === 'fulfilled' ? divR.value.coverageFromYear : null;
    const withFx = (y: Omit<FundamentalsYear, 'avgFx'>): FundamentalsYear => ({ ...y, avgFx: avgFx[y.year] ?? null });
    const base = { market: instrument.market, dividends, dividendCoverageFromYear, currentFx, avgUsdTry: avgFx };

    if (isR.status === 'fulfilled') {
      const is = isR.value;
      // Frisch geholte Jahre gewinnen, ältere gespeicherte bleiben erhalten.
      const merged = mergeYears(stored?.years ?? [], is.years.map((y) => ({ year: y.year, netIncome: y.netIncome, ebit: y.operatingProfit })));
      await this.writeHistory(instrument, stored, merged);
      const yahooYears = yhR.status === 'fulfilled' ? yhR.value : [];
      if (isUsdReporter(merged, yahooYears)) {
        warnings.push({ code: 'usdReporter' });
        const years = yahooYears.filter((y) => y.netIncome !== null).map((y) => withFx({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome }));
        return { ...base, source: 'yahoo', reportingCurrency: 'USD', years, shares: is.shares, netDebt: is.netDebt, equity: is.equity, warnings };
      }
      const years = merged.map((y) => withFx(y));
      return { ...base, source: 'isyatirim', reportingCurrency: 'TRY', years, shares: is.shares, netDebt: is.netDebt, equity: is.equity, warnings };
    }

    if (yhR.status === 'fulfilled' && yhR.value.some((y) => y.netIncome !== null)) {
      warnings.push({ code: 'sourceFallback', reason: describe(isR.reason) });
      const latest = latestBalance(yhR.value);
      const years = yhR.value.filter((y) => y.netIncome !== null).map((y) => withFx({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome }));
      return { ...base, source: 'yahoo', reportingCurrency: 'TRY', years, shares: latest.shares, netDebt: latest.netDebt, equity: latest.equity, warnings };
    }
    throw isR.reason;
  }

  private async getOther(instrument: Instrument): Promise<Fundamentals> {
    const year = this.now().getFullYear();
    const warnings: FundamentalsWarning[] = [];
    const [stR, divR, edgarR] = await Promise.allSettled([
      this.yahoo.getStatements(instrument),
      this.yahoo.getDividends(instrument, year),
      this.sec ? this.edgarSeries(instrument) : Promise.reject(new AdapterError('CONFIG', 'SEC_CONTACT fehlt', 'sec-edgar')),
    ]);

    if (!this.sec) {
      if (instrument.market === 'US') warnings.push({ code: 'secNotConfigured' });
    } else if (edgarR.status === 'rejected' && !(edgarR.reason instanceof AdapterError && edgarR.reason.code === 'NOT_FOUND')) {
      // "Nicht gefunden" ist bei XETRA der Normalfall (kein SEC-Melder) und keinen Hinweis wert.
      warnings.push({ code: 'edgarFallback', reason: describe(edgarR.reason) });
    }

    const edgarYears = edgarR.status === 'fulfilled' ? edgarR.value : null;
    if (stR.status === 'rejected' && !edgarYears) throw stR.reason;

    const yahooRows = stR.status === 'fulfilled' ? stR.value : [];
    const seriesYears: StoredYear[] = edgarYears ?? yahooRows.filter((y) => y.netIncome !== null).map((y) => ({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome }));
    const latest = latestBalance(yahooRows);
    if (seriesYears.length === 0) warnings.push({ code: 'noStatements' });
    return {
      market: instrument.market,
      source: edgarYears ? 'edgar' : 'yahoo',
      reportingCurrency: 'USD',
      years: seriesYears.map((y) => ({ ...y, avgFx: null })),
      shares: latest.shares,
      netDebt: latest.netDebt,
      equity: latest.equity,
      dividends: divR.status === 'fulfilled' ? divR.value.dividends : [],
      dividendCoverageFromYear: divR.status === 'fulfilled' ? divR.value.coverageFromYear : null,
      currentFx: null,
      avgUsdTry: {},
      warnings,
    };
  }

  /** EDGAR-Reihe aus dem Speicher (höchstens 3 Tage alt) oder frisch von der SEC. Ist die SEC gerade nicht erreichbar, hilft eine ältere gespeicherte Reihe. */
  private async edgarSeries(instrument: Instrument): Promise<StoredYear[]> {
    const sec = this.sec as SecFundamentals;
    const now = this.now().getTime();
    const minYear = this.now().getFullYear() - 2;
    const stored = await this.readHistory(instrument, 'edgar');
    const usable = stored !== null && newestYear(stored.years) >= minYear;
    if (usable && now - stored.fetchedAt < EDGAR_REFRESH_MS) return stored.years;
    try {
      const cikKey = `fundamentals:cik:v1:${instrument.market}:${instrument.symbol}`;
      const cachedCik = await this.safeGet<number>(cikKey);
      const series = await sec.getSeries(instrument, { cachedCik, minYear });
      if (series.years.length === 0 || newestYear(series.years) < minYear) throw new AdapterError('UPSTREAM', 'EDGAR-Daten sind veraltet', 'sec-edgar');
      if (series.cik !== cachedCik) await this.safeSet(cikKey, series.cik);
      await this.safeSet<StoredHistory>(historyKey(instrument), { source: 'edgar', years: series.years, fetchedAt: now });
      return series.years;
    } catch (err) {
      if (usable) return stored.years;
      throw err;
    }
  }

  private async readHistory(instrument: Instrument, source: StoredHistory['source']): Promise<StoredHistory | null> {
    const value = await this.safeGet<StoredHistory>(historyKey(instrument));
    if (!value || value.source !== source || !Array.isArray(value.years)) return null;
    const years = value.years.filter((y) => Number.isFinite(y?.year) && Number.isFinite(y?.netIncome));
    return { source, years, fetchedAt: Number(value.fetchedAt) || 0 };
  }

  /** Schreibt die İş-Reihe nur, wenn sie sich gegenüber dem Gespeicherten geändert hat. */
  private async writeHistory(instrument: Instrument, stored: StoredHistory | null, years: StoredYear[]): Promise<void> {
    if (stored && JSON.stringify(stored.years) === JSON.stringify(years)) return;
    await this.safeSet<StoredHistory>(historyKey(instrument), { source: 'isyatirim', years, fetchedAt: this.now().getTime() });
  }

  // Der Speicher ist eine Beschleunigung: Ausfälle dürfen die Bewertung nie verhindern.
  private async safeGet<T>(key: string): Promise<T | null> {
    if (!this.kv) return null;
    try {
      return (await this.kv.get<T>(key))?.value ?? null;
    } catch {
      return null;
    }
  }

  private async safeSet<T>(key: string, value: T): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.set(key, value);
    } catch {
      /* siehe oben */
    }
  }
}

const historyKey = (instrument: Instrument) => `fundamentals:history:v1:${instrument.market}:${instrument.symbol}`;
const newestYear = (years: readonly { year: number }[]) => years.reduce((m, y) => Math.max(m, y.year), -Infinity);

/** Vereinigt zwei Reihen je Jahr; bei Überschneidung gewinnt `fresh`. */
function mergeYears(stored: readonly StoredYear[], fresh: readonly StoredYear[]): StoredYear[] {
  const byYear = new Map<number, StoredYear>();
  for (const y of stored) byYear.set(y.year, y);
  for (const y of fresh) byYear.set(y.year, y);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** Mittleres Verhältnis TL-Gewinn (İş) zu Yahoo-Gewinn über die gemeinsamen Jahre: bei USD-Berichtern liegt es beim Wechselkurs, bei TL-Berichtern um 1. */
function isUsdReporter(isYears: readonly { year: number; netIncome: number }[], yahoo: readonly YahooStatementYear[]): boolean {
  const ratios: number[] = [];
  for (const y of isYears) {
    const other = yahoo.find((o) => o.year === y.year)?.netIncome;
    if (other && other > 0 && y.netIncome > 0) ratios.push(y.netIncome / other);
  }
  if (ratios.length === 0) return false;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)] as number;
  return median > USD_REPORTER_RATIO;
}

function latestBalance(rows: readonly YahooStatementYear[]): { shares: number | null; netDebt: number | null; equity: number | null } {
  const sorted = [...rows].sort((a, b) => b.year - a.year);
  const debtRow = sorted.find((r) => r.totalDebt !== null && r.cash !== null);
  return {
    shares: sorted.find((r) => r.shares !== null)?.shares ?? null,
    netDebt: debtRow ? (debtRow.totalDebt as number) - (debtRow.cash as number) : null,
    equity: sorted.find((r) => r.equity !== null)?.equity ?? null,
  };
}

function describe(reason: unknown): string {
  return reason instanceof AdapterError ? `${reason.adapter}: ${reason.message}` : String((reason as Error)?.message ?? reason);
}
