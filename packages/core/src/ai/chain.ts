import { AdapterError } from '../errors';
import type { HttpOptions } from '../http';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './openai-compatible';
import { OllamaProvider } from './ollama';
import type { GenerateRequest, GenerateResult, LLMProvider } from './types';

export type LlmFallbackListener = (event: { provider: string; error: AdapterError }) => void;

/**
 * Fragt mehrere KI-Anbieter der Reihe nach ab. Bei Kontingent-, Server- oder Formatfehlern springt die Kette
 * zum nächsten Anbieter. Ein ungültiger Key zählt ebenfalls als Ausfall, damit ein Anbieter den anderen nicht blockiert.
 */
export class FallbackLLM implements LLMProvider {
  readonly id = 'chain';

  constructor(
    private readonly providers: readonly LLMProvider[],
    private readonly onFallback?: LlmFallbackListener,
  ) {
    if (providers.length === 0) throw new AdapterError('CONFIG', 'Kein KI-Anbieter konfiguriert', 'llm');
  }

  get model(): string {
    return this.providers.map((p) => `${p.id}:${p.model}`).join(' → ');
  }

  get providerIds(): string[] {
    return this.providers.map((p) => p.id);
  }

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    const errors: AdapterError[] = [];
    for (const p of this.providers) {
      try {
        return await p.generateJSON(req);
      } catch (err) {
        const e = err instanceof AdapterError ? err : new AdapterError('UPSTREAM', (err as Error).message, p.id, err);
        errors.push(e);
        this.onFallback?.({ provider: p.id, error: e });
      }
    }
    const code = errors.every((e) => e.code === 'CONFIG') ? 'CONFIG' : (errors.find((e) => e.code === 'RATE_LIMITED')?.code ?? 'UPSTREAM');
    throw new AdapterError(code, `KI-Anfrage bei allen Anbietern fehlgeschlagen: ${errors.map((e) => e.message).join(' | ')}`, this.id);
  }
}

export interface LlmEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  OLLAMA_URL?: string;
  OLLAMA_MODEL?: string;
}

/**
 * Baut die KI-Kette aus der Umgebung: Gemini → Groq → Ollama (nur konfigurierte). Ohne jeden Anbieter
 * gibt die Funktion `null` zurück, die App läuft dann ohne KI-Auswertung weiter.
 */
export function createLlmFromEnv(env: LlmEnv, http: HttpOptions & { onFallback?: LlmFallbackListener } = {}): FallbackLLM | null {
  const { onFallback, ...httpOpts } = http;
  const providers: LLMProvider[] = [];
  if (env.GEMINI_API_KEY) providers.push(new GeminiProvider({ ...httpOpts, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }));
  if (env.GROQ_API_KEY) providers.push(new GroqProvider({ ...httpOpts, apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }));
  if (env.OLLAMA_URL && env.OLLAMA_MODEL) providers.push(new OllamaProvider({ ...httpOpts, url: env.OLLAMA_URL, model: env.OLLAMA_MODEL }));
  return providers.length ? new FallbackLLM(providers, onFallback) : null;
}
