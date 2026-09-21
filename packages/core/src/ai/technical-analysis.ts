import { z } from 'zod';
import type { TechnicalSnapshot } from '../indicators/snapshot';
import { DEFAULT_LANG, msg, type Lang, type Msg } from '../messages';
import type { Instrument, Quote } from '../types';
import { resolvePlan, type Candidate, type Candidates, type ResolvedPlan } from './candidates';
import type { FxPerformance } from './fx';
import { runStructured, type StructuredResult } from './structured';
import type { GenerateRequest, JsonSchema, LLMProvider } from './types';

/** Bei Änderungen an Prompt oder Schema erhöhen: macht zwischengespeicherte Auswertungen ungültig. */
export const TECHNICAL_PROMPT_VERSION = 3;

export const VERDICTS = ['bullish', 'neutral', 'bearish'] as const;
export const CONFIDENCES = ['niedrig', 'mittel', 'hoch'] as const;
export const HORIZONS = ['kurzfristig', 'mittelfristig', 'langfristig'] as const;
export type Verdict = (typeof VERDICTS)[number];

const text = z.string().trim().min(1);

/** Was die KI liefert (Kurse nur als Kandidaten-IDs). */
export const technicalOutputSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.enum(CONFIDENCES),
  /** Kurzfazit in Alltagssprache für Laien, ohne Fachbegriffe. */
  plain: z.object({
    headline: text,
    explanation: text,
    pros: z.array(text).min(1).max(3),
    cons: z.array(text).min(1).max(3),
  }),
  summary: text,
  argumentsFor: z.array(text).min(1).max(6),
  argumentsAgainst: z.array(text).min(1).max(6),
  risks: z.array(text).min(1).max(5),
  entry: z.object({ candidateId: z.string().nullable(), comment: text }),
  stopLoss: z.object({ candidateId: z.string().nullable(), comment: text }),
  targets: z.array(z.object({ candidateId: z.string(), comment: text })).max(3),
  horizon: z.enum(HORIZONS),
  horizonComment: text,
});
export type TechnicalOutput = z.infer<typeof technicalOutputSchema>;

const str = (description: string): JsonSchema => ({ type: 'string', description });
const strList = (description: string, min: number, max: number): JsonSchema => ({ type: 'array', minItems: min, maxItems: max, items: { type: 'string' }, description });

export const TECHNICAL_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: [...VERDICTS], description: 'Gesamteinschätzung' },
    confidence: { type: 'string', enum: [...CONFIDENCES], description: 'Wie eindeutig die Lage ist' },
    plain: {
      type: 'object',
      description: 'Kurzfazit für Laien in Alltagssprache, ohne Fachbegriffe',
      properties: {
        headline: str('Ein kurzer Satz (höchstens 12 Wörter), der die Lage auf den Punkt bringt'),
        explanation: str('2 bis 3 einfache Sätze: Was ist zuletzt passiert und wie sieht es aus?'),
        pros: strList('1 bis 3 einfache Punkte, die eher für die Aktie sprechen', 1, 3),
        cons: strList('1 bis 3 einfache Punkte, die eher gegen die Aktie sprechen', 1, 3),
      },
      required: ['headline', 'explanation', 'pros', 'cons'],
    },
    summary: str('Fachliche Zusammenfassung in 2 bis 3 Sätzen'),
    argumentsFor: strList('Argumente für einen Einstieg', 1, 6),
    argumentsAgainst: strList('Argumente gegen einen Einstieg', 1, 6),
    risks: strList('Risiken', 1, 5),
    entry: { type: 'object', properties: { candidateId: { type: ['string', 'null'], description: 'ID aus candidates.entries oder null' }, comment: str('Begründung') }, required: ['candidateId', 'comment'] },
    stopLoss: { type: 'object', properties: { candidateId: { type: ['string', 'null'], description: 'ID aus candidates.stops oder null' }, comment: str('Begründung') }, required: ['candidateId', 'comment'] },
    targets: {
      type: 'array',
      maxItems: 3,
      description: 'IDs aus candidates.targets, aufsteigend',
      items: { type: 'object', properties: { candidateId: str('ID aus candidates.targets'), comment: str('Begründung') }, required: ['candidateId', 'comment'] },
    },
    horizon: { type: 'string', enum: [...HORIZONS] },
    horizonComment: str('Begründung des Zeithorizonts'),
  },
  required: ['verdict', 'confidence', 'plain', 'summary', 'argumentsFor', 'argumentsAgainst', 'risks', 'entry', 'stopLoss', 'targets', 'horizon', 'horizonComment'],
};

