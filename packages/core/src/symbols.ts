import type { Instrument, Market } from './types';

const YAHOO_SUFFIX: Record<Market, string> = {
  BIST: '.IS',
  XETRA: '.DE',
  US: '',
};

export const MARKET_TIMEZONE: Record<Market, string> = {
  BIST: 'Europe/Istanbul',
  XETRA: 'Europe/Berlin',
  US: 'America/New_York',
};

export const MARKET_CURRENCY: Record<Market, string> = {
  BIST: 'TRY',
  XETRA: 'EUR',
  US: 'USD',
};

/** Yahoo-Ticker für ein Instrument, z. B. THYAO → THYAO.IS. */
export function toYahooSymbol(instrument: Instrument): string {
  return `${instrument.symbol.toUpperCase()}${YAHOO_SUFFIX[instrument.market]}`;
}

/**
 * Wandelt Nutzereingaben in ein Instrument um. Akzeptiert "THYAO.IS", "SAP.DE"
 * (Suffix bestimmt den Markt) sowie "AAPL" (dann gilt `defaultMarket`).
 */
export function parseInstrument(input: string, defaultMarket: Market = 'US'): Instrument {
  const raw = input.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(raw)) {
    throw new Error(`Ungültiges Kürzel: "${input}"`);
  }
  if (raw.endsWith('.IS')) return { symbol: raw.slice(0, -3), market: 'BIST' };
  if (raw.endsWith('.DE')) return { symbol: raw.slice(0, -3), market: 'XETRA' };
  return { symbol: raw, market: defaultMarket };
}

export function instrumentKey(instrument: Instrument): string {
  return `${instrument.market}:${instrument.symbol.toUpperCase()}`;
}
