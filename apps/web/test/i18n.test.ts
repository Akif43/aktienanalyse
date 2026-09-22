import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeTechnicalSnapshot, type Candle } from '@aktien/core';
import { describe, expect, it } from 'vitest';
import { glanceFacts } from '../src/components/Glance';
import { de } from '../src/lib/dict-de';
import { tr } from '../src/lib/dict-tr';
import { formatPercent, formatPrice, formatRelative } from '../src/lib/format';
import { detectLang, translate } from '../src/lib/i18n';

const ref = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/core/test/fixtures/thyao-1d.reference.json', import.meta.url)), 'utf-8'),
) as { candles: Candle[] };

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Wörterbücher', () => {
  it('Deutsch und Türkisch haben dieselben Schlüssel', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(de).sort());
  });

  it('jeder Text ist gefüllt und hat in beiden Sprachen dieselben Platzhalter', () => {
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(tr[key].trim(), key).not.toBe('');
      expect(placeholders(tr[key]), key).toEqual(placeholders(de[key]));
    }
  });

  it('türkische Texte sind wirklich übersetzt (nicht einfach die deutsche Vorlage)', () => {
    // Nur Markenname, "Demo", Währungsbezeichnungen (₺ Lira, € Euro) und Börsenindex-Namen (BIST 100/30) sind in beiden Sprachen gleich
    const same = (Object.keys(de) as (keyof typeof de)[]).filter((k) => tr[k] === de[k] && /[a-zäöüß]{4,}/i.test(de[k]));
    expect(same).toEqual(['app.name', 'ai.demo', 'cur.TRY', 'cur.EUR', 'fund.kind.bist100', 'fund.kind.bist30', 'fund.kind.eur']);
  });

  it('die Einfach-Ansicht nennt keine Fachbegriffe in Klartexten', () => {
    const plainKeys = (Object.keys(de) as (keyof typeof de)[]).filter((k) => /^(glance|verdict|fx|news\.(summary|positive|negative)|watch)\./.test(k));
    for (const key of plainKeys) {
      expect(de[key], key).not.toMatch(/\b(RSI|MACD|SMA|EMA|ATR|Bollinger|Golden Cross|Death Cross|Momentum|Volatilität)\b/);
      expect(tr[key], key).not.toMatch(/\b(RSI|MACD|SMA|EMA|ATR|Bollinger|Golden Cross|Death Cross)\b/);
    }
  });
});

describe('translate', () => {
  it('setzt Platzhalter ein und lässt unbekannte sichtbar', () => {
    expect(translate('fresh.delayed', { minutes: 15 }, 'de')).toBe('ca. 15 Min. verzögert');
    expect(translate('fresh.delayed', { minutes: 15 }, 'tr')).toBe('yaklaşık 15 dk gecikmeli');
    expect(translate('fresh.delayed', {}, 'de')).toContain('{minutes}');
  });
});

describe('Sprache erkennen', () => {
  it('nimmt Türkisch, wenn das Handy auf Türkisch steht, sonst Deutsch', () => {
    expect(detectLang(['tr-TR', 'en-US'])).toBe('tr');
    expect(detectLang(['de-DE'])).toBe('de');
    expect(detectLang(['en-US', 'tr'])).toBe('tr');
    expect(detectLang(['fr-FR'])).toBe('de');
    expect(detectLang([])).toBe('de');
  });
});

describe('Formatierung je Sprache', () => {
  it('Prozent: deutsch "1,50 %", türkisch "%1,50"', () => {
    expect(formatPercent(1.5, true, 'de')).toBe('+1,50 %');
    expect(formatPercent(1.5, true, 'tr')).toBe('+%1,50');
    expect(formatPercent(-2, true, 'tr')).toBe('−%2,00');
    expect(formatPercent(3, false, 'tr')).toBe('%3,00');
  });

  it('Preise mit Währungssymbol', () => {
    expect(formatPrice(1234.5, 'TRY', 'tr')).toBe('1.234,50 ₺');
    expect(formatPrice(1234.5, 'USD', 'de')).toBe('1.234,50 $');
  });

  it('relative Zeit in beiden Sprachen', () => {
    const now = Date.UTC(2026, 8, 21, 12);
    expect(formatRelative(now - 5 * 60_000, now, 'de')).toBe('vor 5 Min.');
    expect(formatRelative(now - 5 * 60_000, now, 'tr')).toBe('5 dk önce');
    expect(formatRelative(now - 2 * 86_400_000, now, 'tr')).toBe('2 gün önce');
    expect(formatRelative(now, now, 'tr')).toBe('az önce');
  });
});

describe('Auf einen Blick', () => {
  const snapshot = computeTechnicalSnapshot(ref.candles);
  const facts = glanceFacts(snapshot, { percent: (v) => `${v.toFixed(1)}%`, price: (v) => v.toFixed(2) });

  it('liefert einfache Aussagen aus den berechneten Kennzahlen, alle mit vorhandenem Text', () => {
    expect(facts.length).toBeGreaterThanOrEqual(3);
    for (const f of facts) {
      expect(de[f.key], f.key).toBeTruthy();
      expect(tr[f.key], f.key).toBeTruthy();
    }
  });

  it('bewertet die Richtung passend zum Trend', () => {
    const up = glanceFacts({ ...snapshot, trend: { ...snapshot.trend, state: 'aufwärts' } }, { percent: String, price: String });
    const down = glanceFacts({ ...snapshot, trend: { ...snapshot.trend, state: 'abwärts' } }, { percent: String, price: String });
    expect(up[0]).toMatchObject({ tone: 'up', key: 'glance.trendUp' });
    expect(down[0]).toMatchObject({ tone: 'down', key: 'glance.trendDown' });
  });

  it('warnt bei stark gestiegenem Kurs, ohne "Kaufen"-Sprache', () => {
    const hot = glanceFacts({ ...snapshot, rsi14: { value: 82, zone: 'überkauft' } }, { percent: String, price: String });
    expect(hot.some((f) => f.key === 'glance.hot')).toBe(true);
    expect(de['glance.hot']).not.toMatch(/kauf|verkauf/i);
  });
});
