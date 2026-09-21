import { AdapterError } from '../errors';
import { request, type HttpOptions } from '../http';
import { parseJsonText, type GenerateRequest, type GenerateResult, type JsonSchema, type LLMProvider } from './types';

const ID = 'gemini';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Laut Drittquellen das großzügigste Gratis-Kontingent (Stand 09/2026). Per GEMINI_MODEL änderbar. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface GeminiOptions extends HttpOptions {
  apiKey: string;
  model?: string;
}

/**
 * Wandelt ein JSON-Schema in die von Gemini unterstützte Teilmenge um: Typnamen in Großbuchstaben,
 * `["string","null"]` → nullable, unbekannte Schlüsselwörter (additionalProperties, minLength …) entfallen.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const KEEP = new Set(['type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'items', 'minimum', 'maximum', 'propertyOrdering']);
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!KEEP.has(key)) continue;
    if (key === 'type') {
      const types = Array.isArray(value) ? (value as string[]) : [value as string];
      const real = types.filter((t) => t !== 'null');
      out.type = String(real[0] ?? 'string').toUpperCase();
      if (types.includes('null')) out.nullable = true;
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === 'items') {
      out.items = toGeminiSchema(value as JsonSchema);
    } else {
      out[key] = value;
    }
  }
  return out;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

/** Google Gemini über die REST-Schnittstelle `generateContent` (Gratis-Tarif über einen Key aus AI Studio). */
export class GeminiProvider implements LLMProvider {
  readonly id = ID;
  readonly model: string;

  constructor(private readonly opts: GeminiOptions) {
    if (!opts.apiKey) throw new AdapterError('CONFIG', 'GEMINI_API_KEY fehlt', ID);
    this.model = opts.model || DEFAULT_GEMINI_MODEL;
  }

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    let res = await this.call(req, true);
    if (res.status === 400 && !(await isKeyError(res))) {
      // Manche Modelle lehnen einzelne Schema-Features ab: einmal ohne Schema wiederholen (Prüfung erfolgt danach ohnehin per zod)
      res = await this.call(req, false);
    }
    const body = (await res.json().catch(() => null)) as GeminiResponse | null;

    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /api key/i.test(msg)) throw new AdapterError('CONFIG', 'Gemini-Key ungültig', ID);
      if (res.status === 404) throw new AdapterError('CONFIG', `Modell "${this.model}" nicht gefunden (GEMINI_MODEL prüfen)`, ID);
      throw new AdapterError('UPSTREAM', `HTTP ${res.status}: ${msg}`, ID);
    }
    if (!body) throw new AdapterError('BAD_RESPONSE', 'Antwort ist kein JSON', ID);
    if (body.promptFeedback?.blockReason) throw new AdapterError('BLOCKED', `Anfrage blockiert (${body.promptFeedback.blockReason})`, ID);

    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new AdapterError('BAD_RESPONSE', `Leere Antwort (Grund: ${candidate?.finishReason ?? 'unbekannt'})`, ID);
    if (candidate?.finishReason === 'MAX_TOKENS') throw new AdapterError('BAD_RESPONSE', 'Antwort wurde abgeschnitten (MAX_TOKENS)', ID);

    let data: unknown;
    try {
      data = parseJsonText(text);
    } catch (err) {
      throw new AdapterError('BAD_RESPONSE', 'Antwort ist kein gültiges JSON', ID, err);
    }
    return {
      data,
      raw: text,
      provider: ID,
      model: this.model,
      usage: { inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: body.usageMetadata?.candidatesTokenCount },
    };
  }

  private call(req: GenerateRequest, withSchema: boolean): Promise<Response> {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      temperature: req.temperature ?? 0.3,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
    };
    if (withSchema) generationConfig.responseSchema = toGeminiSchema(req.schema);
    const system = withSchema ? req.system : `${req.system}\n\nAntworte ausschließlich mit JSON nach diesem Schema:\n${JSON.stringify(req.schema)}`;

    return request(
      `${BASE}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig,
        }),
      },
      ID,
      // Kontingentfehler nicht selbst wiederholen: die Fallback-Kette springt zum nächsten Anbieter
      { timeoutMs: 45_000, retries: 0, ...this.opts },
      { unauthorized: 'CONFIG' },
    );
  }
}

async function isKeyError(res: Response): Promise<boolean> {
  const body = (await res.clone().json().catch(() => null)) as GeminiResponse | null;
  return /api key/i.test(body?.error?.message ?? '');
}
