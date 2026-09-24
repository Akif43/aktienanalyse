import { describe, expect, it } from 'vitest';
import { alertRuleId, dayKeyAt, describeAlert, evaluateRule, isAlertRuleType, MAX_ALERTS_PER_DAY, type AlertContext, type AlertRule, type AlertRuleState } from '../src';
import type { Instrument, NewsItem, Quote } from '../src';

const TZ = 'Europe/Istanbul';
const NOW = Date.parse('2026-09-22T10:00:00+03:00'); // während der Handelszeit

const INSTRUMENT: Instrument = { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' };

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'THYAO',
    market: 'BIST',
    price: 300,
    previousClose: 295,
    change: 5,
    changePercent: 1.7,
    dayHigh: 302,
    dayLow: 294,
    volume: 1000,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    currency: 'TRY',
    asOf: NOW / 1000,
    freshness: { kind: 'delayed', minutes: 15 },
    source: 'yahoo',
    session: { start: NOW / 1000 - 3600, end: NOW / 1000 + 3600 },
    ...overrides,
  };
}

function ctx(overrides: Partial<AlertContext> = {}): AlertContext {
  return { instrument: INSTRUMENT, quote: quote(), ...overrides };
}

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return { id: alertRuleId('THYAO.IS', 'priceAbove'), ticker: 'THYAO.IS', type: 'priceAbove', enabled: true, ...overrides };
}

describe('dayKeyAt', () => {
  it('liefert den Kalendertag in der angegebenen Zeitzone', () => {
    expect(dayKeyAt(NOW, TZ)).toBe('2026-09-22');
  });
});

describe('alertRuleId / isAlertRuleType', () => {
  it('baut eine stabile Id aus Ticker und Typ', () => {
    expect(alertRuleId('THYAO.IS', 'dailyLow')).toBe('THYAO.IS:dailyLow');
  });
  it('erkennt gültige und ungültige Regeltypen', () => {
    expect(isAlertRuleType('priceAbove')).toBe(true);
    expect(isAlertRuleType('unknown')).toBe(false);
  });
});

describe('evaluateRule: globale Sperren', () => {
  it('feuert nie, wenn die Regel deaktiviert ist', () => {
    const r = evaluateRule(rule({ enabled: false, threshold: 100 }), undefined, ctx(), TZ, NOW);
    expect(r.fire).toBe(false);
  });

  it('feuert nie, wenn die Börse laut marketState geschlossen ist', () => {
    const closed = ctx({ quote: quote({ session: { start: NOW / 1000 + 3600, end: NOW / 1000 + 7200 } }) }); // Sitzung startet erst später
    const r = evaluateRule(rule({ threshold: 100 }), undefined, closed, TZ, NOW);
    expect(r.fire).toBe(false);
  });

  it('feuert nie öfter als MAX_ALERTS_PER_DAY am selben Tag', () => {
    const r = rule({ threshold: 100 });
    let state: AlertRuleState | undefined = { armed: true, dayKey: dayKeyAt(NOW, TZ), countToday: MAX_ALERTS_PER_DAY };
    const result = evaluateRule(r, state, ctx({ quote: quote({ price: 500 }) }), TZ, NOW);
    expect(result.fire).toBe(false);
  });

  it('setzt den Tageszähler an einem neuen Börsentag zurück', () => {
    const yesterday = dayKeyAt(NOW - 24 * 60 * 60_000, TZ);
    const state: AlertRuleState = { armed: false, dayKey: yesterday, countToday: MAX_ALERTS_PER_DAY };
    const result = evaluateRule(rule({ threshold: 100 }), state, ctx({ quote: quote({ price: 500 }) }), TZ, NOW);
    expect(result.fire).toBe(true);
    expect(result.nextState.countToday).toBe(1);
  });
});

describe('evaluateRule: priceAbove/priceBelow (Hysterese)', () => {
  it('feuert beim Überschreiten der Schwelle, danach erst wieder nach Rückkehr darunter', () => {
    const r = rule({ type: 'priceAbove', threshold: 300 });
    const first = evaluateRule(r, undefined, ctx({ quote: quote({ price: 305 }) }), TZ, NOW);
    expect(first.fire).toBe(true);
    expect(first.nextState.armed).toBe(false);

    // bleibt über der Schwelle: kein erneutes Feuern
    const second = evaluateRule(r, first.nextState, ctx({ quote: quote({ price: 310 }) }), TZ, NOW);
    expect(second.fire).toBe(false);

    // fällt unter die Schwelle: rearmt
    const rearmed = evaluateRule(r, second.nextState, ctx({ quote: quote({ price: 290 }) }), TZ, NOW);
    expect(rearmed.fire).toBe(false);
    expect(rearmed.nextState.armed).toBe(true);

    // steigt erneut: feuert wieder
    const third = evaluateRule(r, rearmed.nextState, ctx({ quote: quote({ price: 305 }) }), TZ, NOW);
    expect(third.fire).toBe(true);
  });

  it('priceBelow feuert unter der Schwelle', () => {
    const r = rule({ type: 'priceBelow', threshold: 250 });
    const result = evaluateRule(r, undefined, ctx({ quote: quote({ price: 240 }) }), TZ, NOW);
    expect(result.fire).toBe(true);
  });

  it('feuert nicht ohne threshold', () => {
    const r = rule({ type: 'priceAbove', threshold: undefined });
    const result = evaluateRule(r, undefined, ctx({ quote: quote({ price: 999 }) }), TZ, NOW);
    expect(result.fire).toBe(false);
  });
});

