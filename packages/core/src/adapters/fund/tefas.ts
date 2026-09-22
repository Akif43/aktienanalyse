import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import { round } from '../../indicators/series';
import type { Fund, FundAdapter, FundBenchmarkPoint, FundCode, FundPeriod, FundPricePoint, FundSearchResult } from './types';

const ID = 'tefas';
const BASE = 'https://www.tefas.gov.tr/api/funds';

/** TEFAS kennt keinen Zeitraum "Woche": wir holen einen Monat und schneiden auf die letzten 7 Tage zu. */
const PERIOD_MONTHS: Record<FundPeriod, number> = { week: 1, month: 1, '3month': 3, '6month': 6, ytd: 0, year: 12, '3year': 36, '5year': 60 };
const WEEK_DAYS = 7;

const HEADERS = { 'Content-Type': 'application/json;charset=UTF-8' };

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, opts: HttpOptions): Promise<T> {
  const res = await request(`${BASE}/${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }, ID, { retries: 1, timeoutMs: 12_000, ...opts });
  if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status} von TEFAS (${path})`, ID);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AdapterError('BAD_RESPONSE', `Unerwartetes TEFAS-Format (${path})`, ID);
  return parsed.data;
}

// --- Schemata der TEFAS-JSON-API (inoffiziell, nicht dokumentiert) -----------------------------

const directorySchema = z.object({ resultList: z.array(z.object({ fonKodu: z.string(), fonUnvan: z.string() })).nullish() });

const infoSchema = z.object({
  resultList: z
    .array(
      z.object({
        fonKodu: z.string(),
        fonUnvan: z.string(),
        sonFiyat: z.number(),
        gunlukGetiri: z.number().nullish(),
        fonKategori: z.string().nullish(),
        kategoriDerece: z.number().nullish(),
        kategoriFonSay: z.number().nullish(),
        yatirimciSayi: z.number().nullish(),
        pazarPayi: z.number().nullish(),
      }),
    )
    .nullish(),
});

const priceSchema = z.object({ resultList: z.array(z.object({ tarih: z.string(), fiyat: z.number() })).nullish() });

const profileSchema = z.object({ resultList: z.array(z.object({ fonKodu: z.string(), fonUnvan: z.string(), fonTuru: z.string(), fonTurGetiri: z.number() })).nullish() });

/**
 * Türkische Investment-/Rentenfonds über die inoffizielle JSON-API von TEFAS (Türkiye Elektronik Fon Alım Satım
 * Platformu). Anders als bei den Aktienquellen ist hier bewusst keine Fallback-Quelle vorgesehen: TEFAS ist die
 * offizielle Handelsplattform für Fonds in der Türkei, es gibt keine gleichwertige Alternative.
 */
export class TefasAdapter implements FundAdapter {
  readonly id = ID;
  // Das komplette Fondsverzeichnis (ca. 2.600 Fonds, keine Sucheingabe möglich) wird selten gebraucht,
  // aber bei jeder Suche neu genutzt: einmal je Prozess laden und kurz zwischenspeichern.
  private directory: Promise<FundSearchResult[]> | null = null;
  private directoryAt = 0;

  constructor(private readonly opts: HttpOptions & { now?: () => number; directoryTtlMs?: number } = {}) {}

  private async loadDirectory(): Promise<FundSearchResult[]> {
    const now = this.opts.now?.() ?? Date.now();
    const ttl = this.opts.directoryTtlMs ?? 6 * 3_600_000;
    if (!this.directory || now - this.directoryAt > ttl) {
      this.directoryAt = now;
      this.directory = post('fonUnvanAra', { unvan: '', dil: 'TR' }, directorySchema, this.opts).then((r) =>
        (r.resultList ?? []).map((f) => ({ code: f.fonKodu.toUpperCase(), name: cleanName(f.fonUnvan) })),
      );
      this.directory.catch(() => {
        this.directory = null; // Fehlschlag nicht dauerhaft merken: nächster Aufruf versucht es erneut
      });
    }
    return this.directory;
  }

