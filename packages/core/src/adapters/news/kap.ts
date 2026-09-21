import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { Instrument, NewsItem } from '../../types';
import { applyQuery } from './query';
import type { NewsAdapter, NewsQuery } from './types';

const ID = 'kap';
const BASE = 'https://www.kap.org.tr';
const DAY_MS = 86_400_000;
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;
/** KAP kappt Antworten bei 2000 Einträgen (~9 Tage). Kleine Fenster vermeiden Datenverlust. */
const WINDOW_DAYS = 3;

const disclosureSchema = z.object({
  publishDate: z.string(), // "21.09.2026 10:47:09" (Istanbuler Zeit)
  kapTitle: z.string().nullable().optional(),
  disclosureClass: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  relatedStocks: z.string().nullable().optional(), // "THYAO" oder "AKFYE, AKSEN, …"
  disclosureIndex: z.number(),
  modifyStatus: z.string().nullable().optional(),
});
const listSchema = z.array(disclosureSchema);

export type KapDisclosure = z.infer<typeof disclosureSchema>;

export interface KapOptions extends HttpOptions {
  /** Standard-Rückblick, wenn `since` fehlt. */
  defaultLookbackDays?: number;
  now?: () => number;
}

/**
 * Offizielle KAP-Meldungen (Kamuyu Aydınlatma Platformu) über die JSON-Schnittstelle der Webseite.
 * Inoffiziell und ohne Zusage: Format, Rate-Limits und Zugriff aus Rechenzentren können sich ändern.
 * Die Schnittstelle liefert alle Unternehmen; wir filtern clientseitig nach `relatedStocks`.
 */
export class KapAdapter implements NewsAdapter {
  readonly id = ID;

  constructor(private readonly opts: KapOptions = {}) {}

  supports(instrument: Instrument): boolean {
    return instrument.market === 'BIST';
  }

  async getNews(instrument: Instrument, query: NewsQuery = {}): Promise<NewsItem[]> {
    const map = await this.getNewsBatch([instrument], query);
    return map.get(instrument.symbol.toUpperCase()) ?? [];
  }

  /** Ein Abruf für mehrere Aktien (spart Requests im Monitor). Schlüssel: Kürzel in Großbuchstaben. */
  async getNewsBatch(instruments: readonly Instrument[], query: NewsQuery = {}): Promise<Map<string, NewsItem[]>> {
    const wanted = new Set(instruments.filter((i) => this.supports(i)).map((i) => i.symbol.toUpperCase()));
    const result = new Map<string, NewsItem[]>([...wanted].map((s) => [s, []]));
    if (wanted.size === 0) return result;

    const now = this.opts.now?.() ?? Date.now();
    const since = query.since ?? now - (this.opts.defaultLookbackDays ?? 3) * DAY_MS;

    const seen = new Set<number>();
    for (const [from, to] of windows(since, now)) {
      for (const d of await this.fetchWindow(from, to)) {
        if (seen.has(d.disclosureIndex)) continue;
        seen.add(d.disclosureIndex);
        const item = toNewsItems(d, wanted);
        for (const n of item) result.get(n.symbol)!.push(n);
      }
    }
    for (const [symbol, items] of result) {
      result.set(symbol, applyQuery(items.sort((a, b) => b.publishedAt - a.publishedAt), query));
    }
    return result;
  }

  private async fetchWindow(from: string, to: string): Promise<KapDisclosure[]> {
    const res = await request(
      `${BASE}/tr/api/disclosure/members/byCriteria`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: `${BASE}/tr/bildirim-sorgu`,
          'User-Agent': 'Mozilla/5.0',
          'Accept-Language': 'tr-TR,tr;q=0.9',
        },
        body: JSON.stringify({ fromDate: from, toDate: to, mkkMemberOidList: [], subjectList: [] }),
      },
      ID,
      this.opts,
    );
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);
    const parsed = listSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes KAP-Format', ID);
    if (parsed.data.length >= 2000) {
      // Cap erreicht: ältere Meldungen dieses Fensters fehlen möglicherweise. Lieber laut als still.
      throw new AdapterError('BAD_RESPONSE', `KAP-Antwort am 2000er-Limit (${from}..${to}); Zeitfenster verkleinern`, ID);
    }
    return parsed.data;
  }
}

/** Zerlegt [since, now] in Fenster von höchstens WINDOW_DAYS Tagen als "YYYY-MM-DD"-Paare (Istanbuler Datum). */
export function windows(sinceMs: number, nowMs: number): [string, string][] {
  const out: [string, string][] = [];
  let start = sinceMs;
  while (start <= nowMs) {
    const end = Math.min(start + (WINDOW_DAYS - 1) * DAY_MS, nowMs);
    out.push([istanbulDate(start), istanbulDate(end)]);
    start = end + DAY_MS;
  }
  return out;
}

function istanbulDate(ms: number): string {
  return new Date(ms + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** "21.09.2026 10:47:09" (Istanbuler Zeit) → Unix-Millisekunden (UTC). */
export function parseKapDate(value: string): number | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  return Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - ISTANBUL_OFFSET_MS;
}

function toNewsItems(d: KapDisclosure, wanted: ReadonlySet<string>): NewsItem[] {
  const publishedAt = parseKapDate(d.publishDate);
  if (publishedAt === null || !d.relatedStocks) return [];
  const codes = d.relatedStocks.split(',').map((s) => s.trim().toUpperCase());
  const title = (d.summary || d.subject || d.kapTitle || '').trim();
  if (!title) return [];

  return codes
    .filter((c) => wanted.has(c))
    .map((symbol) => ({
      id: `kap:${d.disclosureIndex}:${symbol}`,
      symbol,
      kind: 'kap' as const,
      title,
      summary: d.summary?.trim() || undefined,
      url: `${BASE}/tr/Bildirim/${d.disclosureIndex}`,
      source: 'KAP',
      publishedAt,
      language: 'tr' as const,
      category: d.subject?.trim() || undefined,
    }));
}
