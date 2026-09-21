import { useSyncExternalStore } from 'react';
import { parseInstrument, toYahooSymbol, type Market } from '@aktien/core';
import { appStorage, WATCHLIST_KEY, type StorageLike } from './storage';

export interface WatchItem {
  /** Yahoo-Ticker, z. B. THYAO.IS. Dient als eindeutiger Schlüssel. */
  ticker: string;
  symbol: string;
  market: Market;
  name?: string;
  addedAt: number;
}

export const EXAMPLE_TICKERS: { ticker: string; name: string }[] = [
  { ticker: 'THYAO.IS', name: 'Türk Hava Yolları' },
  { ticker: 'ASELS.IS', name: 'Aselsan' },
  { ticker: 'BIMAS.IS', name: 'BİM Birleşik Mağazalar' },
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'SAP.DE', name: 'SAP SE' },
];

export const MAX_WATCHLIST_ITEMS = 50;

/** Prüft und bereinigt gelesene Daten (alte Versionen, manuell bearbeitete oder kaputte Einträge). */
export function sanitize(raw: unknown): WatchItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WatchItem[] = [];
  for (const r of raw) {
    if (out.length >= MAX_WATCHLIST_ITEMS) break;
    if (!r || typeof r !== 'object' || typeof (r as { ticker?: unknown }).ticker !== 'string') continue;
    const entry = r as { ticker: string; name?: unknown; addedAt?: unknown };
    try {
      const inst = parseInstrument(entry.ticker);
      const ticker = toYahooSymbol(inst);
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      const name = typeof entry.name === 'string' ? entry.name.slice(0, 80) : undefined;
      out.push({ ticker, symbol: inst.symbol, market: inst.market, name, addedAt: Number(entry.addedAt) || 0 });
    } catch {
      /* ungültiger Ticker: Eintrag verwerfen */
    }
  }
  return out;
}

/** Watchlist mit Persistenz und Abo-Mechanismus (für useSyncExternalStore). */
export class WatchlistStore {
  private items: WatchItem[];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => number = Date.now,
  ) {
    this.items = this.load();
  }

  private load(): WatchItem[] {
    try {
      return sanitize(JSON.parse(this.storage.getItem(WATCHLIST_KEY) ?? '[]'));
    } catch {
      return [];
    }
  }

  private commit(next: WatchItem[]): void {
    this.items = next;
    try {
      this.storage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Liste bleibt für diese Sitzung erhalten */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): WatchItem[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  has(ticker: string): boolean {
    return this.items.some((i) => i.ticker === ticker.toUpperCase());
  }

  /** Fügt hinzu (oder aktualisiert den Namen). Gibt false zurück, wenn die Liste voll ist. */
  add(input: string, name?: string): boolean {
    const inst = parseInstrument(input);
    const ticker = toYahooSymbol(inst);
    const existing = this.items.find((i) => i.ticker === ticker);
    if (existing) {
      if (name && name !== existing.name) this.commit(this.items.map((i) => (i === existing ? { ...i, name } : i)));
      return true;
    }
    if (this.items.length >= MAX_WATCHLIST_ITEMS) return false;
    this.commit([...this.items, { ticker, symbol: inst.symbol, market: inst.market, name, addedAt: this.now() }]);
    return true;
  }

  remove(ticker: string): void {
    const t = ticker.toUpperCase();
    if (this.has(t)) this.commit(this.items.filter((i) => i.ticker !== t));
  }

  /** Ersetzt die Liste vollständig (Import). Gibt die Anzahl übernommener Einträge zurück. */
  replaceAll(raw: unknown): number {
    const next = sanitize(raw);
    this.commit(next);
    return next.length;
  }

  exportJson(): string {
    return JSON.stringify(
      this.items.map(({ ticker, name, addedAt }) => ({ ticker, name, addedAt })),
      null,
      2,
    );
  }
}

export const watchlistStore = new WatchlistStore(appStorage);

export function useWatchlist(): WatchItem[] {
  return useSyncExternalStore(watchlistStore.subscribe, watchlistStore.getSnapshot);
}
