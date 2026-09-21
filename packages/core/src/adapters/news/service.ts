import { AdapterError } from '../../errors';
import type { HttpOptions } from '../../http';
import type { Instrument, NewsItem } from '../../types';
import { FinnhubNewsAdapter } from './finnhub-news';
import { GoogleNewsRssAdapter } from './google-news-rss';
import { KapAdapter } from './kap';
import { applyQuery } from './query';
import type { NewsAdapter, NewsQuery } from './types';

export interface NewsResult {
  items: NewsItem[];
  /** Fehler einzelner Quellen. Die übrigen Quellen liefern trotzdem. */
  errors: AdapterError[];
}

/** Fragt alle passenden Quellen parallel ab, führt sie zusammen und entfernt Dubletten. */
export class NewsService {
  constructor(private readonly adapters: readonly NewsAdapter[]) {}

  async getNews(instrument: Instrument, query: NewsQuery = {}): Promise<NewsResult> {
    const active = this.adapters.filter((a) => a.supports(instrument));
    const settled = await Promise.allSettled(active.map((a) => a.getNews(instrument, { since: query.since })));

    const items: NewsItem[] = [];
    const errors: AdapterError[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') items.push(...r.value);
      else {
        const err = r.reason;
        errors.push(err instanceof AdapterError ? err : new AdapterError('UPSTREAM', String(err?.message ?? err), active[i]!.id, err));
      }
    });
    return { items: applyQuery(dedupe(items), query), errors };
  }
}

/** Entfernt Meldungen mit gleicher ID oder (fast) gleichem Titel. Reihenfolge = Priorität der Adapter (KAP zuerst). */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (seen.has(item.id) || seen.has(key)) continue;
    seen.add(item.id);
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

function normalizeTitle(title: string): string {
  return `t:${title.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}

export interface NewsConfig extends HttpOptions {
  finnhubApiKey?: string;
  lookbackDays?: number;
}

/** Standard: KAP (BIST) → Finnhub (US, falls Key) → Google News RSS (alle Märkte). */
export function createNewsService(config: NewsConfig = {}): NewsService {
  const { finnhubApiKey, lookbackDays, ...http } = config;
  const adapters: NewsAdapter[] = [new KapAdapter({ ...http, defaultLookbackDays: lookbackDays })];
  if (finnhubApiKey) adapters.push(new FinnhubNewsAdapter({ ...http, apiKey: finnhubApiKey, lookbackDays }));
  adapters.push(new GoogleNewsRssAdapter({ ...http, lookbackDays }));
  return new NewsService(adapters);
}