const LANGUAGE_NAME: Record<Lang, string> = { de: 'Deutsch', tr: 'Türkisch (Türkçe)' };

/** Sprachregel für alle Freitexte. Die festen Auswahlwerte (verdict, confidence, horizon) bleiben unverändert. */
export function languageRule(lang: Lang): string {
  return `Sprache: Schreibe ALLE Freitexte auf ${LANGUAGE_NAME[lang]}. Die festen Auswahlwerte (verdict, confidence, horizon, Kandidaten-IDs) bleiben genau wie im Schema vorgegeben.`;
}

export const TECHNICAL_SYSTEM = `Du bist ein erfahrener, nüchterner Chartanalyst. Du bekommst technische Kennzahlen als JSON, die ein Programm berechnet hat, und schreibst daraus eine ausgewogene Einschätzung.

Regeln:
1. Verwende ausschließlich Zahlen, die im JSON stehen. Erfinde, schätze oder berechne keine Kurse, Prozentwerte oder Kennzahlen. Nenne Preise nur, wenn sie wörtlich im JSON vorkommen.
2. Einstiegsbereich, Stop-Loss und Kursziele wählst du ausschließlich über die IDs aus "candidates" (z. B. E2, SL2, T1). Passt keine Option, setze null (bzw. eine leere Liste) und begründe das.
3. Sei ausgewogen: Nenne immer Argumente dafür UND dagegen sowie Risiken, auch bei klarem Trend. Widersprüchliche Signale gehören ausdrücklich in die Einschätzung. Grundlage für Aussagen zum Trend ist "snapshot.trend.state" (Swing-Hochs und -Tiefs). Zeigen gleitende Durchschnitte oder Golden Cross in eine andere Richtung, benenne den Widerspruch, statt einfach "Aufwärtstrend" zu schreiben.
4. Gib keine Anlageempfehlung und keine Kaufaufforderung. Formuliere als technische Einschätzung ("aus technischer Sicht", "spricht für", "spricht gegen"). Keine Garantien, keine Prognosen als Tatsache.
5. Beachte "dataWarnings" (Datenlücken) und weise auf relevante Einschränkungen hin.
6. Bei Aktien in türkischer Lira (TRY): "fxPerformance" vergleicht die Kursentwicklung in TRY mit der in Fremdwährung. Ordne ein, dass nominale TRY-Gewinne durch die Abwertung der Lira verzerrt sind, und nutze dafür nur die gelieferten Zahlen.
7. Das Feld "verdict": bullish = überwiegend positive technische Lage, bearish = überwiegend negative, neutral = gemischt oder seitwärts. Ist der Trend abwärts gerichtet, ist ein Einstieg meist nicht begründbar: dann sind entry und stopLoss oft null.
8. Das Feld "plain" ist ein Kurzfazit für Menschen OHNE Börsenwissen (Laien): Alltagssprache, kurze einfache Sätze, keine Fachbegriffe. Verwende NICHT die Wörter RSI, MACD, SMA, EMA, ATR, Bollinger, Golden Cross, Death Cross, Widerstand, Unterstützung, Momentum, Volatilität, Swing. Beschreibe stattdessen in Alltagsworten, z. B. "Der Kurs ist in den letzten Wochen gestiegen", "Der Kurs liegt über dem Durchschnitt der letzten Monate", "Der Kurs schwankt gerade stark". Nenne in "plain" möglichst keine Zahlen; wenn doch, dann exakt aus dem JSON. "plain" muss zum verdict passen und ebenfalls ausgewogen sein (mindestens ein Punkt dafür und einer dagegen). Keine Aufforderung zum Kaufen oder Verkaufen.
9. Alle anderen Felder (summary, arguments, risks, comments) dürfen Fachbegriffe verwenden. Schreibe knapp und konkret in ganzen Sätzen. Antworte ausschließlich mit JSON nach dem vorgegebenen Schema.`;

export interface TechnicalInput {
  instrument: Instrument & { currency: string };
  quote: Pick<Quote, 'price' | 'changePercent' | 'dayHigh' | 'dayLow' | 'freshness'> | null;
  snapshot: TechnicalSnapshot;
  candidates: Candidates;
  fxPerformance?: FxPerformance[];
  /** Hinweise zu den Daten, bereits als Text (die KI liest Deutsch, unabhängig von der Ausgabesprache). */
  dataWarnings?: string[];
  lang?: Lang;
}

