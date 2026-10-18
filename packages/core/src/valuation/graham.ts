import type { Market } from '../types';

/**
 * Vereinfachte Bewertung nach Benjamin Graham. Reine Rechenlogik ohne I/O: nimmt Kennzahlen und
 * Einstellungen, liefert Einstufung, Szenarien, Checkliste und alle Zwischenschritte (für die
 * aufklappbare Rechnung in der App). Texte stehen bewusst nicht hier, nur Hinweiscodes.
 */

export type GrahamReportingCurrency = 'TRY' | 'USD';
export type GrahamCompanyType = 'growth' | 'cyclical' | 'stable';
export type GrahamVerdict = 'stronglyUndervalued' | 'undervalued' | 'fair' | 'slightlyExpensive' | 'expensive';
export type GrahamScenarioId = 'conservative' | 'base' | 'optimistic';

/** Prozentwerte als Prozent (4 = 4 %). */
export interface GrahamSettings {
  riskFreeRate: number;
  equityRiskPremium: number;
  /** Länderrisiko der Türkei. USA/Deutschland haben 0. */
  countryRiskBist: number;
  /** Rendite erstklassiger Unternehmensanleihen (Y in der Graham-Wachstumsformel). */
  bondYield: number;
  safetyMargin: number;
  safetyMarginHighDebt: number;
}

export const DEFAULT_GRAHAM_SETTINGS: GrahamSettings = {
  riskFreeRate: 4,
  equityRiskPremium: 5,
  countryRiskBist: 3.5,
  bondYield: 5,
  safetyMargin: 30,
  safetyMarginHighDebt: 40,
};

/** Festgelegte Schwellen der Methode (nicht in den Einstellungen änderbar). */
export const GRAHAM_ADJUST_RATIO = 1.5;
export const GRAHAM_GROWTH_THRESHOLD = 0.15;
export const GRAHAM_CV_THRESHOLD = 0.5;
export const GRAHAM_DECLINE_THRESHOLD = 0.5;
export const GRAHAM_DEBT_MEDIUM = 0.5;
export const GRAHAM_DEBT_HIGH = 1;
export const GRAHAM_MAX_GROWTH = 25;
export const GRAHAM_GROWTH_SCENARIOS: readonly number[] = [10, 15, 20, 25];
export const GRAHAM_PE_CONSERVATIVE_DELTA = -1.5;
export const GRAHAM_PE_OPTIMISTIC_DELTA = 1;
/** Mindestzahl Geschäftsjahre, damit überhaupt bewertet wird. */
export const GRAHAM_MIN_YEARS = 3;
export const GRAHAM_FULL_YEARS = 5;

export interface GrahamYearInput {
  year: number;
  /** Jahresüberschuss in Berichtswährung. */
  netIncome: number;
  /** Operatives Ergebnis in Berichtswährung (Bereinigungsgrundlage), falls bekannt. */
  ebit: number | null;
  /** Jahresdurchschnitt Lira je USD. Nur bei BIST-Berichtern in TL nötig. */
  avgFx: number | null;
}

export interface GrahamDividendYear {
  year: number;
  amount: number;
}

export interface GrahamInput {
  market: Market;
  price: number;
  shares: number;
  /** Nettoverschuldung in Kurswährung (negativ = Nettoguthaben). */
  netDebt: number;
  /** Nur BIST relevant: TL-Berichter werden zum Jahresschnittskurs in USD umgerechnet, USD-Berichter (z. B. THY) nicht. */
  reportingCurrency: GrahamReportingCurrency;
  years: readonly GrahamYearInput[];
  /** Aktueller Kurs Lira je USD, bei BIST Pflicht (Rückrechnung in TL). */
  currentFx: number | null;
  dividendYears: readonly GrahamDividendYear[];
  /** Ab welchem Jahr die Dividendendaten vollständig vorliegen (für "keine Dividende" vs. "unbekannt"). */
  dividendCoverageFromYear?: number | null;
  /** Gewinn je Aktie der letzten 12 Monate, falls bekannt. */
  ttmEps?: number | null;
  /** Aktuelles Kalenderjahr, nur für Tests überschreibbar. */
  currentYear?: number;
}

export type GrahamNote =
  | { code: 'fewYears'; years: number }
  | { code: 'fewGrowthRates'; rates: number }
  | { code: 'adjustedYears'; years: string }
  | { code: 'ias29' }
  | { code: 'ttmFallback' };

export type GrahamNotValuableReason = 'invalidInput' | 'tooFewYears' | 'missingFx' | 'negativeEps';

