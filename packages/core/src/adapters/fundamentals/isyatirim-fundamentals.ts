import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';

const ID = 'isyatirim-fundamentals';
const ENDPOINT = 'https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo';

// İş Yatırım liefert die Beträge als Zeichenketten ("513912099203"), teils auch als Zahl.
const num = z.union([z.number(), z.string()]).nullable().optional();
const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const rowSchema = z.object({ itemCode: z.string(), value1: num, value2: num, value3: num, value4: num });
const responseSchema = z.object({ ok: z.boolean(), errorDescription: z.string().nullable().optional(), value: z.array(rowSchema).nullable() });

/** itemCodes der Gewinn- und Verlustrechnung bzw. Bilanz (Industrieunternehmen, financialGroup XI_29). */
const CODE = {
  netIncome: '3Z', // Jahresüberschuss, Anteil der Muttergesellschaft
  operatingProfit: '3DF',
  equity: '2O', // Eigenkapital der Muttergesellschaft
  shareCapital: '2OA', // Grundkapital, bei 1 TL Nennwert gleich der Aktienzahl
  shortLoans: '2AA',
  longLoans: '2BA',
  cash: '1AA',
  shortInvestments: '1AB',
} as const;

export interface IsYatirimYear {
  year: number;
  netIncome: number;
  operatingProfit: number | null;
}

export interface IsYatirimStatements {
  years: IsYatirimYear[];
  /** Werte des jüngsten Geschäftsjahres in TL. */
  shares: number | null;
  netDebt: number | null;
  equity: number | null;
}

/** Höchstzahl Blöcke à 4 Jahre pro Abruf: 3 Blöcke = 12 Jahre (İş Yatırım reicht bis ca. FY2008, das ist mehr als nötig). */
export const IS_YATIRIM_MAX_BLOCKS = 3;

/**
 * Bilanzdaten für BIST-Unternehmen von İş Yatırım (öffentlicher, inoffizieller Endpoint, ohne Key). Je Aufruf
 * kommen 4 Geschäftsjahre in TL (auch bei Unternehmen, die in USD berichten, dann umgerechnet). Bis zu drei
 * Aufrufe ergeben 12 Jahre; ein leerer oder fehlgeschlagener älterer Block beendet das Nachladen. Banken und
 * Versicherungen haben eine andere Struktur (`UFRS_K`) und liefern hier nichts.
 */
export class IsYatirimFundamentals {
  constructor(private readonly opts: HttpOptions = {}) {}

  /** `blocks = 1` holt nur die jüngsten 4 Jahre (wenn ältere Jahre schon gespeichert sind). */
  async getStatements(symbol: string, lastYear: number, blocks: number = IS_YATIRIM_MAX_BLOCKS): Promise<IsYatirimStatements> {
    const fetched: Map<number, Map<string, number | null>>[] = [];
    for (let i = 0; i < Math.max(1, blocks); i++) {
      const first = lastYear - 4 * i;
      const yearList = [first, first - 1, first - 2, first - 3];
      let block: Map<number, Map<string, number | null>>;
      try {
        block = await this.fetchBlock(symbol, yearList);
      } catch (err) {
        // Nur der jüngste Block ist Pflicht: ältere Blöcke sind Zugabe, scheitern sie, bleibt die bisherige Reihe.
        if (i === 0) throw err;
        break;
      }
      if (i > 0 && !yearList.some((y) => isPublished(block.get(y)))) break;
      fetched.push(block);
    }

    const years: IsYatirimYear[] = [];
    for (const block of fetched) {
      for (const [year, rows] of block) {
        // Jahre ohne veröffentlichten Abschluss kommen als null oder Nullen zurück: ohne Grundkapital gilt das Jahr als leer.
        if (!isPublished(rows)) continue;
        years.push({ year, netIncome: rows.get(CODE.netIncome) as number, operatingProfit: rows.get(CODE.operatingProfit) ?? null });
      }
    }
    years.sort((a, b) => a.year - b.year);
    if (years.length === 0) throw new AdapterError('NOT_FOUND', `Keine Bilanzdaten für ${symbol}`, ID);

    const latestYear = years[years.length - 1]!.year;
    const latest = fetched.map((b) => b.get(latestYear)).find((rows) => rows !== undefined);
    const get = (code: string) => latest?.get(code) ?? null;
    const debt = (get(CODE.shortLoans) ?? 0) + (get(CODE.longLoans) ?? 0);
    const cash = (get(CODE.cash) ?? 0) + (get(CODE.shortInvestments) ?? 0);
    return { years, shares: get(CODE.shareCapital), netDebt: latest ? debt - cash : null, equity: get(CODE.equity) };
  }

  /** Ein Block mit bis zu 4 Jahren: Jahr → (itemCode → Wert). */
  private async fetchBlock(symbol: string, yearList: number[]): Promise<Map<number, Map<string, number | null>>> {
    const params = yearList.map((y, i) => `year${i + 1}=${y}&period${i + 1}=12`).join('&');
    const url = `${ENDPOINT}?companyCode=${encodeURIComponent(symbol)}&exchange=TRY&financialGroup=XI_29&${params}`;
    const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, ID, this.opts);
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status} für ${symbol}`, ID);
    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !parsed.data.ok) throw new AdapterError('BAD_RESPONSE', `Unerwartetes Bilanzformat für ${symbol}`, ID);
    const rows = parsed.data.value ?? [];
    if (rows.length === 0) throw new AdapterError('NOT_FOUND', `Keine Bilanzdaten für ${symbol}`, ID);

    const out = new Map<number, Map<string, number | null>>();
    yearList.forEach((year, i) => {
      const column = `value${i + 1}` as 'value1' | 'value2' | 'value3' | 'value4';
      const byCode = new Map<string, number | null>();
      for (const row of rows) byCode.set(row.itemCode, toNumber(row[column]));
      out.set(year, byCode);
    });
    return out;
  }
}

/** Ein Geschäftsjahr gilt als veröffentlicht, wenn Jahresüberschuss und Grundkapital vorliegen. */
function isPublished(rows: Map<string, number | null> | undefined): boolean {
  if (!rows) return false;
  const netIncome = rows.get(CODE.netIncome);
  return netIncome !== null && netIncome !== undefined && (rows.get(CODE.shareCapital) ?? 0) > 0;
}
