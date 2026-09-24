import { marketState } from '../format';
import type { Range52w } from '../indicators/signals';
import { scoreNewsItem } from '../adapters/news/score';
import type { Instrument, NewsItem, Quote } from '../types';
import { MAX_ALERTS_PER_DAY, MAX_SEEN_NEWS_IDS, NEWS_SCORE_THRESHOLD, type AlertRule, type AlertRuleState } from './types';

export interface AlertContext {
  instrument: Instrument;
  quote: Quote;
  range52w?: Range52w;
  /** Nur neue, noch nicht analysierte Meldungen seit dem letzten Lauf. */
  news?: readonly NewsItem[];
}

export interface AlertResult {
  fire: boolean;
  nextState: AlertRuleState;
  /** Bei `fire`: die Meldung, die den News-Alarm ausgelöst hat. */
  triggeringNews?: NewsItem;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** Kalendertag (YYYY-MM-DD) am Handelsplatz, für Tageszähler und Tagestief-Vergleich. */
export function dayKeyAt(unixMs: number, tz: string): string {
  let f = dayFormatters.get(tz);
  if (!f) dayFormatters.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(unixMs);
}

function emptyState(dayKey: string): AlertRuleState {
  return { armed: true, dayKey, countToday: 0 };
}

/**
 * Setzt Tageszähler und Feuerbereitschaft zurück, wenn seit dem letzten Lauf ein neuer Börsentag
 * begonnen hat (ein gestriger Schwellenwert-Durchbruch soll heute nicht dauerhaft stumm bleiben).
 */
function rollDay(state: AlertRuleState, dayKey: string): AlertRuleState {
  if (state.dayKey === dayKey) return state;
  return { ...state, dayKey, countToday: 0, armed: true };
}

/**
 * Prüft eine einzelne Regel gegen den aktuellen Marktzustand. Reine Funktion: nimmt Regel, letzten
 * Zustand und Kontext, liefert, ob sie feuern soll, sowie den Folgezustand (zum Zurückschreiben).
 * Feuert nie, wenn die Börse laut `marketState()` nicht geöffnet ist, und nie öfter als
 * `MAX_ALERTS_PER_DAY` je Regel und Tag.
 */
export function evaluateRule(rule: AlertRule, prevState: AlertRuleState | undefined, ctx: AlertContext, tz: string, now: number = Date.now()): AlertResult {
  const dayKey = dayKeyAt(now, tz);
  let state = rollDay(prevState ?? emptyState(dayKey), dayKey);

  if (!rule.enabled) return { fire: false, nextState: state };
  if (marketState(ctx.quote, now) !== 'open') return { fire: false, nextState: state };
  if (state.countToday >= MAX_ALERTS_PER_DAY) return { fire: false, nextState: state };

  switch (rule.type) {
    case 'priceAbove':
      return hysteresis(state, rule.threshold !== undefined && ctx.quote.price > rule.threshold);
    case 'priceBelow':
      return hysteresis(state, rule.threshold !== undefined && ctx.quote.price < rule.threshold);
    case 'dailyMove':
      return hysteresis(state, rule.threshold !== undefined && ctx.quote.changePercent !== null && Math.abs(ctx.quote.changePercent) >= rule.threshold);
    case 'range52w':
      return hysteresis(state, ctx.range52w !== undefined && (ctx.quote.price >= ctx.range52w.high || ctx.quote.price <= ctx.range52w.low));
    case 'dailyLow':
      return evaluateDailyLow(state, ctx.quote.dayLow);
    case 'news':
      return evaluateNews(state, ctx, now);
  }
}

/** Feuert nur beim Übergang "nicht erfüllt" → "erfüllt" (kein Dauerfeuer, während der Zustand anhält). */
function hysteresis(state: AlertRuleState, conditionMet: boolean): AlertResult {
  if (!conditionMet) return { fire: false, nextState: { ...state, armed: true } };
  if (!state.armed) return { fire: false, nextState: state };
  return { fire: true, nextState: { ...state, armed: false, countToday: state.countToday + 1, lastTriggeredAt: Date.now() } };
}

/** Höchstens 1x je Tag: erst wieder feuerbereit, sobald `rollDay` den Tag gewechselt hat. */
function evaluateDailyLow(state: AlertRuleState, dayLow: number | null): AlertResult {
  if (dayLow === null || !state.armed) return { fire: false, nextState: state };
  if (state.lastDailyLow !== undefined && dayLow >= state.lastDailyLow) return { fire: false, nextState: state };
  return { fire: true, nextState: { ...state, armed: false, lastDailyLow: dayLow, countToday: state.countToday + 1, lastTriggeredAt: Date.now() } };
}

function evaluateNews(state: AlertRuleState, ctx: AlertContext, now: number): AlertResult {
  const seen = new Set(state.seenNewsIds ?? []);
  const candidate = (ctx.news ?? []).find((item) => !seen.has(item.id) && scoreNewsItem(item, ctx.instrument, now) >= NEWS_SCORE_THRESHOLD);
  if (!candidate) return { fire: false, nextState: state };
  const seenNewsIds = [...(state.seenNewsIds ?? []), candidate.id].slice(-MAX_SEEN_NEWS_IDS);
  return { fire: true, nextState: { ...state, seenNewsIds, countToday: state.countToday + 1, lastTriggeredAt: Date.now() }, triggeringNews: candidate };
}

export interface AlertMessage {
  title: string;
  body: string;
}

/** Deutscher Benachrichtigungstext für eine ausgelöste Regel (unabhängig von der Feuer-Entscheidung testbar). */
export function describeAlert(rule: AlertRule, ctx: AlertContext, triggeringNews?: NewsItem): AlertMessage {
  const symbol = ctx.instrument.symbol;
  const price = `${ctx.quote.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ctx.quote.currency}`;
  switch (rule.type) {
    case 'priceAbove':
      return { title: `${symbol}: Kurs über ${rule.threshold}`, body: `Aktueller Kurs: ${price}` };
    case 'priceBelow':
      return { title: `${symbol}: Kurs unter ${rule.threshold}`, body: `Aktueller Kurs: ${price}` };
    case 'dailyMove': {
      const pct = ctx.quote.changePercent?.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) ?? '?';
      return { title: `${symbol}: starke Tagesbewegung`, body: `${pct} % heute, Kurs ${price}` };
    }
    case 'range52w': {
      const atHigh = ctx.range52w !== undefined && ctx.quote.price >= ctx.range52w.high;
      return { title: `${symbol}: ${atHigh ? '52-Wochen-Hoch' : '52-Wochen-Tief'}`, body: `Kurs ${price}` };
    }
    case 'dailyLow':
      return { title: `${symbol}: neues Tagestief`, body: `Tagestief ${price}` };
    case 'news':
      return { title: `${symbol}: wichtige Meldung`, body: triggeringNews?.title ?? '' };
  }
}
