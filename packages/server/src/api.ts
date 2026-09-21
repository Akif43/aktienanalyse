import {
  AdapterError,
  AnalysisService,
  createLlmFromEnv,
  createMarketData,
  createNewsService,
  DemoProvider,
  DEFAULT_LANG,
  isLang,
  MemoryKv,
  parseInstrument,
  ResilientKv,
  searchInstruments,
  SupabaseKv,
  type AdapterErrorCode,
  type Instrument,
  type KeyValueStore,
  type LlmEnv,
  type LLMProvider,
  type MarketDataAdapter,
  type SearchResult,
  type Timeframe,
} from '@aktien/core';
import type { NewsService } from '@aktien/core';
import { TtlCache } from './cache';
import { CachingMarket } from './caching-market';

export interface ApiEnv extends LlmEnv {
  /** Wenn gesetzt, verlangt jede Datenabfrage `Authorization: Bearer <APP_TOKEN>`. */
  APP_TOKEN?: string;
  FINNHUB_API_KEY?: string;
  /** "demo": Platzhaltertexte ohne echte KI (nur zum Ausprobieren der Oberfläche). */
  AI_PROVIDER?: string;
  /** Höchstzahl der KI-Anfragen pro Tag (Schutz des Gratis-Kontingents). */
  AI_DAILY_LIMIT?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

export interface AiInfo {
  configured: boolean;
  /** Angesprochene Anbieter in Reihenfolge, z. B. ["gemini", "groq"]. */
  providers: string[];
  /** "supabase" = Auswertungen bleiben erhalten; "memory" = gehen bei jedem Kaltstart verloren (verbraucht Kontingent). */
  storage: 'supabase' | 'memory';
}

export interface ApiDeps {
  market: MarketDataAdapter;
  news: NewsService;
  search: (query: string) => Promise<SearchResult[]>;
  cache?: TtlCache;
  analysis?: AnalysisService;
  aiInfo?: AiInfo;
}

const TIMEFRAMES: readonly Timeframe[] = ['1T', '1W', '1M', '6M', '1J', '5J'];
const MAX_TICKERS = 20;

const TTL = {
  quote: 10_000,
  candlesIntraday: 30_000,
  candles: 5 * 60_000,
  history: 15 * 60_000,
  news: 5 * 60_000,
  search: 60 * 60_000,
};

const STATUS: Record<AdapterErrorCode, number> = {
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  BLOCKED: 502,
  UPSTREAM: 502,
  BAD_RESPONSE: 502,
  UNSUPPORTED: 422,
  CONFIG: 500,
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Baut die Standard-Abhängigkeiten aus der Umgebung (Live-Datenquellen, KI-Kette, Speicher). */
export function createDeps(env: ApiEnv): ApiDeps {
  const finnhubApiKey = env.FINNHUB_API_KEY || undefined;
  const market = createMarketData({ finnhubApiKey });
  const news = createNewsService({ finnhubApiKey });
  const cache = new TtlCache();

  let llm: LLMProvider | null;
  let providers: string[];
  if (env.AI_PROVIDER === 'demo') {
    llm = new DemoProvider();
    providers = ['demo'];
  } else {
    const chain = createLlmFromEnv(env, { onFallback: (e) => console.warn(`KI-Anbieter ${e.provider} ausgefallen: ${e.error.message}`) });
    llm = chain;
    providers = chain?.providerIds ?? [];
  }

  const persistent = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
  const kv: KeyValueStore = persistent
    ? new ResilientKv(new SupabaseKv({ url: env.SUPABASE_URL!, serviceKey: env.SUPABASE_SERVICE_KEY! }), new MemoryKv(), (err) => console.warn('Supabase-Fehler:', (err as Error).message))
    : new MemoryKv();
  const limit = Number(env.AI_DAILY_LIMIT);

  return {
    market,
    news,
    search: (q) => searchInstruments(q),
    cache,
    analysis: new AnalysisService({ llm, kv, market: new CachingMarket(market, cache), news, dailyLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined }),
    aiInfo: { configured: llm !== null, providers, storage: persistent ? 'supabase' : 'memory' },
  };
}

/**
 * Erzeugt den API-Handler auf Basis von Web-Standard `Request`/`Response`. Routen:
 * /api/health, /api/quote, /api/candles, /api/history, /api/news, /api/search.
 */
export function createApi(env: ApiEnv, deps: ApiDeps = createDeps(env)): (req: Request) => Promise<Response> {
  const cache = deps.cache ?? new TtlCache();

  return async (req) => {
    try {
      const url = new URL(req.url);
      const route = url.pathname.replace(/\/+$/, '').replace(/^\/api\//, '');
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Nur GET erlaubt');

      if (route === 'health') {
        return json({ ok: true, authRequired: Boolean(env.APP_TOKEN), ai: deps.aiInfo ?? { configured: false, providers: [], storage: 'memory' }, time: new Date().toISOString() });
      }
      authorize(req, env);

      switch (route) {
        case 'quote':
          return json(await quotes(url, deps, cache));
        case 'candles':
          return json(await candles(url, deps, cache));
        case 'history':
          return json(await history(url, deps, cache));
        case 'news':
          return json(await news(url, deps, cache));
        case 'search':
          return json(await search(url, deps, cache));
        case 'analysis':
          return json(await analysis(url, deps, cache, 'technical'));
        case 'news-analysis':
          return json(await analysis(url, deps, cache, 'news'));
        default:
          throw new HttpError(404, 'NOT_FOUND', `Unbekannte Route: ${route || '/'}`);
      }
    } catch (err) {
      return errorResponse(err);
    }
  };
}

// --- Routen -----------------------------------------------------------------------------------

async function quotes(url: URL, deps: ApiDeps, cache: TtlCache) {
  const tickers = (url.searchParams.get('s') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (tickers.length === 0) throw new HttpError(400, 'BAD_REQUEST', 'Parameter s fehlt');
  if (tickers.length > MAX_TICKERS) throw new HttpError(400, 'BAD_REQUEST', `Höchstens ${MAX_TICKERS} Ticker je Abruf`);

  // Einzelne Fehler dürfen die übrigen Kurse nicht verhindern.
  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const inst = instrumentFrom(ticker);
        const quote = await cache.get(`q:${ticker}`, TTL.quote, () => deps.market.getQuote(inst));
        return { ticker, quote };
      } catch (err) {
        return { ticker, error: toErrorBody(err) };
      }
    }),
  );
  return { results };
}

