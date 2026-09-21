import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  createLlmFromEnv,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  FallbackLLM,
  GeminiProvider,
  GroqProvider,
  OllamaProvider,
  parseJsonText,
  toGeminiSchema,
  type GenerateRequest,
  type LLMProvider,
} from '../src';
import { json, mockFetch, text } from './mock-fetch';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, description: 'Name' },
    id: { type: ['string', 'null'] },
    tags: { type: 'array', maxItems: 3, items: { type: 'object', properties: { k: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['k'] } },
  },
  required: ['name'],
};
const req: GenerateRequest = { task: 'test', system: 'SYSTEM', prompt: 'PROMPT', schema };

const geminiOk = (payload: unknown, extra: Record<string, unknown> = {}) =>
  json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP', ...extra }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45 },
  });

async function catchError(p: Promise<unknown>): Promise<AdapterError> {
  try {
    await p;
  } catch (e) {
    return e as AdapterError;
  }
  throw new Error('Erwartete einen Fehler');
}

describe('parseJsonText', () => {
  it('liest JSON auch in Markdown-Codezäunen', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('  ```\n[1,2]\n```  ')).toEqual([1, 2]);
    expect(() => parseJsonText('kein json')).toThrow();
  });
});

describe('toGeminiSchema', () => {
  it('wandelt Typen um und entfernt nicht unterstützte Schlüsselwörter', () => {
    const g = toGeminiSchema(schema) as any;
    expect(g.type).toBe('OBJECT');
    expect(g.additionalProperties).toBeUndefined();
    expect(g.properties.name).toEqual({ type: 'STRING', description: 'Name' }); // minLength entfällt
    expect(g.properties.id).toEqual({ type: 'STRING', nullable: true });
    expect(g.properties.tags.maxItems).toBe(3);
    expect(g.properties.tags.items.properties.k).toEqual({ type: 'INTEGER', minimum: 1, maximum: 5 });
    expect(g.required).toEqual(['name']);
    expect(schema.additionalProperties).toBe(false); // Original unverändert
  });
});

