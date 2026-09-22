/** Minimales Speicher-Interface (localStorage, in Tests ein Fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * localStorage kann fehlen oder werfen (privater Modus, blockierte Website-Daten). Alle Zugriffe sind
 * deshalb abgesichert, die App funktioniert dann ohne Persistenz weiter.
 */
export function safeStorage(): StorageLike {
  const fallback = new Map<string, string>();
  const memory: StorageLike = {
    getItem: (k) => fallback.get(k) ?? null,
    setItem: (k, v) => void fallback.set(k, v),
    removeItem: (k) => void fallback.delete(k),
  };
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memory;
    ls.setItem('__probe', '1');
    ls.removeItem('__probe');
    return ls;
  } catch {
    return memory;
  }
}

export const appStorage = safeStorage();
export const TOKEN_KEY = 'aktien.token';
export const WATCHLIST_KEY = 'aktien.watchlist.v1';
export const QUOTES_CACHE_KEY = 'aktien.quotes.v1';
export const LANG_KEY = 'aktien.lang';
export const DETAILS_KEY = 'aktien.details.open';
export const FUNDS_KEY = 'aktien.funds.v1';
export const PORTFOLIO_KEY = 'aktien.portfolio.v1';
export const CASH_KEY = 'aktien.portfolio.cash.v1';
