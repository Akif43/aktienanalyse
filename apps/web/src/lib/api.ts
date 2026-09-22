import type { CandleSeries, Envelope, Fund, FundBenchmarkPoint, FundPeriod, FundPricePoint, FundSearchResult, Lang, NewsItemDetail, NewsAnalysis, NewsItem, Quote, SearchResult, TechnicalAnalysis, Timeframe } from '@aktien/core';
import { appStorage, TOKEN_KEY } from './storage';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }

  /** Fehler, bei denen ein erneuter Versuch keinen Sinn hat. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export const UNAUTHORIZED_EVENT = 'aktien:unauthorized';
/** Wird ausgelöst, sobald nach einem 401 wieder eine Anfrage gelingt (Token wurde korrigiert): blendet den Hinweis aus. */
export const AUTHORIZED_EVENT = 'aktien:authorized';
let unauthorizedShown = false;

export interface QuoteResult {
  ticker: string;
  quote?: Quote;
  error?: { code: string; message: string };
}

export interface NewsResponse {
  items: NewsItem[];
  errors: { adapter: string; code: string; message: string }[];
}

export function getToken(): string {
  return appStorage.getItem(TOKEN_KEY) ?? '';
}

export async function apiGet<T>(
  route: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(`/api/${route}?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('NETWORK', 'Keine Verbindung zum Server', 0);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      unauthorizedShown = true;
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(body?.error?.code ?? 'HTTP', body?.error?.message ?? `Fehler ${res.status}`, res.status);
  }
  if (unauthorizedShown) {
    unauthorizedShown = false;
    window.dispatchEvent(new Event(AUTHORIZED_EVENT));
  }
  return body as T;
}

export interface HealthResponse {
  ok: boolean;
  authRequired: boolean;
  ai: { configured: boolean; providers: string[]; storage: 'supabase' | 'memory' };
}

export type TechnicalEnvelope = Envelope<TechnicalAnalysis>;
export type NewsEnvelope = Envelope<NewsAnalysis>;
export type NewsItemEnvelope = Envelope<NewsItemDetail>;

export const api = {
  health: () => apiGet<HealthResponse>('health'),
  analysis: (ticker: string, name: string | undefined, lang: Lang, refresh = false) => apiGet<TechnicalEnvelope>('analysis', { s: ticker, name, lang, refresh: refresh ? 1 : undefined }),
  newsAnalysis: (ticker: string, name: string | undefined, lang: Lang, refresh = false) => apiGet<NewsEnvelope>('news-analysis', { s: ticker, name, lang, refresh: refresh ? 1 : undefined }),
  newsItem: (ticker: string, id: string, name: string | undefined, lang: Lang, refresh = false) => apiGet<NewsItemEnvelope>('news-item', { s: ticker, id, name, lang, refresh: refresh ? 1 : undefined }),
  quotes: (tickers: string[]) => apiGet<{ results: QuoteResult[] }>('quote', { s: tickers.join(',') }),
  candles: (ticker: string, tf: Timeframe) => apiGet<CandleSeries>('candles', { s: ticker, tf }),
  history: (ticker: string) => apiGet<CandleSeries>('history', { s: ticker }),
  news: (ticker: string, name?: string) => apiGet<NewsResponse>('news', { s: ticker, name }),
  search: (q: string) => apiGet<{ results: SearchResult[] }>('search', { q }),
  fundSearch: (q: string) => apiGet<{ results: FundSearchResult[] }>('fund-search', { q }),
  fund: (code: string) => apiGet<Fund>('fund', { code }),
  fundHistory: (code: string, period: FundPeriod) => apiGet<FundPricePoint[]>('fund-history', { code, period }),
  fundBenchmark: (code: string, period: FundPeriod) => apiGet<FundBenchmarkPoint[]>('fund-benchmark', { code, period }),
};
