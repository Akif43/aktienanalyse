import { XMLParser } from 'fast-xml-parser';
import { AdapterError } from '../../errors';
import { hashString } from '../../hash';
import { request, type HttpOptions } from '../../http';
import type { Instrument, Market, NewsItem } from '../../types';
import { applyQuery } from './query';
import type { NewsAdapter, NewsQuery } from './types';

const ID = 'google-news';

const EDITIONS: Record<Market, { hl: string; gl: string; ceid: string; language: NewsItem['language'] }> = {
  BIST: { hl: 'tr', gl: 'TR', ceid: 'TR:tr', language: 'tr' },
  XETRA: { hl: 'de', gl: 'DE', ceid: 'DE:de', language: 'de' },
  US: { hl: 'en-US', gl: 'US', ceid: 'US:en', language: 'en' },
};

export interface GoogleNewsOptions extends HttpOptions {
  /** Suchfenster in Tagen (Google-Operator `when:Nd`). */
  lookbackDays?: number;
  /** Eigene Suchanfrage je Instrument, z. B. wenn der Firmenname allein zu viel Rauschen bringt. */
  queryOverride?: (instrument: Instrument) => string | undefined;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

/**
 * Google News RSS. Liefert Titel, Link, Quelle und Datum, aber keine Volltexte. Der Feed ist laut
 * Google nur für den persönlichen, nichtkommerziellen Gebrauch gedacht.
 */
export class GoogleNewsRssAdapter implements NewsAdapter {
  readonly id = ID;
  readonly kind = 'news' as const;

  constructor(private readonly opts: GoogleNewsOptions = {}) {}

  supports(): boolean {
    return true;
  }

  async getNews(instrument: Instrument, query: NewsQuery = {}): Promise<NewsItem[]> {
    const ed = EDITIONS[instrument.market];
    const days = this.opts.lookbackDays ?? 7;
    const q = `${this.searchTerm(instrument)} when:${days}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${encodeURIComponent(ed.ceid)}`;

    const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, ID, this.opts);
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);
    const items = parseRss(await res.text(), instrument.symbol, ed.language);
    return applyQuery(items, query);
  }

  private searchTerm(instrument: Instrument): string {
    const override = this.opts.queryOverride?.(instrument);
    if (override) return override;
    const name = instrument.name?.replace(/"/g, '').trim();
    // BIST: Das Kürzel steht in jeder Rangliste ("meistgekaufte Aktien der Woche"). Gemessen bestanden damit ca. 70 % der Treffer
    // aus solchem Rauschen, mit dem Firmennamen in Anführungszeichen nur ca. 1 %. Ohne Namen bleibt nur das Kürzel.
    if (instrument.market === 'BIST' && name) return `"${name}"`;
    return [name, instrument.symbol].filter(Boolean).join(' ');
  }
}

/** Zerlegt einen Google-News-RSS-Feed. Exportiert für Tests. */
export function parseRss(xml: string, symbol: string, language: NewsItem['language']): NewsItem[] {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new AdapterError('BAD_RESPONSE', 'RSS ist kein gültiges XML', ID, err);
  }
  const channel = doc?.rss?.channel;
  if (!channel) throw new AdapterError('BAD_RESPONSE', 'RSS ohne channel', ID);
  const raw = channel.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];

  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const link = String(it.link ?? '').trim();
    const rawTitle = String(it.title ?? '').trim();
    const published = Date.parse(String(it.pubDate ?? ''));
    if (!link || !rawTitle || Number.isNaN(published)) continue;

    const source = typeof it.source === 'object' ? String(it.source['#text'] ?? '').trim() : String(it.source ?? '').trim();
    // Google hängt " - Quelle" an den Titel an.
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;

    const id = `gn:${hashString(link)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, symbol, kind: 'news', title, url: link, source: source || 'Google News', publishedAt: published, language });
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}
