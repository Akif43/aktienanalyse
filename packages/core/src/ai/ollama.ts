import { AdapterError } from '../errors';
import { request, type HttpOptions } from '../http';
import { parseJsonText, type GenerateRequest, type GenerateResult, type LLMProvider } from './types';

const ID = 'ollama';

export interface OllamaOptions extends HttpOptions {
  /** z. B. http://localhost:11434 */
  url: string;
  model: string;
}

/**
 * Lokales Modell über Ollama. Nur für die Entwicklung auf dem eigenen Rechner: aus Vercel oder GitHub Actions
 * ist ein lokaler Server nicht erreichbar.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = ID;
  readonly model: string;

  constructor(private readonly opts: OllamaOptions) {
    if (!opts.url || !opts.model) throw new AdapterError('CONFIG', 'OLLAMA_URL und OLLAMA_MODEL nötig', ID);
    this.model = opts.model;
  }

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    const res = await request(
      `${this.opts.url.replace(/\/+$/, '')}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: req.schema,
          options: { temperature: req.temperature ?? 0.3 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
        }),
      },
      ID,
      { timeoutMs: 120_000, retries: 0, fetch: this.opts.fetch, sleep: this.opts.sleep },
    );
    const body = (await res.json().catch(() => null)) as { message?: { content?: string }; error?: string; prompt_eval_count?: number; eval_count?: number } | null;
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}: ${body?.error ?? 'unbekannter Fehler'}`, ID);
    const text = body?.message?.content ?? '';
    if (!text) throw new AdapterError('BAD_RESPONSE', 'Leere Antwort', ID);
    try {
      return {
        data: parseJsonText(text),
        raw: text,
        provider: ID,
        model: this.model,
        usage: { inputTokens: body?.prompt_eval_count, outputTokens: body?.eval_count },
      };
    } catch (err) {
      throw new AdapterError('BAD_RESPONSE', 'Antwort ist kein gültiges JSON', ID, err);
    }
  }
}