  async search(query: string): Promise<FundSearchResult[]> {
    const q = query.trim().toLocaleUpperCase('tr');
    if (q.length < 1 || q.length > 60) return [];
    const all = await this.loadDirectory();
    // Kürzel-Treffer zuerst (genau, dann beginnt-mit), danach Namenstreffer
    const codeExact = all.filter((f) => f.code === q);
    const codeStarts = all.filter((f) => f.code !== q && f.code.startsWith(q));
    const nameMatch = all.filter((f) => f.code !== q && !f.code.startsWith(q) && f.name.toLocaleUpperCase('tr').includes(q));
    return [...codeExact, ...codeStarts, ...nameMatch].slice(0, 25);
  }

  async getFund(code: FundCode): Promise<Fund> {
    const r = await post('fonBilgiGetir', { fonKodu: code.toUpperCase(), dil: 'TR' }, infoSchema, this.opts);
    const f = r.resultList?.[0];
    if (!f) throw new AdapterError('NOT_FOUND', `Fonds "${code}" nicht gefunden`, ID);
    return {
      code: f.fonKodu.toUpperCase(),
      name: cleanName(f.fonUnvan),
      category: f.fonKategori?.trim() || null,
      price: f.sonFiyat,
      dailyChangePercent: f.gunlukGetiri ?? null,
      categoryRank: f.kategoriDerece ?? null,
      categoryFundCount: f.kategoriFonSay ?? null,
      investorCount: f.yatirimciSayi ?? null,
      marketSharePercent: f.pazarPayi ?? null,
      asOf: todayIstanbul(),
    };
  }

  async getHistory(code: FundCode, period: FundPeriod): Promise<FundPricePoint[]> {
    const r = await post('fonFiyatBilgiGetir', { fonKodu: code.toUpperCase(), dil: 'TR', periyod: PERIOD_MONTHS[period] }, priceSchema, this.opts);
    const points = (r.resultList ?? []).map((p) => ({ date: p.tarih, price: p.fiyat })).sort((a, b) => a.date.localeCompare(b.date));
    if (period !== 'week') return points;
    const cutoff = points.at(-1) ? addDays(points.at(-1)!.date, -WEEK_DAYS) : null;
    return cutoff ? points.filter((p) => p.date >= cutoff) : points;
  }

  async getBenchmark(code: FundCode, period: FundPeriod): Promise<FundBenchmarkPoint[]> {
    const r = await post('fonProfilDtyGetir', { fonKodu: code.toUpperCase(), dil: 'TR', periyod: period === 'week' ? PERIOD_MONTHS.month : PERIOD_MONTHS[period] }, profileSchema, this.opts);
    let fund: FundBenchmarkPoint | null = null;
    const rest: FundBenchmarkPoint[] = [];
    for (const row of r.resultList ?? []) {
      if (row.fonKodu === code.toUpperCase()) {
        fund = { kind: 'fund', label: cleanName(row.fonUnvan), returnPercent: round(row.fonTurGetiri * 100)! };
        continue;
      }
      const kind = BENCHMARK_KIND[row.fonKodu];
      rest.push(
        kind
          ? { kind, label: BENCHMARK_LABEL[kind], returnPercent: round(row.fonTurGetiri * 100)! }
          : { kind: 'category', label: cleanName(row.fonTuru), returnPercent: round(row.fonTurGetiri * 100)! },
      );
    }
    // TEFAS liefert die Reihenfolge nicht verlässlich; der Fonds selbst gehört an den Anfang des Vergleichs
    return fund ? [fund, ...rest] : rest;
  }
}

type IndexKind = Exclude<FundBenchmarkPoint['kind'], 'fund' | 'category'>;
const BENCHMARK_KIND: Record<string, IndexKind | undefined> = {
  ALTIN: 'gold',
  BIST100: 'bist100',
  BIST30: 'bist30',
  TUFE: 'cpi',
  USD: 'usd',
  EUR: 'eur',
  'MEVDUAT FAIZI': 'deposit',
};
const BENCHMARK_LABEL: Record<IndexKind, string> = { gold: 'Altın', bist100: 'BIST 100', bist30: 'BIST 30', cpi: 'TÜFE', usd: 'USD', eur: 'EUR', deposit: 'Mevduat Faizi' };

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function todayIstanbul(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
