import type { ZodType } from 'zod';
import { AdapterError } from '../errors';
import { collectAllowedNumbers, guardValue, scanUnsupported, type GuardReport } from './guard';
import type { GenerateRequest, LLMProvider } from './types';

export interface StructuredResult<T> {
  value: T;
  /** Entfernte Sätze mit nicht belegten Zahlen (nach der Wiederholung). */
  guard: GuardReport;
  provider: string;
  model: string;
  /** Anzahl der KI-Anfragen (1 oder 2). */
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface StructuredOptions<T> {
  llm: LLMProvider;
  request: GenerateRequest;
  schema: ZodType<T>;
  /** Alles, was die KI als Eingabe bekam: daraus stammen die erlaubten Zahlen. */
  payload: unknown;
  /** Höchstens so viele KI-Anfragen je Auswertung (schont das Gratis-Kontingent). */
  maxAttempts?: number;
}

/**
 * Führt eine KI-Auswertung mit Qualitätssicherung durch:
 * 1. Antwort gegen das zod-Schema prüfen, bei Fehlern einmal mit Rückmeldung wiederholen.
 * 2. Zahlen prüfen: Nicht belegte Zahlen lösen eine Wiederholung aus (falls noch Versuche übrig sind).
 * 3. Bleiben nicht belegte Zahlen, werden die betroffenen Sätze entfernt statt falsche Zahlen anzuzeigen.
 */
export async function runStructured<T>(opts: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const { llm, request, schema, payload } = opts;
  const maxAttempts = opts.maxAttempts ?? 2;
  const allowed = collectAllowedNumbers(payload);
  const usage = { inputTokens: 0, outputTokens: 0 };

  let prompt = request.prompt;
  let best: { value: T; unsupported: string[]; provider: string; model: string } | undefined;
  let lastError: AdapterError | undefined;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    let feedback: string | undefined;
    try {
      const res = await llm.generateJSON({ ...request, prompt });
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;

      const parsed = schema.safeParse(res.data);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        feedback = `Die Antwort entspricht nicht dem Schema (${issue?.path.join('.') || 'Wurzel'}: ${issue?.message}).`;
        lastError = new AdapterError('BAD_RESPONSE', feedback, res.provider);
      } else {
        const unsupported = scanUnsupported(parsed.data, allowed);
        best = { value: parsed.data, unsupported, provider: res.provider, model: res.model };
        if (unsupported.length === 0) break;
        feedback = `Diese Zahlen kommen in den Eingabedaten nicht vor: ${[...new Set(unsupported)].join(', ')}. Verwende nur Zahlen aus dem JSON oder lass sie weg.`;
      }
    } catch (err) {
      // Anbieter-Fehler (Kontingent, Netzwerk …) nicht wiederholen: die Kette ist bereits durchlaufen
      if (err instanceof AdapterError && err.code !== 'BAD_RESPONSE') throw err;
      lastError = err instanceof AdapterError ? err : new AdapterError('BAD_RESPONSE', (err as Error).message, llm.id, err);
      feedback = `Die Antwort war kein gültiges JSON (${lastError.message}).`;
    }
    prompt = `${request.prompt}\n\nKorrektur: ${feedback} Antworte erneut vollständig und ausschließlich mit JSON nach dem Schema.`;
  }

  if (!best) throw lastError ?? new AdapterError('BAD_RESPONSE', 'Keine gültige KI-Antwort', llm.id);
  const { value, report } = guardValue(best.value, allowed);
  return { value, guard: report, provider: best.provider, model: best.model, attempts, usage };
}
