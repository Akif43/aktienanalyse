export type AlertRuleType = 'dailyLow' | 'range52w' | 'priceAbove' | 'priceBelow' | 'dailyMove' | 'news';

export const ALERT_RULE_TYPES: readonly AlertRuleType[] = ['dailyLow', 'range52w', 'priceAbove', 'priceBelow', 'dailyMove', 'news'];

/** Regeltypen, die einen Zahlenwert brauchen (Kursschwelle bzw. Prozent). */
export const THRESHOLD_RULE_TYPES: readonly AlertRuleType[] = ['priceAbove', 'priceBelow', 'dailyMove'];

/** Eine Alarmregel für eine Aktie. Höchstens eine je (ticker, type) — id = `${ticker}:${type}`. */
export interface AlertRule {
  id: string;
  /** Yahoo-Ticker, z. B. "THYAO.IS". */
  ticker: string;
  type: AlertRuleType;
  enabled: boolean;
  /** Kursschwelle (priceAbove/priceBelow) bzw. Prozent (dailyMove). Bei den übrigen Typen ungenutzt. */
  threshold?: number;
}

/** Zustand einer Regel zwischen zwei Monitor-Läufen (sonst würden zustandslose Läufe doppelt melden). */
export interface AlertRuleState {
  /** Hysterese: nur wenn `armed`, kann die Regel feuern; feuert sie, wird `armed` false, bis die Bedingung wieder verlässt. */
  armed: boolean;
  /** Kalendertag der Börse (YYYY-MM-DD), für den `countToday` gilt. */
  dayKey: string;
  countToday: number;
  lastTriggeredAt?: number;
  /** Nur dailyLow: das zuletzt gemeldete Tagestief. */
  lastDailyLow?: number;
  /** Nur news: zuletzt gesehene Meldungs-IDs (FIFO, begrenzt), zur Vermeidung von Doppel-Alarmen. */
  seenNewsIds?: string[];
}

export const MAX_ALERTS_PER_DAY = 3;
/** scoreNewsItem() liefert 0–100, unkalibriert. Fester Startwert, kann später per Env angepasst werden. */
export const NEWS_SCORE_THRESHOLD = 60;
export const MAX_SEEN_NEWS_IDS = 50;

export function alertRuleId(ticker: string, type: AlertRuleType): string {
  return `${ticker}:${type}`;
}

export function isAlertRuleType(value: unknown): value is AlertRuleType {
  return (ALERT_RULE_TYPES as readonly string[]).includes(value as string);
}