export interface GrahamNotValuable {
  status: 'notValuable';
  reason: GrahamNotValuableReason;
  /** Bei `tooFewYears`/`missingFx`: Details für den Hinweistext. */
  have?: number;
  need?: number;
  years?: number[];
  /** Bei `negativeEps`: das (nicht positive) normalisierte EPS und der Typ. */
  eps?: number;
  type?: GrahamCompanyType;
}

export interface GrahamYearResult {
  year: number;
  netIncome: number;
  ebit: number | null;
  /** Jahresgewinn in der Vergleichswährung (USD bei BIST, sonst Kurswährung). */
  base: number;
  /** Bereinigter Wert in der Vergleichswährung (= base, außer das Jahr gilt als verzerrt). */
  adjusted: number;
  adjustedForOneOff: boolean;
}

export interface GrahamScenario {
  id: GrahamScenarioId;
  pe: number;
  intrinsicValue: number;
  buyLimit: number;
}

export interface GrahamGrowthScenario {
  growth: number;
  value: number;
}

export interface GrahamChecklistItem {
  /** true = erfüllt, false = nicht erfüllt, null = mangels Daten unbekannt. */
  ok: boolean | null;
  value?: number | null;
  limit?: number | null;
}

export interface GrahamChecklist {
  peTtm: GrahamChecklistItem & { usedTtm: boolean };
  grahamNumber: GrahamChecklistItem & { yearsUsed: number };
  dividends: GrahamChecklistItem;
  netDebtBelowMarketCap: GrahamChecklistItem;
  noLossYear: GrahamChecklistItem;
}

export interface GrahamValuation {
  status: 'ok';
  verdict: GrahamVerdict;
  type: GrahamCompanyType;
  years: GrahamYearResult[];
  /** Zahl der für den Durchschnitt/Typ genutzten Jahre (max. 5). */
  yearsUsed: number;
  growthRates: number[];
  avgGrowth: number | null;
  coefficientOfVariation: number | null;
  hasLossYear: boolean;
  hasBigDecline: boolean;
  /** Normalisierter Gewinn in Vergleichswährung vor Umrechnung/Aktienzahl. */
  normalizedEarnings: number;
  eps: number;
  marketCap: number;
  netDebtRatio: number;
  companyRisk: number;
  requiredReturn: number;
  safetyMargin: number;
  scenarios: Record<GrahamScenarioId, GrahamScenario>;
  growthScenarios: GrahamGrowthScenario[] | null;
  /** Wachstum in % pro Jahr, das der aktuelle Kurs laut Graham-Wachstumsformel einpreist (nur Wachstumsfirmen). */
  impliedGrowth: number | null;
  checklist: GrahamChecklist;
  notes: GrahamNote[];
  price: number;
}

export type GrahamResult = GrahamValuation | GrahamNotValuable;

/** Einstufung aus Kurs, Kaufgrenzen und inneren Werten. */
export function classifyGraham(price: number, scenarios: Record<GrahamScenarioId, Pick<GrahamScenario, 'intrinsicValue' | 'buyLimit'>>): GrahamVerdict {
  if (price <= scenarios.conservative.buyLimit) return 'stronglyUndervalued';
  if (price <= scenarios.base.buyLimit) return 'undervalued';
  if (price <= scenarios.base.intrinsicValue) return 'fair';
  if (price <= scenarios.optimistic.intrinsicValue) return 'slightlyExpensive';
  return 'expensive';
}

/** Graham-Wachstumsformel: Wert = EPS × (8,5 + 2g) × (4,4 / Y). g in Prozent. */
export function grahamGrowthValue(eps: number, growthPercent: number, bondYield: number): number {
  return eps * (8.5 + 2 * growthPercent) * (4.4 / bondYield);
}

