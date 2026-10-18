import { AdapterError } from '../../errors';
import type { HttpOptions } from '../../http';
import type { Instrument } from '../../types';
import { IsYatirimFundamentals } from './isyatirim-fundamentals';
import type { Fundamentals, FundamentalsWarning, FundamentalsYear } from './types';
import { YahooFundamentals, type YahooStatementYear } from './yahoo-fundamentals';

/** Verhältnis İş-TL-Gewinn zu Yahoo-Gewinn: ab hier berichtet das Unternehmen in USD (z. B. THY), nicht in TL. */
const USD_REPORTER_RATIO = 3;

export interface FundamentalsServiceOptions extends HttpOptions {
  now?: () => Date;
}

/**
 * Holt die Bilanzdaten für die Graham-Bewertung. BIST: İş Yatırım (bis zu 8 Jahre, TL) als Hauptquelle, Yahoo nur
 * zur Erkennung von USD-Berichtern, für Dividenden und den USD/TRY-Jahresschnitt, notfalls als Ersatzreihe.
 * US/XETRA: Yahoo (4 Jahre). Eine Reihe stammt nie aus gemischten Quellen, weil die Quellen im letzten Jahr um
 * ca. 18 % auseinanderliegen (unterschiedliche Inflationsbasis).
 */
export class FundamentalsService {
  private readonly yahoo: YahooFundamentals;
  private readonly isYatirim: IsYatirimFundamentals;
  private readonly now: () => Date;

  constructor(opts: FundamentalsServiceOptions = {}) {
    const { now, ...http } = opts;
    this.yahoo = new YahooFundamentals(http);
    this.isYatirim = new IsYatirimFundamentals(http);
    this.now = now ?? (() => new Date());
  }

  async get(instrument: Instrument): Promise<Fundamentals> {
    return instrument.market === 'BIST' ? this.getBist(instrument) : this.getOther(instrument);
  }

  private async getBist(instrument: Instrument): Promise<Fundamentals> {
    const year = this.now().getFullYear();
    const [isR, yhR, divR, fxR] = await Promise.allSettled([
      this.isYatirim.getStatements(instrument.symbol, year - 1),
      this.yahoo.getStatements(instrument),
      this.yahoo.getDividends(instrument, year),
      this.yahoo.getUsdTry(),
    ]);

    const warnings: FundamentalsWarning[] = [];
    const avgFx = fxR.status === 'fulfilled' ? fxR.value.avgByYear : {};
    const currentFx = fxR.status === 'fulfilled' ? fxR.value.current : null;
    if (fxR.status === 'rejected' || currentFx === null) warnings.push({ code: 'missingFx' });
    const dividends = divR.status === 'fulfilled' ? divR.value.dividends : [];
    const dividendCoverageFromYear = divR.status === 'fulfilled' ? divR.value.coverageFromYear : null;
    const withFx = (y: Omit<FundamentalsYear, 'avgFx'>): FundamentalsYear => ({ ...y, avgFx: avgFx[y.year] ?? null });
    const base = { market: instrument.market, dividends, dividendCoverageFromYear, currentFx, avgUsdTry: avgFx };

    if (isR.status === 'fulfilled') {
      const is = isR.value;
      const yahooYears = yhR.status === 'fulfilled' ? yhR.value : [];
      if (isUsdReporter(is.years, yahooYears)) {
        warnings.push({ code: 'usdReporter' });
        const years = yahooYears.filter((y) => y.netIncome !== null).map((y) => withFx({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome }));
        return { ...base, source: 'yahoo', reportingCurrency: 'USD', years, shares: is.shares, netDebt: is.netDebt, equity: is.equity, warnings };
      }
      const years = is.years.map((y) => withFx({ year: y.year, netIncome: y.netIncome, ebit: y.operatingProfit }));
      return { ...base, source: 'isyatirim', reportingCurrency: 'TRY', years, shares: is.shares, netDebt: is.netDebt, equity: is.equity, warnings };
    }

    if (yhR.status === 'fulfilled' && yhR.value.some((y) => y.netIncome !== null)) {
      warnings.push({ code: 'sourceFallback', reason: describe(isR.reason) });
      const latest = latestBalance(yhR.value);
      const years = yhR.value.filter((y) => y.netIncome !== null).map((y) => withFx({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome }));
      return { ...base, source: 'yahoo', reportingCurrency: 'TRY', years, shares: latest.shares, netDebt: latest.netDebt, equity: latest.equity, warnings };
    }
    throw isR.reason;
  }

  private async getOther(instrument: Instrument): Promise<Fundamentals> {
    const year = this.now().getFullYear();
    const [stR, divR] = await Promise.allSettled([this.yahoo.getStatements(instrument), this.yahoo.getDividends(instrument, year)]);
    if (stR.status === 'rejected') throw stR.reason;

    const years: FundamentalsYear[] = stR.value.filter((y) => y.netIncome !== null).map((y) => ({ year: y.year, netIncome: y.netIncome as number, ebit: y.operatingIncome, avgFx: null }));
    const latest = latestBalance(stR.value);
    const warnings: FundamentalsWarning[] = years.length === 0 ? [{ code: 'noStatements' }] : [];
    return {
      market: instrument.market,
      source: 'yahoo',
      reportingCurrency: 'USD',
      years,
      shares: latest.shares,
      netDebt: latest.netDebt,
      equity: latest.equity,
      dividends: divR.status === 'fulfilled' ? divR.value.dividends : [],
      dividendCoverageFromYear: divR.status === 'fulfilled' ? divR.value.coverageFromYear : null,
      currentFx: null,
      avgUsdTry: {},
      warnings,
    };
  }
}

/** Mittleres Verhältnis TL-Gewinn (İş) zu Yahoo-Gewinn über die gemeinsamen Jahre: bei USD-Berichtern liegt es beim Wechselkurs, bei TL-Berichtern um 1. */
function isUsdReporter(isYears: readonly { year: number; netIncome: number }[], yahoo: readonly YahooStatementYear[]): boolean {
  const ratios: number[] = [];
  for (const y of isYears) {
    const other = yahoo.find((o) => o.year === y.year)?.netIncome;
    if (other && other > 0 && y.netIncome > 0) ratios.push(y.netIncome / other);
  }
  if (ratios.length === 0) return false;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)] as number;
  return median > USD_REPORTER_RATIO;
}

function latestBalance(rows: readonly YahooStatementYear[]): { shares: number | null; netDebt: number | null; equity: number | null } {
  const sorted = [...rows].sort((a, b) => b.year - a.year);
  const debtRow = sorted.find((r) => r.totalDebt !== null && r.cash !== null);
  return {
    shares: sorted.find((r) => r.shares !== null)?.shares ?? null,
    netDebt: debtRow ? (debtRow.totalDebt as number) - (debtRow.cash as number) : null,
    equity: sorted.find((r) => r.equity !== null)?.equity ?? null,
  };
}

function describe(reason: unknown): string {
  return reason instanceof AdapterError ? `${reason.adapter}: ${reason.message}` : String((reason as Error)?.message ?? reason);
}
