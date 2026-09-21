import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { Instrument, NewsItem } from '../../types';
import { applyQuery } from './query';
import type { NewsAdapter, NewsQuery } from './types';

const ID = 'finnhub-news';

const listSchema = z.array(
  z.object({
    id: z.number(),
    datetime: z.number(), // Unix-Sekunden
    headline: z.string(),
    summary: z.string().optional(),
    source: z.string().optional(),
    url: z.string(),
  }),
);

export interface FinnhubNewsOptions extends HttpOptions {
  apiKey: string;
  lookbackDays?: number;
  now?: () => number;
}

/** Finnhub Company News (Free: nur US-Titel). Key im Header, nicht in der URL. */
export class FinnhubNewsAdapter implements NewsAdapter {
  readonly id = ID;

  constructor(private readonly opts: FinnhubNewsOptions) {
    if (!opts.apiKey) throw new AdapterError('CONFIG', 'FINNHUB_API_KEY fehlt', ID);
  }

  supports(instrument: Instrument): boolean {
    return instrument.market === 'US';
  }

  async getNews(instrument: Instrument, query: NewsQuery = {}): Promise<NewsItem[]> {
    const now = this.opts.now?.() ?? Date.now();
    const from = new Date(query.since ?? now - (this.opts.lookbackDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(now).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(instrument.symbol)}&from=${from}&to=${to}`;

    const res = await request(url, { headers: { 'X-Finnhub-Token': this.opts.apiKey } }, ID, this.opts, { unauthorized: 'CONFIG' });
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);
    const parsed = listSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes News-Format', ID);

    const items: NewsItem[] = parsed.data
      .map((n) => ({
        id: `fh:${n.id}`,
        symbol: instrument.symbol,
        kind: 'news' as const,
        title: n.headline.trim(),
        summary: n.summary?.trim() || undefined,
        url: n.url,
        source: n.source ?? 'Finnhub',
        publishedAt: n.datetime * 1000,
        language: 'en' as const,
      }))
      .sort((a, b) => b.publishedAt - a.publishedAt);
    return applyQuery(items, query);
  }
}
