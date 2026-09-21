import { AdapterError } from '../errors';
import { request, type HttpOptions } from '../http';
import { parseJsonText, type GenerateRequest, type GenerateResult, type LLMProvider } from './types';

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export interface OpenAiCompatibleOptions extends HttpOptions {
  id: string;
  url: string;
  model: string;
  apiKey?: string;
  /** true: json_schema (Best-Effort) mit Rückfall auf json_object; false: nur json_object + Schema im Prompt. */
  supportsJsonSchema: boolean;
}

/** Gemeinsame Basis für Anbieter mit OpenAI-kompatibler Chat-Schnittstelle (Groq, lokale Server). */
export class OpenAiCompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;

  constructor(protected readonly opts: OpenAiCompatibleOptions) {
    this.id = opts.id;
    this.model = opts.model;
  }

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    let res = await this.call(req, this.opts.supportsJsonSchema ? 'schema' : 'object');
    if (res.status === 400 && this.opts.supportsJsonSchema) res = await this.call(req, 'object');

    const body = (await res.json().catch(() => null)) as ChatResponse | null;
    if (!res.ok) {
      throw new AdapterError('UPSTREAM', `HTTP ${res.status}: ${body?.error?.message ?? 'unbekannter Fehler'}`, this.id);
    }
    const choice = body?.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text) throw new AdapterError('BAD_RESPONSE', `Leere Antwort (Grund: ${choice?.finish_reason ?? 'unbekannt'})`, this.id);
    if (choice?.finish_reason === 'length') throw new AdapterError('BAD_RESPONSE', 'Antwort wurde abgeschnitten', this.id);

    let data: unknown;
    try {
      data = parseJsonText(text);
    } catch (err) {
      throw new AdapterError('BAD_RESPONSE', 'Antwort ist kein gültiges JSON', this.id, err);
    }
    return {
      data,
      raw: text,
      provider: this.id,
      model: this.model,
      usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens },
    };
  }

  private call(req: GenerateRequest, mode: 'schema' | 'object'): Promise<Response> {
    const system = mode === 'object' ? `${req.system}\n\nAntworte ausschließlich mit JSON nach diesem Schema:\n${JSON.stringify(req.schema)}` : req.system;
    const payload: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.prompt },
      ],
      temperature: req.temperature ?? 0.3,
      max_completion_tokens: req.maxOutputTokens ?? 4096,
      response_format:
        mode === 'schema'
          ? { type: 'json_schema', json_schema: { name: req.task, strict: false, schema: req.schema } }
          : { type: 'json_object' },
    };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    return request(
      this.opts.url,
      { method: 'POST', headers, body: JSON.stringify(payload) },
      this.id,
      { timeoutMs: 45_000, retries: 0, fetch: this.opts.fetch, sleep: this.opts.sleep },
      { unauthorized: 'CONFIG' },
    );
  }
}

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export interface GroqOptions extends HttpOptions {
  apiKey: string;
  model?: string;
}

/** Groq (Gratis-Tarif, Rückfall für Gemini). JSON-Schema-Ausgabe gibt es bei den gpt-oss- und qwen-Modellen. */
export class GroqProvider extends OpenAiCompatibleProvider {
  constructor(opts: GroqOptions) {
    if (!opts.apiKey) throw new AdapterError('CONFIG', 'GROQ_API_KEY fehlt', 'groq');
    super({ ...opts, id: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: opts.model || DEFAULT_GROQ_MODEL, supportsJsonSchema: true });
  }
}
