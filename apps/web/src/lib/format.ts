import type { Market } from '@aktien/core';

const TZ: Record<Market, string> = { BIST: 'Europe/Istanbul', XETRA: 'Europe/Berlin', US: 'America/New_York' };
export const marketTimezone = (m: Market) => TZ[m];

const MARKET_NAME: Record<Market, string> = { BIST: 'BIST', XETRA: 'XETRA', US: 'US' };
export const marketName = (m: Market) => MARKET_NAME[m];

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number, extra: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${min}-${max}-${JSON.stringify(extra)}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra })));
  return f;
}

/** Zahl mit passender Nachkommastellenzahl (kleine Kurse brauchen mehr Stellen). */
export function formatNumber(value: number | null | undefined, maxDigits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const digits = maxDigits ?? (Math.abs(value) < 10 ? 4 : 2);
  return nf(2, Math.max(2, digits)).format(value);
}

const SYMBOL: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
export function formatPrice(value: number | null | undefined, currency?: string): string {
  const n = formatNumber(value);
  return n === '–' || !currency ? n : `${n} ${SYMBOL[currency] ?? currency}`;
}

export function formatPercent(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const s = nf(2, 2).format(Math.abs(value));
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${signed ? sign : value < 0 ? '−' : ''}${s} %`;
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value))}`;
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return nf(0, 1, { notation: 'compact' }).format(value);
}

const dayKey = (ms: number, tz: string) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, dateStyle: 'short' }).format(ms);

/** Uhrzeit (heute) bzw. Datum und Uhrzeit eines Kurses in der Zeitzone der Börse. */
export function formatAsOf(unixSec: number, market: Market, nowMs: number = Date.now()): string {
  const tz = TZ[market];
  const ms = unixSec * 1000;
  if (dayKey(ms, tz) === dayKey(nowMs, tz)) {
    return new Intl.DateTimeFormat('de-DE', { timeZone: tz, timeStyle: 'short' }).format(ms);
  }
  return new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);
}

/** "vor 5 Min.", "vor 3 Std.", "vor 2 Tagen", sonst Datum. */
export function formatRelative(ms: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
  return formatDate(ms);
}

export type Direction = 'up' | 'down' | 'flat';
export const direction = (v: number | null | undefined): Direction => (v && v > 0 ? 'up' : v && v < 0 ? 'down' : 'flat');

/** Erlaubt nur http(s)-Links aus fremden Quellen (kein javascript: oder data:). */
export function safeHref(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

//  erkennt türkische Buchstaben (ş, ı …) nicht als Wortzeichen, daher Lookahead auf Leerraum/Ende
const LEGAL_SUFFIX = /\s+(?:anonim\s+ortakl[ıi]g[ıi]|anonim\s+[sş]irketi|a\.?\s?[sş]\.?|a\.?\s?o\.?|inc\.?|corp\.?|corporation|ltd\.?|plc|se|ag|kgaa|holding)(?=\s|$)/gi;

/** Firmenname für die News-Suche ohne Rechtsform ("Türk Hava Yollari Anonim Ortakligi" → "Türk Hava Yollari"). */
export function newsSearchName(name: string): string {
  const cleaned = name.replace(LEGAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
  return cleaned || name.trim();
}