/** Wachstum (in %), bei dem die Graham-Wachstumsformel genau den Kurs ergibt. */
export function grahamImpliedGrowth(price: number, eps: number, bondYield: number): number {
  return ((price * bondYield) / (4.4 * eps) - 8.5) / 2;
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function populationStd(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeGraham(input: GrahamInput, settings: GrahamSettings = DEFAULT_GRAHAM_SETTINGS): GrahamResult {
  const { market, price, shares, netDebt } = input;
  if (!(price > 0) || !(shares > 0) || !Number.isFinite(netDebt)) return { status: 'notValuable', reason: 'invalidInput' };

  const sorted = [...input.years].sort((a, b) => a.year - b.year);
  if (sorted.length < GRAHAM_MIN_YEARS) return { status: 'notValuable', reason: 'tooFewYears', have: sorted.length, need: GRAHAM_MIN_YEARS };

  const isBist = market === 'BIST';
  const tlReporter = isBist && input.reportingCurrency === 'TRY';
  if (isBist && !(input.currentFx && input.currentFx > 0)) return { status: 'notValuable', reason: 'missingFx', years: [] };
  if (tlReporter) {
    const missing = sorted.filter((y) => !(y.avgFx && y.avgFx > 0)).map((y) => y.year);
    if (missing.length > 0) return { status: 'notValuable', reason: 'missingFx', years: missing };
  }

  // Schritt 1 und 2: vergleichbar machen, Einmaleffekte bereinigen
  const converted: GrahamYearResult[] = sorted.map((y) => {
    const factor = tlReporter ? 1 / (y.avgFx as number) : 1;
    const distorted = y.ebit !== null && y.ebit > 0 && y.netIncome > GRAHAM_ADJUST_RATIO * y.ebit;
    const base = y.netIncome * factor;
    return { year: y.year, netIncome: y.netIncome, ebit: y.ebit, base, adjusted: distorted ? (y.ebit as number) * factor : base, adjustedForOneOff: distorted };
  });

  const recent = converted.slice(-GRAHAM_FULL_YEARS);
  const adjusted = recent.map((y) => y.adjusted);
  const notes: GrahamNote[] = [];
  if (converted.length < GRAHAM_FULL_YEARS) notes.push({ code: 'fewYears', years: converted.length });
  const oneOffYears = recent.filter((y) => y.adjustedForOneOff).map((y) => y.year);
  if (oneOffYears.length > 0) notes.push({ code: 'adjustedYears', years: oneOffYears.join(', ') });
  if (tlReporter) notes.push({ code: 'ias29' });

  // Schritt 3: Unternehmenstyp
  const growthWindow = adjusted.slice(-(3 + 1));
  const growthRates: number[] = [];
  for (let i = 1; i < growthWindow.length; i++) {
    const prev = growthWindow[i - 1] as number;
    if (prev > 0) growthRates.push((growthWindow[i] as number) / prev - 1);
  }
  const hasLossYear = adjusted.some((v) => v < 0);
  const avgGrowth = growthRates.length > 0 ? mean(growthRates) : null;
  if (growthRates.length < 3) notes.push({ code: 'fewGrowthRates', rates: growthRates.length });

  const avgAdjusted = mean(adjusted);
  const coefficientOfVariation = avgAdjusted > 0 ? populationStd(adjusted) / avgAdjusted : Infinity;
  let hasBigDecline = false;
  for (let i = 1; i < adjusted.length; i++) {
    const prev = adjusted[i - 1] as number;
    if (prev > 0 && (adjusted[i] as number) / prev - 1 < -GRAHAM_DECLINE_THRESHOLD) hasBigDecline = true;
  }

  // "Zyklisch" hat Vorrang: Ein Gewinnrückgang über 50 % mit anschließender Erholung (z. B. Tüpraş) ergibt sonst
  // rechnerisch einen hohen Durchschnittswachstum und würde fälschlich als Wachstumsfirma gelten.
  const isCyclical = coefficientOfVariation > GRAHAM_CV_THRESHOLD || hasBigDecline;
  const isGrowth = !isCyclical && avgGrowth !== null && avgGrowth > GRAHAM_GROWTH_THRESHOLD && !hasLossYear;
  const type: GrahamCompanyType = isCyclical ? 'cyclical' : isGrowth ? 'growth' : 'stable';

  // Schritt 4: normalisierter Gewinn je Aktie
  const normalizedEarnings = type === 'growth' ? (adjusted[adjusted.length - 1] as number) : avgAdjusted;
  const fxBack = isBist ? (input.currentFx as number) : 1;
  const eps = (normalizedEarnings * fxBack) / shares;
  if (!(eps > 0)) return { status: 'notValuable', reason: 'negativeEps', eps, type };

  // Schritt 5: faires KGV aus der geforderten Rendite
  const marketCap = price * shares;
  const netDebtRatio = netDebt / marketCap;
  const debtRisk = netDebtRatio > GRAHAM_DEBT_HIGH ? 3 : netDebtRatio > GRAHAM_DEBT_MEDIUM ? 2 : 0;
  const companyRisk = debtRisk + (type === 'cyclical' ? 1 : 0);
  const requiredReturn = settings.riskFreeRate + settings.equityRiskPremium + (isBist ? settings.countryRiskBist : 0) + companyRisk;
  const basePe = 100 / requiredReturn;

  // Schritt 7: Sicherheitsmarge
  const safetyMargin = netDebtRatio > GRAHAM_DEBT_MEDIUM ? settings.safetyMarginHighDebt : settings.safetyMargin;
  const makeScenario = (id: GrahamScenarioId, pe: number): GrahamScenario => {
    const safePe = Math.max(pe, 0);
    const intrinsicValue = eps * safePe;
    return { id, pe: safePe, intrinsicValue, buyLimit: intrinsicValue * (1 - safetyMargin / 100) };
  };
  const scenarios: Record<GrahamScenarioId, GrahamScenario> = {
    conservative: makeScenario('conservative', basePe + GRAHAM_PE_CONSERVATIVE_DELTA),
    base: makeScenario('base', basePe),
    optimistic: makeScenario('optimistic', basePe + GRAHAM_PE_OPTIMISTIC_DELTA),
  };

  // Schritt 6: Graham-Wachstumsformel (nur Wachstumsfirmen, reine Zusatzinfo)
  const growthScenarios = type === 'growth' ? GRAHAM_GROWTH_SCENARIOS.map((g) => ({ growth: g, value: grahamGrowthValue(eps, Math.min(g, GRAHAM_MAX_GROWTH), settings.bondYield) })) : null;
  const impliedGrowth = type === 'growth' ? grahamImpliedGrowth(price, eps, settings.bondYield) : null;

  const checklist = buildChecklist(input, converted, { price, marketCap, fxBack, shares, eps, notes });

  return {
    status: 'ok',
    verdict: classifyGraham(price, scenarios),
    type,
    years: converted,
    yearsUsed: recent.length,
    growthRates,
    avgGrowth,
    coefficientOfVariation,
    hasLossYear,
    hasBigDecline,
    normalizedEarnings,
    eps,
    marketCap,
    netDebtRatio,
    companyRisk,
    requiredReturn,
    safetyMargin,
    scenarios,
    growthScenarios,
    impliedGrowth,
    checklist,
    notes,
    price,
  };
}

function buildChecklist(
  input: GrahamInput,
  years: readonly GrahamYearResult[],
  ctx: { price: number; marketCap: number; fxBack: number; shares: number; eps: number; notes: GrahamNote[] },
): GrahamChecklist {
  const { price, marketCap, fxBack, shares } = ctx;
  const currentYear = input.currentYear ?? new Date().getFullYear();

  // 1) KGV der letzten 12 Monate ≤ 20 (ohne TTM-Angabe: letztes Geschäftsjahr)
  const last = years[years.length - 1] as GrahamYearResult;
  const usedTtm = input.ttmEps !== undefined && input.ttmEps !== null;
  const lastEps = (last.base * fxBack) / shares;
  const trailingEps = usedTtm ? (input.ttmEps as number) : lastEps;
  if (!usedTtm) ctx.notes.push({ code: 'ttmFallback' });
  const pe = trailingEps > 0 ? price / trailingEps : null;
  const peTtm = { ok: pe === null ? false : pe <= 20, value: pe, limit: 20, usedTtm };

  // 2) Kurs ≤ 25 × durchschnittlicher Gewinn der letzten ≤ 7 Jahre
  const sevenYears = years.slice(-7);
  const eps7 = (mean(sevenYears.map((y) => y.adjusted)) * fxBack) / shares;
  const grahamLimit = eps7 > 0 ? 25 * eps7 : null;
  const grahamNumber = { ok: grahamLimit === null ? false : price <= grahamLimit, value: price, limit: grahamLimit, yearsUsed: sevenYears.length };

  // 3) Ununterbrochene Dividende in den letzten 10 abgeschlossenen Jahren
  const dividends = dividendCheck(input.dividendYears, input.dividendCoverageFromYear ?? null, currentYear);

  // 4) Nettoschulden < Marktkapitalisierung
  const netDebtBelowMarketCap = { ok: input.netDebt < marketCap, value: input.netDebt, limit: marketCap };

  // 5) Kein Verlustjahr in den letzten 5 Jahren (unbereinigte Jahresüberschüsse)
  const noLossYear = { ok: years.slice(-GRAHAM_FULL_YEARS).every((y) => y.netIncome >= 0) };

  return { peTtm, grahamNumber, dividends, netDebtBelowMarketCap, noLossYear };
}

function dividendCheck(dividendYears: readonly GrahamDividendYear[], coverageFrom: number | null, currentYear: number): GrahamChecklistItem {
  const paid = new Set<number>();
  for (const d of dividendYears) if (d.amount > 0) paid.add(d.year);
  const missing: number[] = [];
  for (let y = currentYear - 10; y <= currentYear - 1; y++) if (!paid.has(y)) missing.push(y);
  if (missing.length === 0) return { ok: true };
  // Fehlt ein Jahr, für das die Daten vollständig vorliegen, gilt die Zahlung als unterbrochen; sonst wissen wir es nicht.
  if (coverageFrom !== null && missing.some((y) => y >= coverageFrom)) return { ok: false, value: missing.length };
  return { ok: null, value: missing.length };
}