describe('GeminiProvider', () => {
  it('sendet Modell, Key im Header, Systemanweisung, JSON-Modus und Schema', async () => {
    const m = mockFetch(geminiOk({ name: 'x' }));
    const res = await new GeminiProvider({ apiKey: 'SECRET', fetch: m.fetch }).generateJSON(req);

    const call = m.calls[0]!;
    expect(call.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(call.url).not.toContain('SECRET');
    expect((call.init!.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET');
    const body = JSON.parse(call.init!.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('SYSTEM');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'PROMPT' }] }]);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 4096 });
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT');

    expect(res).toMatchObject({ data: { name: 'x' }, provider: 'gemini', model: DEFAULT_GEMINI_MODEL, usage: { inputTokens: 120, outputTokens: 45 } });
  });

  it('nutzt das konfigurierte Modell', async () => {
    const m = mockFetch(geminiOk({ name: 'x' }));
    const r = await new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fetch: m.fetch }).generateJSON(req);
    expect(m.calls[0]!.url).toContain('/models/gemini-3.8-flash:generateContent');
    expect(r.model).toBe('gemini-3.8-flash');
  });

  it('wiederholt ohne Schema, wenn Gemini das Schema ablehnt (400)', async () => {
    const m = mockFetch(json({ error: { message: 'Invalid JSON payload: unknown field "additionalProperties"' } }, 400), geminiOk({ name: 'ok' }));
    const res = await new GeminiProvider({ apiKey: 'k', fetch: m.fetch }).generateJSON(req);
    expect(res.data).toEqual({ name: 'ok' });
    expect(m.calls).toHaveLength(2);
    const second = JSON.parse(m.calls[1]!.init!.body as string);
    expect(second.generationConfig.responseSchema).toBeUndefined();
    expect(second.systemInstruction.parts[0].text).toContain('Antworte ausschließlich mit JSON nach diesem Schema');
  });

  it('meldet einen ungültigen Key als CONFIG, ohne zu wiederholen', async () => {
    const m = mockFetch(json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400));
    const err = await catchError(new GeminiProvider({ apiKey: 'k', fetch: m.fetch }).generateJSON(req));
    expect(err.code).toBe('CONFIG');
    expect(m.calls).toHaveLength(1);
  });

  it('erkennt unbekanntes Modell, Kontingent, Sperre und Serverfehler', async () => {
    const run = (status: number, body: unknown = {}) => catchError(new GeminiProvider({ apiKey: 'k', fetch: mockFetch(json(body, status)).fetch, sleep: async () => {} }).generateJSON(req));
    expect((await run(404, { error: { message: 'models/x is not found' } })).code).toBe('CONFIG');
    expect((await run(429)).code).toBe('RATE_LIMITED');
    expect((await run(403)).code).toBe('BLOCKED');
    const e = await run(500, { error: { message: 'boom' } });
    expect(e.code).toBe('UPSTREAM');
    expect(e.message).toContain('boom');
  });

  it('wiederholt 429 nicht selbst (die Kette springt zum nächsten Anbieter)', async () => {
    const m = mockFetch(text('', 429));
    await catchError(new GeminiProvider({ apiKey: 'k', fetch: m.fetch, sleep: async () => {} }).generateJSON(req));
    expect(m.calls).toHaveLength(1);
  });

  it('erkennt abgeschnittene, blockierte, leere und ungültige Antworten', async () => {
    const run = (res: Response) => catchError(new GeminiProvider({ apiKey: 'k', fetch: mockFetch(res).fetch }).generateJSON(req));
    expect((await run(geminiOk({ name: 'x' }, { finishReason: 'MAX_TOKENS' }))).message).toMatch(/abgeschnitten/);
    expect((await run(json({ promptFeedback: { blockReason: 'SAFETY' } }))).code).toBe('BLOCKED');
    expect((await run(json({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }))).code).toBe('BAD_RESPONSE');
    expect((await run(json({ candidates: [{ content: { parts: [{ text: 'kein json' }] } }] }))).code).toBe('BAD_RESPONSE');
  });

  it('verlangt einen Key', () => {
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
  });
});