async function candles(url: URL, deps: ApiDeps, cache: TtlCache) {
  const ticker = requireTicker(url);
  const tf = url.searchParams.get('tf') as Timeframe | null;
  if (!tf || !TIMEFRAMES.includes(tf)) throw new HttpError(400, 'BAD_REQUEST', `tf muss einer von ${TIMEFRAMES.join(', ')} sein`);
  const inst = instrumentFrom(ticker);
  const ttl = tf === '1T' || tf === '1W' ? TTL.candlesIntraday : TTL.candles;
  return cache.get(`c:${ticker}:${tf}`, ttl, () => deps.market.getCandles(inst, tf));
}

async function history(url: URL, deps: ApiDeps, cache: TtlCache) {
  const ticker = requireTicker(url);
  const inst = instrumentFrom(ticker);
  return cache.get(`h:${ticker}`, TTL.history, () => deps.market.getDailyHistory(inst));
}

async function news(url: URL, deps: ApiDeps, cache: TtlCache) {
  const ticker = requireTicker(url);
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 80) || undefined;
  const inst: Instrument = { ...instrumentFrom(ticker), name };
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 40);
  const result = await cache.get(`n:${ticker}:${name ?? ''}`, TTL.news, () => deps.news.getNews(inst));
  return {
    items: result.items.slice(0, limit),
    errors: result.errors.map((e) => ({ adapter: e.adapter, code: e.code, message: e.message })),
  };
}

async function search(url: URL, deps: ApiDeps, cache: TtlCache) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1 || q.length > 40) throw new HttpError(400, 'BAD_REQUEST', 'q muss 1 bis 40 Zeichen lang sein');
  const results = await cache.get(`s:${q.toLowerCase()}`, TTL.search, () => deps.search(q));
  return { results };
}

/** KI-Auswertung (technisch oder News). Mit refresh=1 wird eine neue Auswertung angefordert (Mindestabstand gilt). */
async function analysis(url: URL, deps: ApiDeps, cache: TtlCache, kind: 'technical' | 'news') {
  const service = deps.analysis;
  if (!service || !service.configured) {
    throw new HttpError(503, 'AI_NOT_CONFIGURED', 'Die KI-Auswertung ist nicht eingerichtet: Es fehlt ein API-Key (GEMINI_API_KEY oder GROQ_API_KEY).');
  }
  const ticker = requireTicker(url);
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 80) || undefined;
  const force = ['1', 'true'].includes(url.searchParams.get('refresh') ?? '');
  const langParam = url.searchParams.get('lang');
  const lang = isLang(langParam) ? langParam : DEFAULT_LANG;
  const inst: Instrument = { ...instrumentFrom(ticker), name };
  // TTL 0: nur gleichzeitige gleiche Anfragen zusammenfassen (eine KI-Anfrage), Ergebnisse nicht nachspeichern.
  // Den Zwischenspeicher mit Mindestabstand und Tageslimit führt der Dienst selbst.
  return cache.get<unknown>(`ai:${kind}:${ticker}:${name ?? ''}:${force}:${lang}`, 0, () => (kind === 'technical' ? service.technical(inst, { force, lang }) : service.news(inst, { force, name, lang })));
}

// --- Hilfsfunktionen ---------------------------------------------------------------------------

function requireTicker(url: URL): string {
  const t = (url.searchParams.get('s') ?? '').trim();
  if (!t) throw new HttpError(400, 'BAD_REQUEST', 'Parameter s fehlt');
  return t.toUpperCase();
}

function instrumentFrom(ticker: string): Instrument {
  try {
    return parseInstrument(ticker);
  } catch (err) {
    throw new HttpError(400, 'BAD_REQUEST', (err as Error).message);
  }
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null || value.trim() === '') return fallback; // Number(null) wäre 0
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function authorize(req: Request, env: ApiEnv): void {
  if (!env.APP_TOKEN) return;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !safeEqual(token, env.APP_TOKEN)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Zugriffstoken fehlt oder ist falsch');
  }
}

/** Vergleich ohne frühzeitigen Abbruch, damit die Antwortzeit nichts über das Token verrät. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function toErrorBody(err: unknown): { code: string; message: string } {
  if (err instanceof AdapterError) return { code: err.code, message: err.message };
  if (err instanceof HttpError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL', message: 'Interner Fehler' };
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: toErrorBody(err) }, err.status);
  if (err instanceof AdapterError) return json({ error: toErrorBody(err) }, STATUS[err.code]);
  console.error('Unerwarteter Fehler', err);
  return json({ error: toErrorBody(err) }, 500);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
