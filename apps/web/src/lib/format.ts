import type { Freshness, Market } from '@aktien/core';
import { getLang, localeOf, translate, type Lang } from './i18n';

const TZ: Record<Market, string> = { BIST: 'Europe/Istanbul', XETRA: 'Europe/Berlin', US: 'America/New_York' };
export const marketTimezone = (m: Market) => TZ[m];

const MARKET_NAME: Record<Market, string> = { BIST: 'BIST', XETRA: 'XETRA', US: 'US' };
export const marketName = (m: Market) => MARKET_NAME[m];

// Alle Formatierer nehmen optional die Sprache, sonst gilt die aktuell gewählte (ein Sprachwechsel baut die Oberfläche neu auf).
const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number, extra: Intl.NumberFormatOptions = {}, lang: Lang = getLang()): Intl.NumberFormat {
  const key = `${lang}-${min}-${max}-${JSON.stringify(extra)}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: min, maximumFractionDigits: max, ...extra })));
  return f;
}

/** Zahl mit passender Nachkommastellenzahl (kleine Kurse brauchen mehr Stellen). */
export function formatNumber(value: number | null | undefined, maxDigits?: number, lang?: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const digits = maxDigits ?? (Math.abs(value) < 10 ? 4 : 2);
  return nf(2, Math.max(2, digits), {}, lang).format(value);
}

/** Ganze Zahl ohne Nachkommastellen (z. B. Anlegerzahl). Anders als formatNumber, das immer mindestens 2 Nachkommastellen zeigt. */
export function formatCount(value: number | null | undefined, lang?: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return nf(0, 0, {}, lang).format(value);
}

const SYMBOL: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
export function formatPrice(value: number | null | undefined, currency?: string, lang?: Lang): string {
  const n = formatNumber(value, undefined, lang);
  return n === '–' || !currency ? n : `${n} ${SYMBOL[currency] ?? currency}`;
}

/** Prozentwert: deutsch "1,23 %", türkisch "%1,23" (das Zeichen steht im Türkischen davor). */
export function formatPercent(value: number | null | undefined, signed = true, lang: Lang = getLang()): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const s = nf(2, 2, {}, lang).format(Math.abs(value));
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const prefix = signed ? sign : value < 0 ? '−' : '';
  return lang === 'tr' ? `${prefix}%${s}` : `${prefix}${s} %`;
}

export function formatSigned(value: number | null | undefined, lang?: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), undefined, lang)}`;
}

export function formatVolume(value: number | null | undefined, lang?: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return nf(0, 1, { notation: 'compact' }, lang).format(value);
}

const dayKey = (ms: number, tz: string, lang: Lang) => new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, dateStyle: 'short' }).format(ms);

/** Uhrzeit (heute) bzw. Datum und Uhrzeit eines Kurses in der Zeitzone der Börse. */
export function formatAsOf(unixSec: number, market: Market, nowMs: number = Date.now(), lang: Lang = getLang()): string {
  const tz = TZ[market];
  const ms = unixSec * 1000;
  const locale = localeOf(lang);
  if (dayKey(ms, tz, lang) === dayKey(nowMs, tz, lang)) {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, timeStyle: 'short' }).format(ms);
  }
  return new Intl.DateTimeFormat(locale, { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function formatDate(ms: number, lang: Lang = getLang()): string {
  return new Intl.DateTimeFormat(localeOf(lang), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);
}

export function formatTime(ms: number, lang: Lang = getLang()): string {
  return new Date(ms).toLocaleTimeString(localeOf(lang));
}

/** "vor 5 Min.", "vor 3 Std.", "vor 2 Tagen", sonst Datum (in der gewählten Sprache). */
export function formatRelative(ms: number, nowMs: number = Date.now(), lang: Lang = getLang()): string {
  const diff = Math.max(0, nowMs - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return translate('time.justNow', undefined, lang);
  if (min < 60) return translate('time.minAgo', { n: min }, lang);
  const h = Math.floor(min / 60);
  if (h < 24) return translate('time.hourAgo', { n: h }, lang);
  const d = Math.floor(h / 24);
  if (d < 7) return translate(d === 1 ? 'time.dayAgo' : 'time.daysAgo', { n: d }, lang);
  return formatDate(ms, lang);
}

/** Beschriftung der Aktualität in einfacher Sprache ("Live", "ca. 15 Min. verzögert"). */
export function freshnessText(freshness: Freshness, lang?: Lang): string {
  switch (freshness.kind) {
    case 'realtime':
      return translate('fresh.realtime', undefined, lang);
    case 'delayed':
      return translate('fresh.delayed', { minutes: freshness.minutes }, lang);
    case 'eod':
      return translate('fresh.eod', undefined, lang);
  }
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

//  erkennt türkische Buchstaben (ş, ı …) nicht als Wortzeichen, daher Lookahead auf Leerraum/Ende
const LEGAL_SUFFIX = /\s+(?:anonim\s+ortakl[ıi]g[ıi]|anonim\s+[sş]irketi|a\.?\s?[sş]\.?|a\.?\s?o\.?|inc\.?|corp\.?|corporation|ltd\.?|plc|se|ag|kgaa|holding)(?=\s|$)/gi;

/** Firmenname für die News-Suche ohne Rechtsform ("Türk Hava Yollari Anonim Ortakligi" → "Türk Hava Yollari"). */
export function newsSearchName(name: string): string {
  const cleaned = name.replace(LEGAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
  return cleaned || name.trim();
}
