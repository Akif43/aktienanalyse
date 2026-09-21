/**
 * Live-Smoke-Test gegen die echten Datenquellen. Zeigt Kurs, Aktualität, technische Kennzahlen und News.
 *
 *   npm run smoke                      # Standard: THYAO, ASELS, BIMAS, AAPL, SAP.DE
 *   npm run smoke -- THYAO.IS TSLA     # eigene Ticker (Suffix .IS = BIST, .DE = XETRA, sonst US)
 */
import { existsSync } from 'node:fs';
import {
  AdapterError,
  computeTechnicalSnapshot,
  createMarketData,
  createNewsService,
  freshnessLabel,
  parseInstrument,
  type Instrument,
} from '@aktien/core';

if (existsSync('.env')) process.loadEnvFile('.env');

const NAMES: Record<string, string> = {
  THYAO: 'Türk Hava Yolları',
  ASELS: 'Aselsan',
  BIMAS: 'BİM Birleşik Mağazalar',
  AAPL: 'Apple',
  SAP: 'SAP SE',
};

const args = process.argv.slice(2);
const inputs = args.length ? args : ['THYAO.IS', 'ASELS.IS', 'BIMAS.IS', 'AAPL', 'SAP.DE'];
const finnhubApiKey = process.env.FINNHUB_API_KEY || undefined;

const market = createMarketData({
  finnhubApiKey,
  onFallback: (e) => console.log(`   ↪ Fallback: ${e.adapter} ${e.operation} → ${e.error.code}: ${e.error.message}`),
});
const news = createNewsService({ finnhubApiKey });

const fmtTime = (unix: number, tz: string) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium', timeZone: tz }).format(unix * 1000);
const TZ = { BIST: 'Europe/Istanbul', XETRA: 'Europe/Berlin', US: 'America/New_York' } as const;

let failures = 0;

async function run(instrument: Instrument) {
  const label = `${instrument.symbol} (${instrument.market})`;
  console.log(`\n━━ ${label} ━━`);
  const name = NAMES[instrument.symbol];
  const inst = name ? { ...instrument, name } : instrument;

  try {
    const q = await market.getQuote(inst);
    const nowS = Date.now() / 1000;
    const open = q.session && nowS >= q.session.start && nowS <= q.session.end;
    const lag = open ? ` | gemessene Verzögerung ${((nowS - q.asOf) / 60).toFixed(1)} Min.` : ' | Börse geschlossen';
    console.log(
      `Kurs ${q.price} ${q.currency} (${q.changePercent === null ? 'n/a' : (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) + ' %'}), ` +
        `Tag ${q.dayLow ?? '?'}–${q.dayHigh ?? '?'}, Stand ${fmtTime(q.asOf, TZ[q.market])}`,
    );
    console.log(`Aktualität: ${freshnessLabel(q.freshness)} [Quelle ${q.source}]${lag}`);
  } catch (e) {
    failures++;
    console.log(`✗ Kurs: ${describe(e)}`);
  }

  try {
    const hist = await market.getDailyHistory(inst);
    console.log(`Historie: ${hist.candles.length} Tageskerzen von ${hist.source}, ${hist.droppedBars} verworfen${hist.approximate ? ' (angenähert)' : ''}`);
    const s = computeTechnicalSnapshot(hist.candles, {
      extraWarnings: hist.droppedBars ? [`${hist.droppedBars} unvollständige Kerzen der Quelle wurden verworfen.`] : [],
    });
    const z = (zs: typeof s.levels.supports) => zs.map((x) => `${x.id} ${x.low}–${x.high} (${x.touches}×)`).join(', ') || '–';
    console.log(
      `Trend ${s.trend.state} (${s.trend.highs.join('/')} ${s.trend.lows.join('/')}) | RSI ${s.rsi14.value} ${s.rsi14.zone} | ` +
        `MACD ${s.macd.state.position} | ${s.crossSma50Sma200.regime}-Regime`,
    );
    console.log(
      `SMA20 ${s.sma['20'].value} SMA50 ${s.sma['50'].value} SMA200 ${s.sma['200'].value} | ATR ${s.atr14.value} (${s.atr14.percentOfPrice} %) | ` +
        `52W: ${s.range52w?.percentBelowHigh} % unter Hoch, ${s.range52w?.percentAboveLow} % über Tief`,
    );
    console.log(`Unterstützung: ${z(s.levels.supports)}`);
    console.log(`Widerstand:    ${z(s.levels.resistances)}`);
    for (const w of s.warnings) console.log(`⚠ ${w}`);
  } catch (e) {
    failures++;
    console.log(`✗ Historie/Analyse: ${describe(e)}`);
  }

  try {
    const { items, errors } = await news.getNews(inst, { limit: 50 });
    const kap = items.filter((i) => i.kind === 'kap').length;
    console.log(`News: ${items.length} Meldungen (${kap} KAP)${errors.length ? ` | Quellenfehler: ${errors.map((x) => `${x.adapter}=${x.code}`).join(', ')}` : ''}`);
    for (const n of items.slice(0, 3)) {
      console.log(`  • [${n.kind === 'kap' ? 'KAP' : n.source}] ${new Date(n.publishedAt).toISOString().slice(0, 16)}Z ${n.title.slice(0, 110)}`);
    }
  } catch (e) {
    failures++;
    console.log(`✗ News: ${describe(e)}`);
  }
}

function describe(e: unknown): string {
  return e instanceof AdapterError ? `${e.code} – ${e.message}` : String((e as Error)?.message ?? e);
}

for (const input of inputs) await run(parseInstrument(input));
console.log(failures ? `\n${failures} Abruf(e) fehlgeschlagen` : '\nAlle Abrufe erfolgreich');
process.exit(failures ? 1 : 0);
