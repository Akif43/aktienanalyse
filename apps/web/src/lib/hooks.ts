import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { marketState, MARKET_CURRENCY, type FundPeriod, type Timeframe } from '@aktien/core';
import { FX_SYMBOL } from './currency';
import { useLang } from './i18n';
import type { PortfolioPosition } from './portfolio-store';
import { api, ApiError, type NewsEnvelope, type NewsItemEnvelope, type QuoteResult, type TechnicalEnvelope } from './api';
import { appStorage, QUOTES_CACHE_KEY } from './storage';

const FAST_POLL_MS = 30_000;
const SLOW_POLL_MS = 5 * 60_000;

/** Öffnet mindestens eine Börse: schnell aktualisieren, sonst nur gelegentlich. */
export function pollInterval(results: QuoteResult[] | undefined, nowMs: number = Date.now()): number {
  if (!results || results.length === 0) return FAST_POLL_MS;
  const anyOpen = results.some((r) => r.quote && marketState(r.quote, nowMs) === 'open');
  return anyOpen ? FAST_POLL_MS : SLOW_POLL_MS;
}

function readQuotesCache(tickers: string[]): QuoteResult[] | undefined {
  try {
    const parsed = JSON.parse(appStorage.getItem(QUOTES_CACHE_KEY) ?? 'null') as QuoteResult[] | null;
    if (!Array.isArray(parsed)) return undefined;
    const wanted = new Set(tickers);
    const hits = parsed.filter((r) => wanted.has(r.ticker) && r.quote);
    return hits.length ? hits : undefined;
  } catch {
    return undefined;
  }
}

function writeQuotesCache(results: QuoteResult[]): void {
  try {
    const old = JSON.parse(appStorage.getItem(QUOTES_CACHE_KEY) ?? '[]') as QuoteResult[];
    const merged = new Map<string, QuoteResult>((Array.isArray(old) ? old : []).map((r) => [r.ticker, r]));
    for (const r of results) if (r.quote) merged.set(r.ticker, r);
    appStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify([...merged.values()].slice(-60)));
  } catch {
    /* Cache ist optional */
  }
}

export function useQuotes(tickers: string[]) {
  return useQuery({
    queryKey: ['quotes', ...tickers],
    enabled: tickers.length > 0,
    queryFn: async () => {
      const { results } = await api.quotes(tickers);
      writeQuotesCache(results);
      return results;
    },
    refetchInterval: (q) => pollInterval(q.state.data),
    staleTime: 10_000,
    // Beim Kaltstart sofort die zuletzt bekannten Kurse zeigen, bis die frischen da sind
    placeholderData: (prev) => prev ?? readQuotesCache(tickers),
  });
}

/** 6M und 1J werden aus den Tageskerzen geschnitten (Indikatoren brauchen Vorlauf), der Rest kommt direkt von der Quelle. */
export const usesDailyHistory = (tf: Timeframe) => tf === '6M' || tf === '1J';

