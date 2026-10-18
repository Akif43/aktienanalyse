import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import { toYahooSymbol } from '../../symbols';
import type { Instrument } from '../../types';

const ID = 'yahoo-fundamentals';
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

const STATEMENT_TYPES = ['annualNetIncome', 'annualOperatingIncome', 'annualTotalDebt', 'annualCashAndCashEquivalents', 'annualStockholdersEquity', 'annualOrdinarySharesNumber'] as const;
type StatementType = (typeof STATEMENT_TYPES)[number];

export interface YahooStatementYear {
  year: number;
  netIncome: number | null;
  operatingIncome: number | null;
  totalDebt: number | null;
  cash: number | null;
  equity: number | null;
  shares: number | null;
}

export interface YahooDividends {
  dividends: { year: number; amount: number }[];
  coverageFromYear: number | null;
}

export interface YahooUsdTry {
  avgByYear: Record<number, number>;
  current: number | null;
}

const timeseriesSchema = z.object({
  timeseries: z.object({
    result: z.array(z.object({ meta: z.object({ type: z.array(z.string()) }) }).passthrough()).nullable(),
    error: z.unknown().optional(),
  }),
});

const valueSchema = z.array(z.object({ asOfDate: z.string(), reportedValue: z.object({ raw: z.number() }) }).passthrough());

const dividendChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()).optional(),
          events: z.object({ dividends: z.record(z.object({ amount: z.number(), date: z.number() })).optional() }).optional(),
        }),
      )
      .nullable(),
  }),
});

const fxChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ regularMarketPrice: z.number().optional() }).passthrough(),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({ quote: z.array(z.object({ close: z.array(z.number().nullable()).optional() })) }),
        }),
      )
      .nullable(),
  }),
});

/**
 * Bilanzdaten, Dividenden und USD/TRY-Jahresschnitt von Yahoo (inoffiziell, ohne Key). Der Timeseries-Endpoint
 * liefert ohne Crumb nur die letzten 4 Geschäftsjahre.
 */
export class YahooFundamentals {
  constructor(private readonly opts: HttpOptions = {}) {}

  async getStatements(instrument: Instrument): Promise<YahooStatementYear[]> {
    const symbol = toYahooSymbol(instrument);
    const period2 = Math.floor(Date.now() / 1000) + 366 * 86_400;
    const path = `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${STATEMENT_TYPES.join(',')}&period1=1420070400&period2=${period2}`;
    const body = await this.getJson(path, symbol);
    const parsed = timeseriesSchema.safeParse(body);
    if (!parsed.success) throw new AdapterError('BAD_RESPONSE', `Unerwartetes Bilanzformat für ${symbol}`, ID);
    return mergeStatements(parsed.data.timeseries.result ?? []);
  }

  /** Dividenden je Kalenderjahr (summiert) der letzten 12 Jahre. Frühere Werte (z. B. vor der TL-Umstellung) werden verworfen. */
  async getDividends(instrument: Instrument, currentYear: number): Promise<YahooDividends> {
    const symbol = toYahooSymbol(instrument);
    const body = await this.getJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1mo&events=div`, symbol);
    const parsed = dividendChartSchema.safeParse(body);
    const result = parsed.success ? parsed.data.chart.result?.[0] : undefined;
    if (!result) throw new AdapterError('BAD_RESPONSE', `Unerwartetes Dividendenformat für ${symbol}`, ID);

    const minYear = currentYear - 12;
    const byYear = new Map<number, number>();
    for (const ev of Object.values(result.events?.dividends ?? {})) {
      const year = new Date(ev.date * 1000).getUTCFullYear();
      if (year >= minYear) byYear.set(year, (byYear.get(year) ?? 0) + ev.amount);
    }
    const first = result.timestamp?.[0];
    let coverageFromYear: number | null = null;
    if (first !== undefined) {
      const d = new Date(first * 1000);
      coverageFromYear = Math.max(minYear, d.getUTCMonth() === 0 ? d.getUTCFullYear() : d.getUTCFullYear() + 1);
    }
    return { dividends: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount })), coverageFromYear };
  }

  /** Jahresdurchschnitt (Mittel der Tagesschlusskurse) Lira je USD und der aktuelle Kurs. */
  async getUsdTry(): Promise<YahooUsdTry> {
    const body = await this.getJson('/v8/finance/chart/USDTRY%3DX?range=10y&interval=1d', 'USDTRY=X');
    const parsed = fxChartSchema.safeParse(body);
    const result = parsed.success ? parsed.data.chart.result?.[0] : undefined;
    const closes = result?.indicators.quote[0]?.close;
    if (!result || !result.timestamp || !closes) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes Wechselkursformat für USDTRY=X', ID);

    const sums = new Map<number, { sum: number; n: number }>();
    let lastClose: number | null = null;
    result.timestamp.forEach((t, i) => {
      const c = closes[i];
      if (c === null || c === undefined || !(c > 0)) return;
      lastClose = c;
      const year = new Date(t * 1000).getUTCFullYear();
      const s = sums.get(year) ?? { sum: 0, n: 0 };
      s.sum += c;
      s.n += 1;
      sums.set(year, s);
    });
    const avgByYear: Record<number, number> = {};
    for (const [year, s] of sums) avgByYear[year] = s.sum / s.n;
    return { avgByYear, current: result.meta.regularMarketPrice ?? lastClose };
  }

  private async getJson(path: string, symbol: string): Promise<unknown> {
    let lastError: unknown;
    for (const host of HOSTS) {
      try {
        const res = await request(`https://${host}${path}`, { headers: HEADERS }, ID, this.opts);
        if (res.status === 404) throw new AdapterError('NOT_FOUND', `${symbol} nicht gefunden`, ID);
        if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status} für ${symbol}`, ID);
        return await res.json();
      } catch (err) {
        if (err instanceof AdapterError && err.code === 'NOT_FOUND') throw err;
        lastError = err instanceof SyntaxError ? new AdapterError('BAD_RESPONSE', `Antwort für ${symbol} ist kein JSON`, ID, err) : err;
      }
    }
    throw lastError;
  }
}

/** Führt die einzelnen Kennzahl-Reihen zu einer Zeile je Geschäftsjahr (Jahr des Bilanzstichtags) zusammen. */
function mergeStatements(results: readonly { meta: { type: string[] } }[]): YahooStatementYear[] {
  const years = new Map<number, YahooStatementYear>();
  const row = (year: number): YahooStatementYear => {
    let r = years.get(year);
    if (!r) years.set(year, (r = { year, netIncome: null, operatingIncome: null, totalDebt: null, cash: null, equity: null, shares: null }));
    return r;
  };
  const field: Record<StatementType, keyof Omit<YahooStatementYear, 'year'>> = {
    annualNetIncome: 'netIncome',
    annualOperatingIncome: 'operatingIncome',
    annualTotalDebt: 'totalDebt',
    annualCashAndCashEquivalents: 'cash',
    annualStockholdersEquity: 'equity',
    annualOrdinarySharesNumber: 'shares',
  };
  for (const item of results) {
    const type = item.meta.type[0] as StatementType | undefined;
    if (!type || !(type in field)) continue;
    const values = valueSchema.safeParse((item as Record<string, unknown>)[type]);
    if (!values.success) continue;
    for (const v of values.data) row(Number(v.asOfDate.slice(0, 4)))[field[type]] = v.reportedValue.raw;
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}