/** Das JSON, das die KI zu sehen bekommt. Alle erlaubten Zahlen stammen von hier. */
export function buildTechnicalPayload(input: TechnicalInput, warningText: (m: Msg) => string = (m) => m.code) {
  const { snapshot } = input;
  const { warnings, asOf, ...rest } = snapshot;
  return {
    instrument: { symbol: input.instrument.symbol, market: input.instrument.market, name: input.instrument.name ?? null, currency: input.instrument.currency },
    stand: new Date(asOf * 1000).toISOString().slice(0, 10),
    ausgabeSprache: input.lang ?? DEFAULT_LANG,
    quote: input.quote,
    snapshot: rest,
    candidates: input.candidates,
    ...(input.fxPerformance?.length ? { fxPerformance: input.fxPerformance } : {}),
    dataWarnings: [...(input.dataWarnings ?? []), ...warnings.map(warningText)],
  };
}

export function buildTechnicalRequest(payload: unknown, lang: Lang = DEFAULT_LANG): GenerateRequest {
  return {
    task: 'technical',
    system: `${TECHNICAL_SYSTEM}\n\n${languageRule(lang)}`,
    prompt: `Erstelle die technische Einschätzung für diese Aktie. Eingabedaten:\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\``,
    schema: TECHNICAL_JSON_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 4096,
  };
}

/** Auswertung mit aufgelösten Zahlen, so wie sie die App anzeigt. */
export interface TechnicalAnalysis {
  verdict: Verdict;
  confidence: (typeof CONFIDENCES)[number];
  plain: { headline: string; explanation: string; pros: string[]; cons: string[] };
  summary: string;
  argumentsFor: string[];
  argumentsAgainst: string[];
  risks: string[];
  entry: { candidate: Candidate | null; comment: string };
  stopLoss: { candidate: Candidate | null; comment: string };
  targets: { candidate: Candidate; comment: string }[];
  riskReward: number | null;
  horizon: (typeof HORIZONS)[number];
  horizonComment: string;
  /** Hinweise zur Qualitätssicherung (verworfene ID-Auswahl, entfernte Sätze). */
  notes: Msg[];
}

export interface TechnicalRun {
  analysis: TechnicalAnalysis;
  provider: string;
  model: string;
  attempts: number;
  guardRemoved: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runTechnicalAnalysis(opts: { llm: LLMProvider; payload: unknown; candidates: Candidates; lang?: Lang }): Promise<TechnicalRun> {
  const r: StructuredResult<TechnicalOutput> = await runStructured({
    llm: opts.llm,
    request: buildTechnicalRequest(opts.payload, opts.lang),
    schema: technicalOutputSchema,
    payload: opts.payload,
  });
  const o = r.value;
  const plan: ResolvedPlan = resolvePlan(opts.candidates, {
    entryId: o.entry.candidateId,
    stopId: o.stopLoss.candidateId,
    targetIds: o.targets.map((t) => t.candidateId),
  });

  const notes: Msg[] = [...plan.notes];
  if (r.guard.removed > 0) notes.push(msg('guardRemoved', { count: r.guard.removed }));
  const commentFor = (id: string) => o.targets.find((t) => t.candidateId === id)?.comment ?? '';

  const analysis: TechnicalAnalysis = {
    verdict: o.verdict,
    confidence: o.confidence,
    plain: o.plain,
    // Nach dem Zahlen-Wächter kann ein Text leer sein: die App zeigt dann eine eigene Ersatzzeile
    summary: o.summary,
    argumentsFor: o.argumentsFor,
    argumentsAgainst: o.argumentsAgainst,
    risks: o.risks,
    entry: { candidate: plan.entry, comment: o.entry.comment },
    stopLoss: { candidate: plan.stop, comment: o.stopLoss.comment },
    targets: plan.targets.map((c) => ({ candidate: c, comment: commentFor(c.id) })),
    riskReward: plan.riskReward,
    horizon: o.horizon,
    horizonComment: o.horizonComment,
    notes,
  };
  return { analysis, provider: r.provider, model: r.model, attempts: r.attempts, guardRemoved: r.guard.removed, usage: r.usage };
}
