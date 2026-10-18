import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { Instrument } from '../../types';

const ID = 'sec-edgar';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const XBRL_BASE = 'https://data.sec.gov/api/xbrl';
/** SEC erlaubt höchstens 10 Anfragen pro Sekunde: dieser Abstand hält uns deutlich darunter. */
const MIN_GAP_MS = 150;
/** Höchstzahl Geschäftsjahre, die geliefert werden. */
export const SEC_MAX_YEARS = 12;

export interface SecFact {
  /** Beginn des Berichtszeitraums (fehlt bei Stichtagswerten wie Bilanzposten). */
  start?: string;
  end: string;
  val: number;
  form?: string;
  filed?: string;
}

export interface SecYear {
  year: number;
  netIncome: number;
  ebit: number | null;
}

export interface SecSeries {
  cik: number;
  taxonomy: 'us-gaap' | 'ifrs-full';
  currency: 'USD' | 'EUR';
  years: SecYear[];
}

interface ConceptSet {
  taxonomy: 'us-gaap' | 'ifrs-full';
  netIncome: string[];
  ebit: string[];
}

/** Konzepte in Reihenfolge der Vorliebe: Anteil der Muttergesellschaft passt zu den Zahlen von Yahoo und İş Yatırım. */
const US_GAAP: ConceptSet = { taxonomy: 'us-gaap', netIncome: ['NetIncomeLoss', 'ProfitLoss'], ebit: ['OperatingIncomeLoss'] };
const IFRS: ConceptSet = { taxonomy: 'ifrs-full', netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'], ebit: ['ProfitLossFromOperatingActivities'] };

const factSchema = z.object({ start: z.string().optional(), end: z.string(), val: z.number(), form: z.string().optional(), filed: z.string().optional() });
const unitsSchema = z.record(z.array(z.unknown()));
const conceptSchema = z.object({ units: unitsSchema.optional() });
const factsSchema = z.object({ facts: z.record(z.record(z.object({ units: unitsSchema.optional() }))).optional() });
const tickersSchema = z.record(z.object({ cik_str: z.number(), ticker: z.string() }));

type Units = Record<string, SecFact[]>;

/**
 * Wählt je Geschäftsjahr genau einen Jahreswert aus den Rohzeilen von EDGAR. Eine Zeile zählt nur, wenn sie aus einem
 * Jahresbericht (10-K, 20-F, 40-F) stammt und einen Zeitraum von ca. einem Jahr (350 bis 380 Tage) abdeckt:
 * Quartals- und Teilzeiträume sowie Stichtagswerte fallen weg. Wurde derselbe Zeitraum mehrfach gemeldet (jeder
 * Jahresbericht wiederholt die Vorjahre), gewinnt die zuletzt eingereichte Fassung (Korrekturen). Das Jahr ist das
 * Jahr des Bilanzstichtags (wie bei Yahoo), nicht das unzuverlässige Feld `fy`.
 */
export function pickAnnualSeries(facts: readonly SecFact[]): Map<number, number> {
  const byEnd = new Map<string, SecFact>();
  for (const f of facts) {
    if (!f.start || !f.form || !/^(10-K|20-F|40-F)/.test(f.form)) continue;
    const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
    if (!(days >= 350 && days <= 380)) continue;
    const current = byEnd.get(f.end);
    if (!current || (f.filed ?? '') > (current.filed ?? '')) byEnd.set(f.end, f);
  }
  const byYear = new Map<number, SecFact>();
  for (const f of byEnd.values()) {
    const year = Number(f.end.slice(0, 4));
    const current = byYear.get(year);
    // Zwei Stichtage im selben Kalenderjahr (z. B. nach einer Umstellung des Geschäftsjahres): der spätere gilt.
    if (!current || f.end > current.end) byYear.set(year, f);
  }
  return new Map([...byYear].map(([year, f]) => [year, f.val]));
}

/** SEC schreibt Klassen-Aktien mit Bindestrich (BRK-B), andere Quellen mit Punkt. */
export function toSecTicker(symbol: string): string {
  return symbol.toUpperCase().replace(/\./g, '-');
}

/**
 * Jahresgewinne aus SEC EDGAR (XBRL-Schnittstelle der US-Börsenaufsicht, kostenlos, ohne Key). Pflicht ist ein
 * User-Agent mit Kontaktadresse und höchstens 10 Anfragen pro Sekunde. Deckt US-Aktien und Unternehmen ab, die auch
 * bei der SEC melden (z. B. SAP als 20-F-Melder mit IFRS in EUR); normale XETRA-Werte sind dort nicht zu finden.
 */
export class SecFundamentals {
  private tickerMap: Promise<Map<string, number>> | null = null;
  private requests = 0;
  private readonly contact: string;

  constructor(
    contact: string,
    private readonly opts: HttpOptions = {},
  ) {
    this.contact = contact.trim();
    if (!this.contact) throw new AdapterError('CONFIG', 'SEC_CONTACT nötig (Kontaktadresse für den User-Agent)', ID);
  }

  /**
   * Liefert die Jahresreihe. US-Aktien nur in USD (die Reihe muss zur Kurswährung passen), XETRA-Werte nur als
   * IFRS-Abschluss in EUR: ein US-GAAP-Treffer unter demselben Kürzel wäre ein anderes Unternehmen.
   * `minYear`: Eine Reihe, die älter endet, gilt als veraltet (z. B. gewechselte Konzepte), solange ein anderes
   * Konzept neuere Jahre liefert.
   */
  async getSeries(instrument: Instrument, opts: { cachedCik?: number | null; minYear: number }): Promise<SecSeries> {
    const symbol = toSecTicker(instrument.symbol);
    const cik = opts.cachedCik ?? (await this.lookupCik(symbol));
    if (cik === null) throw new AdapterError('NOT_FOUND', `${symbol} steht nicht im SEC-Register`, ID);

    const currency = instrument.market === 'US' ? 'USD' : 'EUR';
    const sets = instrument.market === 'US' ? [US_GAAP, IFRS] : [IFRS];
    let allFacts: Promise<Record<string, Record<string, { units?: Record<string, unknown[]> }>> | null> | null = null;
    const facts = () => (allFacts ??= this.companyFacts(cik));

    for (const set of sets) {
      const net = await this.pickConcept(cik, set.taxonomy, set.netIncome, currency, opts.minYear, facts);
      if (!net) continue;
      const ebit = (await this.pickConcept(cik, set.taxonomy, set.ebit, currency, opts.minYear, facts)) ?? new Map<number, number>();
      const years = [...net.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(-SEC_MAX_YEARS)
        .map(([year, netIncome]) => ({ year, netIncome, ebit: ebit.get(year) ?? null }));
      return { cik, taxonomy: set.taxonomy, currency, years };
    }
    throw new AdapterError('NOT_FOUND', `Keine Jahresgewinne in ${currency} bei der SEC für ${symbol}`, ID);
  }

  /** Nimmt das erste Konzept mit aktuellen Jahren, sonst das mit dem neuesten Jahr. */
  private async pickConcept(
    cik: number,
    taxonomy: string,
    concepts: readonly string[],
    currency: string,
    minYear: number,
    facts: () => Promise<Record<string, Record<string, { units?: Record<string, unknown[]> }>> | null>,
  ): Promise<Map<number, number> | null> {
    let best: Map<number, number> | null = null;
    for (const concept of concepts) {
      const units = await this.units(cik, taxonomy, concept, facts);
      const series = units?.[currency] ? pickAnnualSeries(units[currency]) : new Map<number, number>();
      if (series.size === 0) continue;
      if (Math.max(...series.keys()) >= minYear) return series;
      if (!best || Math.max(...series.keys()) > Math.max(...best.keys())) best = series;
    }
    return best;
  }

  /** Rohzeilen eines Konzepts: erst die kleine companyconcept-Antwort, bei leerem Ergebnis die große companyfacts. */
  private async units(cik: number, taxonomy: string, concept: string, facts: () => Promise<Record<string, Record<string, { units?: Record<string, unknown[]> }>> | null>): Promise<Units | null> {
    try {
      const body = await this.getJson(`${XBRL_BASE}/companyconcept/CIK${pad(cik)}/${taxonomy}/${concept}.json`);
      if (body === null) return null; // das Unternehmen kennt dieses Konzept nicht
      const parsed = conceptSchema.safeParse(body);
      const units = parsed.success ? toUnits(parsed.data.units) : null;
      if (units && Object.values(units).some((rows) => rows.length > 0)) return units;
    } catch (err) {
      if (err instanceof AdapterError && err.code === 'BLOCKED') throw err;
      // sonstige Fehler: Ausweichabruf über companyfacts
    }
    return toUnits((await facts())?.[taxonomy]?.[concept]?.units);
  }

  private async companyFacts(cik: number): Promise<Record<string, Record<string, { units?: Record<string, unknown[]> }>> | null> {
    const body = await this.getJson(`${XBRL_BASE}/companyfacts/CIK${pad(cik)}.json`);
    const parsed = factsSchema.safeParse(body);
    return parsed.success ? (parsed.data.facts ?? null) : null;
  }

  private async lookupCik(symbol: string): Promise<number | null> {
    this.tickerMap ??= this.loadTickers().catch((err) => {
      this.tickerMap = null; // beim nächsten Mal erneut versuchen
      throw err;
    });
    return (await this.tickerMap).get(symbol) ?? null;
  }

  private async loadTickers(): Promise<Map<string, number>> {
    const body = await this.getJson(TICKERS_URL);
    const parsed = tickersSchema.safeParse(body);
    if (!parsed.success) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes Format des SEC-Ticker-Registers', ID);
    const map = new Map<string, number>();
    for (const row of Object.values(parsed.data)) map.set(toSecTicker(row.ticker), row.cik_str);
    return map;
  }

  /** `null` bei 404 (Konzept/Unternehmen nicht vorhanden). */
  private async getJson(url: string): Promise<unknown | null> {
    if (this.requests++ > 0) await (this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(MIN_GAP_MS);
    const res = await request(url, { headers: { 'User-Agent': `Borsa-App ${this.contact}`, Accept: 'application/json' } }, ID, this.opts);
    if (res.status === 404) return null;
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status} von ${new URL(url).host}`, ID);
    try {
      return await res.json();
    } catch (err) {
      throw new AdapterError('BAD_RESPONSE', `Antwort von ${new URL(url).host} ist kein JSON`, ID, err);
    }
  }
}

const pad = (cik: number) => String(cik).padStart(10, '0');

function toUnits(raw: Record<string, unknown[]> | undefined): Units | null {
  if (!raw) return null;
  const out: Units = {};
  for (const [unit, rows] of Object.entries(raw)) {
    out[unit] = rows.flatMap((r) => {
      const f = factSchema.safeParse(r);
      return f.success ? [f.data] : [];
    });
  }
  return out;
}
