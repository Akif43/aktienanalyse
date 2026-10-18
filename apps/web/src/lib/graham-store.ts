import { DEFAULT_GRAHAM_SETTINGS, type GrahamReportingCurrency, type GrahamSettings } from '@aktien/core';
import { useSyncExternalStore } from 'react';
import { appStorage, GRAHAM_INPUTS_KEY, GRAHAM_SETTINGS_KEY, type StorageLike } from './storage';

// --- Einstellungen (Standardwerte der Bewertung) -------------------------------------------------

const LIMITS: Record<keyof GrahamSettings, [number, number]> = {
  riskFreeRate: [0, 30],
  equityRiskPremium: [0, 30],
  countryRiskBist: [0, 30],
  bondYield: [0.1, 30],
  safetyMargin: [0, 90],
  safetyMarginHighDebt: [0, 90],
  cyclicalDiscount: [0, 50],
};

/** Prüft gelesene Daten: unbrauchbare Werte fallen auf den Standard zurück. */
export function sanitizeGrahamSettings(raw: unknown): GrahamSettings {
  const out: GrahamSettings = { ...DEFAULT_GRAHAM_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(LIMITS) as (keyof GrahamSettings)[]) {
    const n = typeof r[key] === 'number' ? (r[key] as number) : Number.NaN;
    const [min, max] = LIMITS[key];
    if (Number.isFinite(n) && n >= min && n <= max) out[key] = n;
  }
  return out;
}

export class GrahamSettingsStore {
  private settings: GrahamSettings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike) {
    this.settings = this.load();
  }

  private load(): GrahamSettings {
    try {
      return sanitizeGrahamSettings(JSON.parse(this.storage.getItem(GRAHAM_SETTINGS_KEY) ?? 'null'));
    } catch {
      return { ...DEFAULT_GRAHAM_SETTINGS };
    }
  }

  private commit(next: GrahamSettings): void {
    this.settings = next;
    try {
      this.storage.setItem(GRAHAM_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Werte gelten für diese Sitzung */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): GrahamSettings => this.settings;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Übernimmt die Werte (ungültige werden durch den Standard ersetzt). */
  set(next: GrahamSettings): void {
    this.commit(sanitizeGrahamSettings(next));
  }

  reset(): void {
    this.commit({ ...DEFAULT_GRAHAM_SETTINGS });
  }
}

export const grahamSettingsStore = new GrahamSettingsStore(appStorage);

export function useGrahamSettings(): GrahamSettings {
  return useSyncExternalStore(grahamSettingsStore.subscribe, grahamSettingsStore.getSnapshot);
}

// --- Manuelle Eingaben je Aktie ------------------------------------------------------------------

export interface GrahamManualYear {
  year: number;
  netIncome: number;
  ebit: number | null;
  avgFx: number | null;
}

/**
 * Eigene Werte einer Aktie. Die Jahre in `years` überlagern die automatische Reihe jahresweise (für dieses Jahr gewinnt
 * der eigene Wert, alle anderen Jahre bleiben automatisch), so lassen sich auch fehlende ältere Jahre nachtragen. Die
 * übrigen Felder überschreiben jeweils nur den einzelnen automatischen Wert.
 */
export interface GrahamManual {
  years?: GrahamManualYear[];
  shares?: number;
  netDebt?: number;
  reportingCurrency?: GrahamReportingCurrency;
  currentFx?: number;
  dividendYears?: { year: number; amount: number }[];
  ttmEps?: number;
}

const MAX_TICKERS = 100;
const MAX_YEARS = 30;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function sanitizeGrahamManual(raw: unknown): GrahamManual | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: GrahamManual = {};
  if (Array.isArray(r.years)) {
    const seen = new Set<number>();
    const years: GrahamManualYear[] = [];
    for (const y of r.years) {
      if (!y || typeof y !== 'object') continue;
      const e = y as Record<string, unknown>;
      if (!finite(e.year) || !Number.isInteger(e.year) || e.year < 1990 || e.year > 2100 || !finite(e.netIncome) || seen.has(e.year)) continue;
      seen.add(e.year);
      years.push({ year: e.year, netIncome: e.netIncome, ebit: finite(e.ebit) ? e.ebit : null, avgFx: finite(e.avgFx) && e.avgFx > 0 ? e.avgFx : null });
      if (years.length >= MAX_YEARS) break;
    }
    if (years.length > 0) out.years = years.sort((a, b) => a.year - b.year);
  }
  if (finite(r.shares) && r.shares > 0) out.shares = r.shares;
  if (finite(r.netDebt)) out.netDebt = r.netDebt;
  if (r.reportingCurrency === 'TRY' || r.reportingCurrency === 'USD') out.reportingCurrency = r.reportingCurrency;
  if (finite(r.currentFx) && r.currentFx > 0) out.currentFx = r.currentFx;
  if (finite(r.ttmEps)) out.ttmEps = r.ttmEps;
  if (Array.isArray(r.dividendYears)) {
    const seen = new Set<number>();
    const dividendYears: { year: number; amount: number }[] = [];
    for (const d of r.dividendYears) {
      const e = d as Record<string, unknown> | null;
      if (!e || !finite(e.year) || !Number.isInteger(e.year) || !finite(e.amount) || e.amount < 0 || seen.has(e.year)) continue;
      seen.add(e.year);
      dividendYears.push({ year: e.year, amount: e.amount });
    }
    out.dividendYears = dividendYears.sort((a, b) => a.year - b.year);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeGrahamInputs(raw: unknown): Record<string, GrahamManual> {
  const out: Record<string, GrahamManual> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [ticker, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_TICKERS) break;
    const key = ticker.trim().toUpperCase();
    const manual = sanitizeGrahamManual(value);
    if (key && manual) out[key] = manual;
  }
  return out;
}

export class GrahamInputsStore {
  private inputs: Record<string, GrahamManual>;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike) {
    this.inputs = this.load();
  }

  private load(): Record<string, GrahamManual> {
    try {
      return sanitizeGrahamInputs(JSON.parse(this.storage.getItem(GRAHAM_INPUTS_KEY) ?? '{}'));
    } catch {
      return {};
    }
  }

  private commit(next: Record<string, GrahamManual>): void {
    this.inputs = next;
    try {
      this.storage.setItem(GRAHAM_INPUTS_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): Record<string, GrahamManual> => this.inputs;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(ticker: string): GrahamManual | undefined {
    return this.inputs[ticker.toUpperCase()];
  }

  /** Speichert die Eingaben einer Aktie. Leere Eingaben (nichts überschrieben) entfernen den Eintrag. */
  set(ticker: string, manual: GrahamManual): void {
    const key = ticker.toUpperCase();
    const clean = sanitizeGrahamManual(manual);
    if (!clean) return this.clear(key);
    this.commit({ ...this.inputs, [key]: clean });
  }

  clear(ticker: string): void {
    const key = ticker.toUpperCase();
    if (!(key in this.inputs)) return;
    const { [key]: _removed, ...rest } = this.inputs;
    this.commit(rest);
  }
}

export const grahamInputsStore = new GrahamInputsStore(appStorage);

export function useGrahamInputs(): Record<string, GrahamManual> {
  return useSyncExternalStore(grahamInputsStore.subscribe, grahamInputsStore.getSnapshot);
}
