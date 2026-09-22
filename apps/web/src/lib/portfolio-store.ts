import type { Market } from '@aktien/core';
import { useSyncExternalStore } from 'react';
import { appStorage, PORTFOLIO_KEY, type StorageLike } from './storage';

/** Ein einzelner Kauf: Stückzahl und Preis je Stück in der Landeswährung des Wertpapiers, plus Datum. */
export interface Lot {
  id: string;
  quantity: number;
  price: number;
  /** Unix-Millisekunden (nur das Datum ist gemeint, Uhrzeit ohne Bedeutung). */
  date: number;
}

export interface PortfolioPosition {
  kind: 'stock' | 'fund';
  /** Eindeutiger Schlüssel: Yahoo-Ticker (Aktie, z. B. "THYAO.IS") oder Fonds-Kürzel (z. B. "AFT"). */
  key: string;
  symbol: string;
  market?: Market;
  name?: string;
  lots: Lot[];
}

const MAX_POSITIONS = 100;
const MAX_LOTS_PER_POSITION = 200;
const MARKETS: readonly Market[] = ['BIST', 'XETRA', 'US'];

function sanitizeLot(raw: unknown, makeId: () => string): Lot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; quantity?: unknown; price?: unknown; date?: unknown };
  const quantity = Number(r.quantity);
  const price = Number(r.price);
  const date = Number(r.date);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : makeId();
  return { id, quantity, price, date: Number.isFinite(date) && date > 0 ? date : Date.now() };
}

/** Prüft und bereinigt gelesene Daten (kaputte oder manuell bearbeitete Einträge). */
export function sanitizePositions(raw: unknown, makeId: () => string = defaultId): PortfolioPosition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PortfolioPosition[] = [];
  for (const r of raw) {
    if (out.length >= MAX_POSITIONS) break;
    if (!r || typeof r !== 'object') continue;
    const entry = r as { kind?: unknown; key?: unknown; symbol?: unknown; market?: unknown; name?: unknown; lots?: unknown };
    if (entry.kind !== 'stock' && entry.kind !== 'fund') continue;
    const key = typeof entry.key === 'string' ? entry.key.trim().toUpperCase() : '';
    if (!key || seen.has(key)) continue;
    if (entry.kind === 'stock' && !MARKETS.includes(entry.market as Market)) continue;
    const lots = (Array.isArray(entry.lots) ? entry.lots : [])
      .map((l) => sanitizeLot(l, makeId))
      .filter((l): l is Lot => l !== null)
      .slice(0, MAX_LOTS_PER_POSITION);
    if (lots.length === 0) continue; // Position ohne Käufe ist bedeutungslos
    seen.add(key);
    out.push({
      kind: entry.kind,
      key,
      symbol: typeof entry.symbol === 'string' ? entry.symbol.slice(0, 20) : key,
      market: entry.kind === 'stock' ? (entry.market as Market) : undefined,
      name: typeof entry.name === 'string' ? entry.name.slice(0, 120) : undefined,
      lots,
    });
  }
  return out;
}

let counter = 0;
function defaultId(): string {
  return `${Date.now()}-${counter++}`;
}

export interface NewPosition {
  kind: 'stock' | 'fund';
  key: string;
  symbol: string;
  market?: Market;
  name?: string;
}
export interface NewLot {
  quantity: number;
  price: number;
  date: number;
}

/** Depot (Käufe je Aktie/Fonds) mit Persistenz und Abo-Mechanismus (für useSyncExternalStore). */
export class PortfolioStore {
  private positions: PortfolioPosition[];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: StorageLike,
    private readonly makeId: () => string = defaultId,
  ) {
    this.positions = this.load();
  }

  private load(): PortfolioPosition[] {
    try {
      return sanitizePositions(JSON.parse(this.storage.getItem(PORTFOLIO_KEY) ?? '[]'), this.makeId);
    } catch {
      return [];
    }
  }

  private commit(next: PortfolioPosition[]): void {
    this.positions = next;
    try {
      this.storage.setItem(PORTFOLIO_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Depot bleibt für diese Sitzung erhalten */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): PortfolioPosition[] => this.positions;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  position(key: string): PortfolioPosition | undefined {
    const k = key.toUpperCase();
    return this.positions.find((p) => p.key === k);
  }

  /** Fügt einen Kauf hinzu; legt die Position an, falls sie noch nicht existiert. */
  addLot(instrument: NewPosition, lot: NewLot): void {
    if (!(lot.quantity > 0) || !(lot.price >= 0)) return;
    const key = instrument.key.toUpperCase();
    const newLot: Lot = { id: this.makeId(), quantity: lot.quantity, price: lot.price, date: lot.date };
    const existing = this.positions.find((p) => p.key === key);
    if (existing) {
      if (existing.lots.length >= MAX_LOTS_PER_POSITION) return;
      this.commit(this.positions.map((p) => (p === existing ? { ...p, name: instrument.name ?? p.name, lots: [...p.lots, newLot] } : p)));
      return;
    }
    if (this.positions.length >= MAX_POSITIONS) return;
    this.commit([...this.positions, { kind: instrument.kind, key, symbol: instrument.symbol, market: instrument.market, name: instrument.name, lots: [newLot] }]);
  }

  /** Entfernt einen einzelnen Kauf. Ist es der letzte, verschwindet die Position ganz. */
  removeLot(key: string, lotId: string): void {
    const k = key.toUpperCase();
    const existing = this.positions.find((p) => p.key === k);
    if (!existing) return;
    const lots = existing.lots.filter((l) => l.id !== lotId);
    this.commit(lots.length === 0 ? this.positions.filter((p) => p !== existing) : this.positions.map((p) => (p === existing ? { ...p, lots } : p)));
  }

  removePosition(key: string): void {
    const k = key.toUpperCase();
    if (this.positions.some((p) => p.key === k)) this.commit(this.positions.filter((p) => p.key !== k));
  }

  /** Ersetzt das Depot vollständig (Import). Gibt die Anzahl übernommener Positionen zurück. */
  replaceAll(raw: unknown): number {
    const next = sanitizePositions(raw, this.makeId);
    this.commit(next);
    return next.length;
  }

  exportJson(): string {
    return JSON.stringify(this.positions, null, 2);
  }
}

export const portfolioStore = new PortfolioStore(appStorage);

export function usePortfolio(): PortfolioPosition[] {
  return useSyncExternalStore(portfolioStore.subscribe, portfolioStore.getSnapshot);
}