export function useChartSeries(ticker: string, tf: Timeframe) {
  const source = usesDailyHistory(tf) ? 'history' : tf;
  return useQuery({
    queryKey: ['chart', ticker, source],
    queryFn: () => (source === 'history' ? api.history(ticker) : api.candles(ticker, tf)),
    staleTime: tf === '1T' ? 30_000 : 5 * 60_000,
    refetchInterval: tf === '1T' ? 60_000 : SLOW_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/** Tageskerzen für die technische Auswertung (unabhängig vom gewählten Zeitraum). */
export function useHistory(ticker: string, enabled = true) {
  return useQuery({ queryKey: ['chart', ticker, 'history'], queryFn: () => api.history(ticker), staleTime: 5 * 60_000, enabled });
}

export function useNews(ticker: string, name?: string) {
  return useQuery({ queryKey: ['news', ticker, name ?? ''], queryFn: () => api.news(ticker, name), staleTime: 5 * 60_000 });
}

/**
 * KI-Einschätzung. Bewusst ohne automatische Wiederholung und ohne Neuabruf beim Zurückkehren in die App:
 * jede Abfrage kann eine KI-Anfrage auslösen, und das Gratis-Kontingent ist knapp. Der Server cacht ohnehin.
 */
export function useAnalysis(ticker: string, name?: string) {
  const lang = useLang();
  return useQuery({
    queryKey: ['analysis', ticker, lang],
    queryFn: () => api.analysis(ticker, name, lang),
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useNewsAnalysis(ticker: string, name: string | undefined, enabled: boolean) {
  const lang = useLang();
  return useQuery({
    queryKey: ['news-analysis', ticker, lang],
    queryFn: () => api.newsAnalysis(ticker, name, lang),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Erklärung einer einzelnen Meldung. Wird erst beim Antippen abgerufen, ohne Wiederholung und ohne Neuabruf beim Zurückkehren:
 * jede neue Meldung kostet eine KI-Anfrage, der Server speichert das Ergebnis je Meldung und Sprache.
 */
export function useNewsItem(ticker: string, name: string | undefined, id: string | undefined) {
  const lang = useLang();
  return useQuery({
    queryKey: ['news-item', ticker, id, lang],
    queryFn: () => api.newsItem(ticker, id!, name, lang),
    enabled: Boolean(id),
    staleTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshNewsItem(ticker: string, name: string | undefined, id: string) {
  const client = useQueryClient();
  const lang = useLang();
  return useMutation<NewsItemEnvelope, Error, void>({
    mutationFn: () => api.newsItem(ticker, id, name, lang, true),
    onSuccess: (data) => client.setQueryData(['news-item', ticker, id, lang], data),
  });
}

/** Erzwingt eine neue Auswertung (Mindestabstand serverseitig) und ersetzt das zwischengespeicherte Ergebnis. */
export function useRefreshAnalysis(kind: 'analysis' | 'news-analysis', ticker: string, name?: string) {
  const client = useQueryClient();
  const lang = useLang();
  return useMutation<TechnicalEnvelope | NewsEnvelope, Error, void>({
    mutationFn: () => (kind === 'analysis' ? api.analysis(ticker, name, lang, true) : api.newsAnalysis(ticker, name, lang, true)),
    onSuccess: (data) => client.setQueryData([kind, ticker, lang], data),
  });
}

export function useSearch(term: string) {
  const q = term.trim();
  return useQuery({
    queryKey: ['search', q.toLowerCase()],
    enabled: q.length >= 1,
    queryFn: async () => (await api.search(q)).results,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export const shouldRetry = (count: number, err: unknown): boolean => !(err instanceof ApiError && err.permanent) && count < 2;

// --- Fonds (TEFAS) -------------------------------------------------------------------------

export function useFundSearch(term: string) {
  const q = term.trim();
  return useQuery({
    queryKey: ['fund-search', q.toLocaleLowerCase('tr')],
    enabled: q.length >= 1,
    queryFn: async () => (await api.fundSearch(q)).results,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Aktueller Fondspreis samt Kennzahlen. TEFAS wertet einmal täglich aus: kein schnelles Polling nötig. */
export function useFund(code: string) {
  return useQuery({ queryKey: ['fund', code], queryFn: () => api.fund(code), staleTime: 10 * 60_000, refetchInterval: SLOW_POLL_MS });
}

export function useFundHistory(code: string, period: FundPeriod) {
  return useQuery({ queryKey: ['fund-history', code, period], queryFn: () => api.fundHistory(code, period), staleTime: 10 * 60_000, placeholderData: keepPreviousData });
}

export function useFundBenchmark(code: string, period: FundPeriod) {
  return useQuery({ queryKey: ['fund-benchmark', code, period], queryFn: () => api.fundBenchmark(code, period), staleTime: 10 * 60_000, placeholderData: keepPreviousData });
}

// --- Depot -----------------------------------------------------------------------------------

/**
 * Aktuelle Kurse für alle Depot-Positionen (Aktien über einen gemeinsamen Kursabruf, Fonds einzeln) sowie die
 * Wechselkurse, die für die Umrechnung nach Lira gebraucht werden. Teilt sich den Zwischenspeicher mit der
 * Watchlist bzw. den Fonds-Detailseiten (gleiche Query-Schlüssel).
 */
export function usePortfolioPrices(positions: readonly PortfolioPosition[]) {
  const stocks = positions.filter((p) => p.kind === 'stock');
  const funds = positions.filter((p) => p.kind === 'fund');
  const currencies = new Set(stocks.map((p) => (p.market ? MARKET_CURRENCY[p.market] : 'TRY')));
  const fxTickers = [...(currencies.has('USD') ? [FX_SYMBOL.USD] : []), ...(currencies.has('EUR') ? [FX_SYMBOL.EUR] : [])];
  const quotes = useQuotes([...stocks.map((p) => p.key), ...fxTickers]);
  const fundResults = useQueries({
    queries: funds.map((p) => ({ queryKey: ['fund', p.key], queryFn: () => api.fund(p.key), staleTime: 10 * 60_000 })),
  });

  const priceByKey = new Map<string, number | null>();
  for (const r of quotes.data ?? []) priceByKey.set(r.ticker, r.quote?.price ?? null);
  funds.forEach((p, i) => priceByKey.set(p.key, fundResults[i]?.data?.price ?? null));

  const rate = (ticker: string) => quotes.data?.find((r) => r.ticker === ticker)?.quote?.price ?? null;
  const fx = { USD: currencies.has('USD') ? rate(FX_SYMBOL.USD) : null, EUR: currencies.has('EUR') ? rate(FX_SYMBOL.EUR) : null };
  // enabled:false lässt useQuery dauerhaft "pending": nur mitzählen, wenn überhaupt Aktien/Wechselkurse abgefragt werden
  const stocksPending = (stocks.length > 0 || fxTickers.length > 0) && quotes.isPending;
  const isPending = stocksPending || fundResults.some((r) => r.isPending);
  return { priceByKey, fx, isPending };
}
