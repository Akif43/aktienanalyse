/**
 * Echter Testlauf der KI-Auswertung im Terminal (holt Live-Daten und ruft die KI auf).
 *
 *   npm run analyze -- THYAO.IS            # technische Auswertung
 *   npm run analyze -- THYAO.IS --news     # zusätzlich die News-Einordnung
 *
 * Braucht GEMINI_API_KEY und/oder GROQ_API_KEY in der .env (oder AI_PROVIDER=demo für Platzhaltertexte).
 * Jeder Lauf ist eine echte KI-Anfrage und verbraucht Gratis-Kontingent.
 */
import { existsSync } from 'node:fs';
import { AdapterError, parseInstrument, type Candidate, type TechnicalAnalysis } from '@aktien/core';
import { createDeps } from '@aktien/server';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const ticker = args.find((a) => !a.startsWith('--')) ?? 'THYAO.IS';
const withNews = args.includes('--news');
const NAMES: Record<string, string> = { THYAO: 'Türk Hava Yolları', ASELS: 'Aselsan', BIMAS: 'BİM Birleşik Mağazalar', AAPL: 'Apple', SAP: 'SAP SE' };

const deps = createDeps(process.env);
if (!deps.analysis?.configured) {
  console.error('Kein KI-Anbieter konfiguriert: GEMINI_API_KEY oder GROQ_API_KEY in die .env eintragen (oder AI_PROVIDER=demo).');
  process.exit(2);
}
const inst = parseInstrument(ticker);
const named = { ...inst, name: NAMES[inst.symbol] };
console.log(`KI-Anbieter: ${deps.aiInfo!.providers.join(' → ')} | Aktie: ${ticker}\n`);

const range = (c: Candidate | null) => (c ? `${c.low === c.high ? c.low : `${c.low} – ${c.high}`} (${c.label}, ${c.distancePercent} % zum Kurs)` : '–');
const list = (title: string, items: string[]) => {
  console.log(`${title}:`);
  for (const i of items) console.log(`  • ${i}`);
};
const meta = (m: { provider: string; model: string; attempts: number; guardRemoved: number; note?: string }) =>
  console.log(`\n[${m.provider} · ${m.model} · ${m.attempts} Anfrage(n) · ${m.guardRemoved} Aussage(n) vom Zahlen-Wächter entfernt${m.note ? ` · ${m.note}` : ''}]\n`);

try {
  const t0 = Date.now();
  const { analysis: a, meta: m } = await deps.analysis!.technical(named, { force: true });
  const t = a as TechnicalAnalysis;
  console.log(`━━ Technische Einschätzung (${((Date.now() - t0) / 1000).toFixed(1)} s) ━━`);
  console.log(`${t.verdict.toUpperCase()} · Sicherheit ${t.confidence} · Horizont ${t.horizon}`);
  console.log(`\n${t.summary}\n`);
  console.log(`Einstieg : ${range(t.entry.candidate)}\n           ${t.entry.comment}`);
  console.log(`Stop-Loss: ${range(t.stopLoss.candidate)}\n           ${t.stopLoss.comment}`);
  t.targets.forEach((x, i) => console.log(`Ziel ${i + 1}   : ${range(x.candidate)}\n           ${x.comment}`));
  console.log(`Chance-Risiko: ${t.riskReward ?? '–'}\n`);
  list('Dafür', t.argumentsFor);
  list('Dagegen', t.argumentsAgainst);
  list('Risiken', t.risks);
  if (t.notes.length) list('Hinweise', t.notes);
  meta(m);

  if (withNews) {
    const t1 = Date.now();
    const { analysis: n, meta: nm } = await deps.analysis!.news(named, { force: true, name: named.name });
    console.log(`━━ News-Einordnung (${((Date.now() - t1) / 1000).toFixed(1)} s) ━━`);
    console.log(n.overall.summary);
    list('Für ein Investment', n.overall.argumentsFor);
    list('Gegen ein Investment', n.overall.argumentsAgainst);
    const rated = Object.entries(n.byId).sort((x, y) => y[1].relevance - x[1].relevance).slice(0, 5);
    list(`Wichtigste Meldungen (${Object.keys(n.byId).length} bewertet)`, rated.map(([, r]) => `[${r.sentiment}, Relevanz ${r.relevance}] ${r.titleDe} – ${r.reason}`));
    if (n.notes.length) list('Hinweise', n.notes);
    meta(nm);
  }
} catch (e) {
  console.error(e instanceof AdapterError ? `Fehler ${e.code}: ${e.message}` : e);
  process.exit(1);
}
