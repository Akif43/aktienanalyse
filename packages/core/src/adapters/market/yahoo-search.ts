import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { Market } from '../../types';

const ID = 'yahoo-search';

/** Yahoo-Börsenkürzel → unser Markt. Alles andere (OTC, Frankfurt, Toronto …) wird ausgeblendet. */
const EXCHANGE_TO_MARKET: Record<string, Market> = {
  IST: 'BIST',
  GER: 'XETRA',
  NMS: 'US',
  NGM: 'US',
  NCM: 'US',
  NYQ: 'US',
  ASE: 'US',
  PCX: 'US',
  BTS: 'US',
};

const MARKET_LABEL: Record<Market, string> = { BIST: 'Borsa Istanbul', XETRA: 'XETRA', US: 'US-Börse' };

const responseSchema = z.object({
  quotes: z
    .array(
      z.object({
        symbol: z.string(),
        exchange: z.string().optional(),
        quoteType: z.string().optional(),
        shortname: z.string().nullish(),
        longname: z.string().nullish(),
      }),
    )
    .default([]),
});

export interface SearchResult {
  /** Kürzel ohne Yahoo-Suffix, z. B. THYAO. */
  symbol: string;
  market: Market;
  name: string;
  /** Vollständiger Yahoo-Ticker, z. B. THYAO.IS. */
  ticker: string;
  marketLabel: string;
}

/** Sucht Aktien bei Yahoo und beschränkt die Treffer auf BIST, XETRA und US-Börsen. */
export async function searchInstruments(query: string, opts: HttpOptions = {}): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 1 || q.length > 40) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, ID, opts);
  if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes Such-Format', ID);

  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of parsed.data.quotes) {
    const market = r.exchange ? EXCHANGE_TO_MARKET[r.exchange] : undefined;
    if (!market || r.quoteType !== 'EQUITY' || seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    const suffix = market === 'BIST' ? /\.IS$/ : market === 'XETRA' ? /\.DE$/ : null;
    out.push({
      symbol: suffix ? r.symbol.replace(suffix, '') : r.symbol,
      market,
      name: cleanName(r.longname || r.shortname || r.symbol),
      ticker: r.symbol,
      marketLabel: MARKET_LABEL[market],
    });
  }
  return out;
}

/** Bereinigt Yahoo-Namen (mehrfache Leerzeichen, abgeschnittene Zusätze wie "I"). */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
