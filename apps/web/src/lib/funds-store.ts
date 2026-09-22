import { useSyncExternalStore } from 'react';
import { appStorage, FUNDS_KEY, type StorageLike } from './storage';

export interface FundWatchItem {
  /** TEFAS-Kürzel in Großbuchstaben, z. B. "AFT". Dient als eindeutiger Schlüssel. */
  code: string;
  name?: string;
  addedAt: number;
}

/** Zwei Beispiele, wie in der Aktien-Watchlist: eine Hisse-Senedi-Fonu und eine bekannte Rentenfonds-Art. */
export const EXAMPLE_FUNDS: { code: string; name: string }[] = [
  { code: 'AFT', name: 'AK Portföy Yeni Teknolojiler Yabancı Hisse Senedi Fonu' },
  { code: 'YAY', name: 'Yapı Kredi Portföy Yabancı Teknoloji Sektörü Hisse Senedi Fonu' },
];

export const MAX_FUND_ITEMS = 50;
const CODE_RE = /^[A-Z0-9]{1,10}$/;

/** Prüft und bereinigt gelesene Daten (kaputte oder manuell bearbeitete Einträge). */
export function sanitizeFunds(raw: unknown): FundWatchItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FundWatchItem[] = [];
  for (const r of raw) {
    if (out.length >= MAX_FUND_ITEMS) break;
    if (!r || typeof r !== 'object' || typeof (r as { code?: unknown }).code !== 'string') continue;
    const entry = r as { code: string; name?: unknown; addedAt?: unknown };
    const code = entry.code.trim().toUpperCase();
    if (!CODE_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    const name = typeof entry.name === 'string' ? entry.name.slice(0, 120) : undefined;
    out.push({ code, name, addedAt: Number(entry.addedAt) || 0 });
  }
  return out;
}

/** Fonds-Merkliste mit Persistenz und Abo-Mechanismus (für useSyncExternalStore). Eigene Liste, getrennt von der Aktien-Watchlist. */
export class FundStore {
  private items: FundWatchItem[];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => number = Date.now,
  ) {
    this.items = this.load();
  }

  private load(): FundWatchItem[] {
    try {
      return sanitizeFunds(JSON.parse(this.storage.getItem(FUNDS_KEY) ?? '[]'));
    } catch {
      return [];
    }
  }

  private commit(next: FundWatchItem[]): void {
    this.items = next;
    try {
      this.storage.setItem(FUNDS_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Liste bleibt für diese Sitzung erhalten */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): FundWatchItem[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  has(code: string): boolean {
    return this.items.some((i) => i.code === code.toUpperCase());
  }

  /** Fügt hinzu (oder aktualisiert den Namen). Gibt false zurück, wenn die Liste voll ist. */
  add(input: string, name?: string): boolean {
    const code = input.trim().toUpperCase();
    if (!CODE_RE.test(code)) return false;
    const existing = this.items.find((i) => i.code === code);
    if (existing) {
      if (name && name !== existing.name) this.commit(this.items.map((i) => (i === existing ? { ...i, name } : i)));
      return true;
    }
    if (this.items.length >= MAX_FUND_ITEMS) return false;
    this.commit([...this.items, { code, name, addedAt: this.now() }]);
    return true;
  }

  remove(code: string): void {
    const c = code.toUpperCase();
    if (this.has(c)) this.commit(this.items.filter((i) => i.code !== c));
  }

  /** Ersetzt die Liste vollständig (Import). Gibt die Anzahl übernommener Einträge zurück. */
  replaceAll(raw: unknown): number {
    const next = sanitizeFunds(raw);
    this.commit(next);
    return next.length;
  }

  exportJson(): string {
    return JSON.stringify(
      this.items.map(({ code, name, addedAt }) => ({ code, name, addedAt })),
      null,
      2,
    );
  }
}

export const fundStore = new FundStore(appStorage);

export function useFundWatchlist(): FundWatchItem[] {
  return useSyncExternalStore(fundStore.subscribe, fundStore.getSnapshot);
}
