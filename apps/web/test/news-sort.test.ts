import type { NewsItem } from '@aktien/core';
import { describe, expect, it } from 'vitest';
import { isHiddenByDefault, sortByImpact } from '../src/components/NewsList';

const mk = (id: string, publishedAt: number, kind: 'kap' | 'news' = 'news'): NewsItem => ({ id, symbol: 'THYAO', kind, title: id, url: 'https://x', source: 's', publishedAt, language: 'tr' });
const rate = (relevance: number) => ({ sentiment: 'neutral' as const, relevance, titleLocal: 't', reason: 'r' });

describe('Meldungen nach Wirkung sortieren', () => {
  it('erst hohe Wichtigkeit (5, 4, 3), dann ungeprüfte, dann unwichtige; gleiche Stufe: neueste zuerst', () => {
    const items = [mk('zwei', 5), mk('neu-drei', 9), mk('fuenf', 1), mk('ungeprueft', 8), mk('alt-drei', 2), mk('vier', 3)];
    const byId = { zwei: rate(2), 'neu-drei': rate(3), fuenf: rate(5), 'alt-drei': rate(3), vier: rate(4) };
    expect(sortByImpact(items, byId).map((i) => i.id)).toEqual(['fuenf', 'vier', 'neu-drei', 'alt-drei', 'ungeprueft', 'zwei']);
  });

  it('ohne KI-Bewertung bleibt es bei neueste zuerst, die Eingabe wird nicht verändert', () => {
    const items = [mk('a', 1), mk('b', 3), mk('c', 2)];
    expect(sortByImpact(items, undefined).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('Zunächst eingeklappte Meldungen', () => {
  it('Presse: Wichtigkeit 1 und 2 eingeklappt, ab 3 sichtbar', () => {
    expect(isHiddenByDefault(rate(1), 'news')).toBe(true);
    expect(isHiddenByDefault(rate(2), 'news')).toBe(true);
    expect(isHiddenByDefault(rate(3), 'news')).toBe(false);
  });

  it('KAP: nur Wichtigkeit 1 eingeklappt', () => {
    expect(isHiddenByDefault(rate(1), 'kap')).toBe(true);
    expect(isHiddenByDefault(rate(2), 'kap')).toBe(false);
  });

  it('ungeprüfte Meldungen bleiben sichtbar', () => {
    expect(isHiddenByDefault(undefined, 'news')).toBe(false);
  });
});
