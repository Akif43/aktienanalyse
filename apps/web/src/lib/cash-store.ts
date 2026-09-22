import { useSyncExternalStore } from 'react';
import { appStorage, CASH_KEY, type StorageLike } from './storage';

export type CashCurrency = 'TRY' | 'USD' | 'EUR';
export type CashHoldings = Record<CashCurrency, number>;

const CURRENCIES: readonly CashCurrency[] = ['TRY', 'USD', 'EUR'];
const EMPTY: CashHoldings = { TRY: 0, USD: 0, EUR: 0 };

/** Prüft und bereinigt gelesene Daten (kaputte oder manuell bearbeitete Einträge). */
export function sanitizeCash(raw: unknown): CashHoldings {
  const out = { ...EMPTY };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const c of CURRENCIES) {
    const n = Number(r[c]);
    if (Number.isFinite(n) && n >= 0) out[c] = n;
  }
  return out;
}

/** Bargeld je Währung (TRY/USD/EUR), unabhängig vom Depot der Aktien/Fonds. Mit Persistenz und Abo-Mechanismus. */
export class CashStore {
  private cash: CashHoldings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike) {
    this.cash = this.load();
  }

  private load(): CashHoldings {
    try {
      return sanitizeCash(JSON.parse(this.storage.getItem(CASH_KEY) ?? 'null'));
    } catch {
      return { ...EMPTY };
    }
  }

  private commit(next: CashHoldings): void {
    this.cash = next;
    try {
      this.storage.setItem(CASH_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Wert bleibt für diese Sitzung erhalten */
    }
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): CashHoldings => this.cash;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Setzt den Bargeldbestand einer Währung (ersetzt den bisherigen Wert). */
  set(currency: CashCurrency, amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    this.commit({ ...this.cash, [currency]: amount });
  }
}

export const cashStore = new CashStore(appStorage);

export function useCash(): CashHoldings {
  return useSyncExternalStore(cashStore.subscribe, cashStore.getSnapshot);
}