describe('evaluateRule: dailyMove', () => {
  it('feuert ab dem Schwellenwert (Betrag, egal ob plus oder minus)', () => {
    const r = rule({ type: 'dailyMove', threshold: 5 });
    expect(evaluateRule(r, undefined, ctx({ quote: quote({ changePercent: 6 }) }), TZ, NOW).fire).toBe(true);
    expect(evaluateRule(r, undefined, ctx({ quote: quote({ changePercent: -6 }) }), TZ, NOW).fire).toBe(true);
    expect(evaluateRule(r, undefined, ctx({ quote: quote({ changePercent: 2 }) }), TZ, NOW).fire).toBe(false);
  });
});

describe('evaluateRule: range52w', () => {
  it('feuert am 52-Wochen-Hoch oder -Tief', () => {
    const r = rule({ type: 'range52w' });
    const range = { high: 300, low: 200, percentBelowHigh: 0, percentAboveLow: 50, bars: 252, partial: false };
    expect(evaluateRule(r, undefined, ctx({ range52w: range, quote: quote({ price: 300 }) }), TZ, NOW).fire).toBe(true);
    expect(evaluateRule(r, undefined, ctx({ range52w: range, quote: quote({ price: 200 }) }), TZ, NOW).fire).toBe(true);
    expect(evaluateRule(r, undefined, ctx({ range52w: range, quote: quote({ price: 250 }) }), TZ, NOW).fire).toBe(false);
  });

  it('feuert nicht ohne range52w im Kontext', () => {
    const r = rule({ type: 'range52w' });
    expect(evaluateRule(r, undefined, ctx({ quote: quote({ price: 300 }) }), TZ, NOW).fire).toBe(false);
  });
});

describe('evaluateRule: dailyLow', () => {
  it('feuert beim ersten bekannten Tagestief und danach nur bei einem noch tieferen Tief', () => {
    const r = rule({ type: 'dailyLow' });
    const first = evaluateRule(r, undefined, ctx({ quote: quote({ dayLow: 290 }) }), TZ, NOW);
    expect(first.fire).toBe(true);
    expect(first.nextState.lastDailyLow).toBe(290);
    expect(first.nextState.armed).toBe(false);

    // gleicher oder höherer Tageslow: kein erneutes Feuern (armed ist false)
    const second = evaluateRule(r, first.nextState, ctx({ quote: quote({ dayLow: 292 }) }), TZ, NOW);
    expect(second.fire).toBe(false);
  });

  it('feuert höchstens 1x pro Handelstag, auch bei einem tieferen Tief (kein Rearm untertägig)', () => {
    const r = rule({ type: 'dailyLow' });
    const first = evaluateRule(r, undefined, ctx({ quote: quote({ dayLow: 290 }) }), TZ, NOW);
    const second = evaluateRule(r, first.nextState, ctx({ quote: quote({ dayLow: 285 }) }), TZ, NOW);
    expect(second.fire).toBe(false); // armed ist false, erst am nächsten Handelstag wieder
  });

  it('feuert am nächsten Handelstag erneut bei einem neuen Tief', () => {
    const r = rule({ type: 'dailyLow' });
    const first = evaluateRule(r, undefined, ctx({ quote: quote({ dayLow: 290 }) }), TZ, NOW);
    const nextDay = NOW + 24 * 60 * 60_000;
    const tomorrowQuote = quote({ dayLow: 288, session: { start: nextDay / 1000 - 3600, end: nextDay / 1000 + 3600 }, asOf: nextDay / 1000 });
    const second = evaluateRule(r, first.nextState, ctx({ quote: tomorrowQuote }), TZ, nextDay);
    expect(second.fire).toBe(true);
  });
});

describe('evaluateRule: news', () => {
  const item: NewsItem = { id: 'n1', symbol: 'THYAO', kind: 'kap', title: 'Wichtige KAP-Meldung', url: 'https://kap.org.tr/x', source: 'kap', publishedAt: NOW, language: 'tr' };

  it('feuert bei einer ausreichend relevanten, noch nicht gesehenen Meldung', () => {
    const r = rule({ type: 'news' });
    const result = evaluateRule(r, undefined, ctx({ news: [item] }), TZ, NOW);
    expect(result.fire).toBe(true);
    expect(result.triggeringNews?.id).toBe('n1');
    expect(result.nextState.seenNewsIds).toEqual(['n1']);
  });

  it('feuert nicht erneut für dieselbe Meldung (Dedup über seenNewsIds)', () => {
    const r = rule({ type: 'news' });
    const first = evaluateRule(r, undefined, ctx({ news: [item] }), TZ, NOW);
    const second = evaluateRule(r, first.nextState, ctx({ news: [item] }), TZ, NOW);
    expect(second.fire).toBe(false);
  });

  it('feuert nicht ohne Meldungen', () => {
    const r = rule({ type: 'news' });
    expect(evaluateRule(r, undefined, ctx({ news: [] }), TZ, NOW).fire).toBe(false);
  });
});

describe('describeAlert', () => {
  it('baut für jeden Regeltyp einen nichtleeren deutschen Text', () => {
    const types: AlertRule['type'][] = ['priceAbove', 'priceBelow', 'dailyMove', 'range52w', 'dailyLow', 'news'];
    for (const type of types) {
      const msg = describeAlert(rule({ type, threshold: 100 }), ctx(), { id: 'n1', symbol: 'THYAO', kind: 'kap', title: 'Testmeldung', url: 'x', source: 'kap', publishedAt: NOW, language: 'tr' });
      expect(msg.title.length).toBeGreaterThan(0);
      expect(msg.title).toContain('THYAO');
    }
  });
});
