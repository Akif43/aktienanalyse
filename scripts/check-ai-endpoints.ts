/**
 * Prüft die KI-Endpunkte OHNE gültigen Key: Es wird bewusst ein ungültiger Key gesendet. So sieht man, ob
 * URL, Anfrageformat und Fehlerbehandlung zu den echten Servern passen, ohne Kontingent zu verbrauchen.
 * Mit echten Keys (GEMINI_API_KEY / GROQ_API_KEY in .env) macht `npm run analyze` einen echten Testlauf.
 */
import { AdapterError, GeminiProvider, GroqProvider, TECHNICAL_JSON_SCHEMA, type GenerateRequest, type LLMProvider } from '@aktien/core';

const req: GenerateRequest = {
  task: 'check',
  system: 'Du antwortest ausschließlich mit JSON.',
  prompt: 'Antworte mit {"ok": true}.',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
};

const checks: { name: string; provider: LLMProvider; schemaReq?: GenerateRequest }[] = [
  { name: 'Gemini (ungültiger Key)', provider: new GeminiProvider({ apiKey: 'ungueltig-test-key', retries: 0 } as never) },
  { name: 'Gemini mit dem echten Auswertungs-Schema', provider: new GeminiProvider({ apiKey: 'ungueltig-test-key' }), schemaReq: { ...req, schema: TECHNICAL_JSON_SCHEMA } },
  { name: 'Groq (ungültiger Key)', provider: new GroqProvider({ apiKey: 'ungueltig-test-key' }) },
];

let bad = 0;
for (const c of checks) {
  try {
    await c.provider.generateJSON(c.schemaReq ?? req);
    console.log(`?  ${c.name}: unerwartet erfolgreich`);
    bad++;
  } catch (e) {
    const err = e as AdapterError;
    // Erwartet: CONFIG (Key ungültig). Alles andere deutet auf falsche URL, falsches Format oder Sperre hin.
    const ok = err instanceof AdapterError && err.code === 'CONFIG';
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : '!! '} ${c.name}: ${err.code ?? 'ERROR'} – ${err.message}`);
  }
}
process.exit(bad ? 1 : 0);
