/**
 * Erreichbarkeits-Spike: Prüft, ob die inoffiziellen Datenquellen aus der aktuellen Umgebung
 * (lokal, GitHub Actions, später Vercel) antworten. Cloud-IPs werden von manchen Anbietern geblockt.
 *
 * Bewusst ohne Retries und ohne Fallback, damit Sperren (403/429) sichtbar werden.
 * Exit-Code 1, wenn eine Pflichtquelle (Yahoo BIST/US, KAP) ausfällt.
 */
import { existsSync } from 'node:fs';
import {
  AdapterError,
  FinnhubAdapter,
  GoogleNewsRssAdapter,
  IsYatirimAdapter,
  KapAdapter,
  YahooAdapter,
  type Instrument,
} from '@aktien/core';

if (existsSync('.env')) process.loadEnvFile('.env');

const THYAO: Instrument = { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' };
const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };
const SAP: Instrument = { symbol: 'SAP', market: 'XETRA', name: 'SAP SE' };
const http = { retries: 0, timeoutMs: 20_000 };

interface Check {
  name: string;
  required: boolean;
  run: () => Promise<string>;
}

const yahoo = new YahooAdapter(http);
const checks: Check[] = [
  { name: 'Yahoo Quote BIST (THYAO.IS)', required: true, run: async () => `${(await yahoo.getQuote(THYAO)).price} TRY` },
  { name: 'Yahoo Quote US (AAPL)', required: true, run: async () => `${(await yahoo.getQuote(AAPL)).price} USD` },
  { name: 'Yahoo Quote XETRA (SAP.DE)', required: false, run: async () => `${(await yahoo.getQuote(SAP)).price} EUR` },
  { name: 'Yahoo Tageskerzen 2J (THYAO.IS)', required: true, run: async () => `${(await yahoo.getDailyHistory(THYAO)).candles.length} Kerzen` },
  {
    name: 'KAP Meldungen (BIST)',
    required: true,
    run: async () => {
      const map = await new KapAdapter(http).getNewsBatch([THYAO, { symbol: 'BIMAS', market: 'BIST' }, { symbol: 'ASELS', market: 'BIST' }]);
      return `${[...map.values()].reduce((n, a) => n + a.length, 0)} Meldungen für 3 Aktien (3 Tage)`;
    },
  },
  { name: 'Google News RSS (tr)', required: false, run: async () => `${(await new GoogleNewsRssAdapter(http).getNews(THYAO)).length} Meldungen` },
  { name: 'İş Yatırım Tagesdaten (Fallback)', required: false, run: async () => `${(await new IsYatirimAdapter(http).getDailyHistory(THYAO)).candles.length} Kerzen` },
];

if (process.env.FINNHUB_API_KEY) {
  const fh = new FinnhubAdapter({ apiKey: process.env.FINNHUB_API_KEY, ...http });
  checks.push({ name: 'Finnhub Quote US (AAPL)', required: false, run: async () => `${(await fh.getQuote(AAPL)).price} USD` });
}

const ctx = process.env.GITHUB_ACTIONS ? 'GitHub Actions' : process.env.VERCEL ? 'Vercel' : 'lokal';
console.log(`Erreichbarkeit aus: ${ctx} (${new Date().toISOString()})\n`);

let requiredFailed = 0;
const rows: string[] = [];
for (const c of checks) {
  const t0 = Date.now();
  let status: string;
  try {
    status = `OK      ${await c.run()}`;
  } catch (e) {
    const code = e instanceof AdapterError ? e.code : 'ERROR';
    status = `FEHLER  ${code}: ${(e as Error).message}`;
    if (c.required) requiredFailed++;
  }
  rows.push(`${c.required ? '*' : ' '} ${c.name.padEnd(36)} ${String(Date.now() - t0).padStart(5)} ms  ${status}`);
  console.log(rows.at(-1));
}

console.log('\n(* = Pflichtquelle)');
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Erreichbarkeit aus ${ctx}\n\n\`\`\`\n${rows.join('\n')}\n\`\`\`\n`);
}
console.log(requiredFailed ? `${requiredFailed} Pflichtquelle(n) nicht erreichbar` : 'Alle Pflichtquellen erreichbar');
process.exit(requiredFailed ? 1 : 0);