describe('GroqProvider', () => {
  const chat = (content: string, extra: Record<string, unknown> = {}) =>
    json({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

  it('sendet Bearer-Key, Modell und JSON-Schema', async () => {
    const m = mockFetch(chat('{"name":"x"}'));
    const res = await new GroqProvider({ apiKey: 'SECRET', fetch: m.fetch }).generateJSON(req);
    const call = m.calls[0]!;
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((call.init!.headers as Record<string, string>).authorization).toBe('Bearer SECRET');
    const body = JSON.parse(call.init!.body as string);
    expect(body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(body.messages).toEqual([{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'PROMPT' }]);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'test', strict: false } });
    expect(res).toMatchObject({ data: { name: 'x' }, provider: 'groq', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('fällt bei 400 auf json_object mit Schema im Prompt zurück', async () => {
    const m = mockFetch(json({ error: { message: 'response_format json_schema not supported' } }, 400), chat('{"name":"y"}'));
    const res = await new GroqProvider({ apiKey: 'k', fetch: m.fetch }).generateJSON(req);
    expect(res.data).toEqual({ name: 'y' });
    const second = JSON.parse(m.calls[1]!.init!.body as string);
    expect(second.response_format).toEqual({ type: 'json_object' });
    expect(second.messages[0].content).toContain('Antworte ausschließlich mit JSON nach diesem Schema');
  });

  it('meldet Kontingent, ungültigen Key, abgeschnittene und ungültige Antworten', async () => {
    const run = (res: Response) => catchError(new GroqProvider({ apiKey: 'k', fetch: mockFetch(res).fetch, sleep: async () => {} }).generateJSON(req));
    expect((await run(text('', 429))).code).toBe('RATE_LIMITED');
    expect((await run(text('', 401))).code).toBe('CONFIG');
    expect((await run(chat('{"name":"x"}', { finish_reason: 'length' }))).message).toMatch(/abgeschnitten/);
    expect((await run(chat('kein json'))).code).toBe('BAD_RESPONSE');
    expect((await run(json({ choices: [] }))).code).toBe('BAD_RESPONSE');
  });

  it('verlangt einen Key', () => {
    expect(() => new GroqProvider({ apiKey: '' })).toThrow(/GROQ_API_KEY/);
  });
});

describe('OllamaProvider', () => {
  it('nutzt die lokale Chat-Schnittstelle mit Schema im Format-Feld', async () => {
    const m = mockFetch(json({ message: { content: '{"name":"z"}' }, prompt_eval_count: 7, eval_count: 3 }));
    const res = await new OllamaProvider({ url: 'http://localhost:11434/', model: 'qwen3', fetch: m.fetch }).generateJSON(req);
    expect(m.calls[0]!.url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(m.calls[0]!.init!.body as string);
    expect(body).toMatchObject({ model: 'qwen3', stream: false, format: schema });
    expect(res).toMatchObject({ data: { name: 'z' }, provider: 'ollama', usage: { inputTokens: 7, outputTokens: 3 } });
  });

  it('meldet Fehler und verlangt URL und Modell', async () => {
    const o = new OllamaProvider({ url: 'http://x', model: 'm', fetch: mockFetch(json({ error: 'model not found' }, 404)).fetch });
    expect((await catchError(o.generateJSON(req))).message).toContain('model not found');
    expect(() => new OllamaProvider({ url: '', model: '' })).toThrow(/OLLAMA/);
  });
});

describe('FallbackLLM und createLlmFromEnv', () => {
  const stub = (id: string, result: 'ok' | AdapterError): LLMProvider => ({
    id,
    model: `${id}-model`,
    generateJSON: async () => {
      if (result !== 'ok') throw result;
      return { data: { from: id }, raw: '{}', provider: id, model: `${id}-model` };
    },
  });

  it('springt bei Ausfall zum nächsten Anbieter und meldet den Ausfall', async () => {
    const events: string[] = [];
    const chain = new FallbackLLM([stub('a', new AdapterError('RATE_LIMITED', 'Limit', 'a')), stub('b', 'ok')], (e) => events.push(`${e.provider}:${e.error.code}`));
    const res = await chain.generateJSON(req);
    expect(res.provider).toBe('b');
    expect(events).toEqual(['a:RATE_LIMITED']);
    expect(chain.model).toBe('a:a-model → b:b-model');
  });

  it('fasst Fehler zusammen, wenn alle scheitern', async () => {
    const chain = new FallbackLLM([stub('a', new AdapterError('RATE_LIMITED', 'Limit', 'a')), stub('b', new AdapterError('UPSTREAM', 'kaputt', 'b'))]);
    const err = await catchError(chain.generateJSON(req));
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toContain('[a]');
    expect(err.message).toContain('[b]');
    const cfg = await catchError(new FallbackLLM([stub('a', new AdapterError('CONFIG', 'key', 'a'))]).generateJSON(req));
    expect(cfg.code).toBe('CONFIG');
  });

  it('wirft ohne Anbieter', () => {
    expect(() => new FallbackLLM([])).toThrow(/Kein KI-Anbieter/);
  });

  it('baut die Kette in fester Reihenfolge aus der Umgebung und liefert null ohne Anbieter', () => {
    expect(createLlmFromEnv({})).toBeNull();
    expect(createLlmFromEnv({ GEMINI_API_KEY: '' })).toBeNull();
    const chain = createLlmFromEnv({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k', OLLAMA_URL: 'http://x', OLLAMA_MODEL: 'm' })!;
    expect(chain.providerIds).toEqual(['gemini', 'groq', 'ollama']);
    expect(createLlmFromEnv({ GROQ_API_KEY: 'g' })!.providerIds).toEqual(['groq']);
    expect(createLlmFromEnv({ OLLAMA_URL: 'http://x' })).toBeNull(); // Modell fehlt
  });
});
