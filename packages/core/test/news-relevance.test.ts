import { describe, expect, it } from 'vitest';
import {
  buildNewsPayload,
  companyStems,
  groupStories,
  issuedByCompany,
  mentionsCompany,
  NEWS_SYSTEM,
  scoreNewsItem,
  selectNewsItems,
  storyTokens,
  type NewsItem,
} from '../src';

const NOW = Date.UTC(2026, 8, 21, 12);
const THY = { symbol: 'THYAO', name: 'Türk Hava Yolları' };
const mk = (id: string, title: string, over: Partial<NewsItem> = {}): NewsItem => ({
  id,
  symbol: 'THYAO',
  kind: 'news',
  title,
  url: `https://x/${id}`,
  source: 'Presse',
  publishedAt: NOW - 3_600_000,
  language: 'tr',
  ...over,
});
const kap = (id: string, title: string, over: Partial<NewsItem> = {}): NewsItem => mk(id, title, { kind: 'kap', source: 'KAP', issuer: 'TÜRK HAVA YOLLARI A.O.', category: 'Özel Durum Açıklaması (Genel)', ...over });

describe('Firma erkennen', () => {
  it('Vollname, Kurzform (THY), Kürzel; nicht bei bloßen Wortteilen', () => {
    expect(mentionsCompany('Türk Hava Yolları yeni uçak aldı', THY)).toBe(true);
    expect(mentionsCompany('THY’den yeni karar', THY)).toBe(true);
    expect(mentionsCompany('THYAO hisse yorumu', THY)).toBe(true);
    expect(mentionsCompany('Pegasus Hava Yolları büyüyor', THY)).toBe(false);
    expect(mentionsCompany('Hava durumu yarın', THY)).toBe(false);
    expect(mentionsCompany('THYAO', { symbol: 'THYAO.IS' })).toBe(true);
  });

  it('erkennt, ob eine KAP-Meldung von der Firma selbst kommt', () => {
    expect(issuedByCompany(kap('1', 'x'), THY)).toBe(true);
    expect(issuedByCompany(kap('1', 'x', { issuer: 'MERKEZİ KAYIT KURULUŞU A.Ş.' }), THY)).toBe(false);
    expect(issuedByCompany(kap('1', 'x', { issuer: undefined }), THY)).toBeNull();
    expect(issuedByCompany(kap('1', 'x'), {})).toBeNull();
  });

  it('companyStems enthält Kürzel, Namensteile und Kurzform', () => {
    const stems = companyStems(THY);
    for (const s of ['thyao', 'türk', 'hava', 'yolla', 'thy']) expect(stems.has(s)).toBe(true);
  });
});

describe('Vorbewertung', () => {
  const score = (i: NewsItem) => scoreNewsItem(i, THY, NOW);

  it('Gewinnzahlen und Dividende der Firma stehen weit vor Tagesnotizen und Kurslisten', () => {
    const results = score(mk('a', 'Türk Hava Yolları net kâr açıkladı, temettü kararı'));
    const noise = score(mk('b', 'THYAO teknik analiz: günün öne çıkan hisseleri'));
    const list = score(mk('c', 'GARAN AKBNK THYAO ASELS EREGL hisseleri seansı yükselişle kapattı'));
    expect(results).toBeGreaterThan(noise + 30);
    expect(results).toBeGreaterThan(list + 30);
  });

  it('firmenbezogene Meldung schlägt eine, in der die Firma nicht vorkommt', () => {
    expect(score(mk('a', 'THY yeni sipariş verdi'))).toBeGreaterThan(score(mk('b', 'Havalimanında yoğunluk yaşandı')));
  });

  it('KAP: Zahlen und Kapitalmaßnahmen vor Formalien, Firma selbst vor Meldungen der Börse', () => {
    const results = score(kap('a', 'Finansal Rapor', { category: 'Finansal Rapor' }));
    const formal = score(kap('b', 'Sorumluluk Beyanı', { category: 'Sorumluluk Beyanı' }));
    const external = score(kap('c', 'İşleme Açılan Temerrüt Sırası', { category: 'Temerrüt İşlemi', issuer: 'İSTANBUL TAKAS VE SAKLAMA BANKASI A.Ş.' }));
    expect(results).toBeGreaterThan(formal + 25);
    expect(results).toBeGreaterThan(external + 25);
    // Ereigniswörter zählen bei fremdem Absender nicht (hier "temerrüt")
    expect(external).toBeLessThan(40);
  });

  it('bleibt zwischen 0 und 100 und lässt Alter nur leicht wirken', () => {
    const fresh = mk('a', 'THY sipariş', { publishedAt: NOW });
    const old = mk('b', 'THY sipariş', { publishedAt: NOW - 30 * 86_400_000 });
    expect(score(fresh) - score(old)).toBeLessThanOrEqual(10);
    for (const i of [fresh, old, mk('c', 'x teknik analiz seans hisseleri')]) {
      expect(score(i)).toBeGreaterThanOrEqual(0);
      expect(score(i)).toBeLessThanOrEqual(100);
    }
  });
});

describe('Auswahl für die KI', () => {
  it('nimmt bei vielen Presseartikeln die mit der größten vermuteten Wirkung, nicht einfach die neuesten', () => {
    const filler = Array.from({ length: 20 }, (_, i) => mk(`f${i}`, `Havalimanında sıradan bir gün ${i}`, { publishedAt: NOW - i * 60_000 }));
    const important = mk('wichtig', 'Türk Hava Yolları net kâr açıkladı', { publishedAt: NOW - 20 * 86_400_000 / 24 });
    const ids = selectNewsItems([...filler, important], 5, THY, NOW).map((i) => i.id);
    expect(ids).toContain('wichtig');
    expect(ids).toHaveLength(5);
  });

  it('bevorzugt bei KAP die Meldungen der Firma mit Substanz vor Formalien', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => kap(`form${i}`, `Sorumluluk Beyanı ${i}`, { category: 'Sorumluluk Beyanı', publishedAt: NOW - i * 60_000 })),
      kap('zahlen', 'Finansal Rapor', { category: 'Finansal Rapor', publishedAt: NOW - 5 * 86_400_000 }),
    ];
    const ids = selectNewsItems(items, 15, THY, NOW).map((i) => i.id);
    expect(ids).toContain('zahlen');
    expect(ids.filter((id) => id.startsWith('form'))).toHaveLength(7); // KAP-Platz 8 minus die wichtige
  });

  it('ohne Angabe der Aktie zählt weiter nur die Aktualität (wie bisher)', () => {
    const items = [mk('alt', 'THY net kâr', { publishedAt: NOW - 5 * 86_400_000 }), mk('neu', 'irgendwas', { publishedAt: NOW })];
    expect(selectNewsItems(items, 1).map((i) => i.id)).toEqual(['neu']);
  });
});

describe('Dieselbe Geschichte nur einmal', () => {
  const skytrax = [
    mk('s1', 'Türk Hava Yolları 11. Kez Avrupa’nın En İyi Havayolu Seçildi'),
    mk('s2', 'THY, 11. kez Avrupa’nın en iyi havayolu seçildi'),
    mk('s3', 'THY 11. Kez Avrupa\'nın En İyi Havayolu Oldu'),
    mk('s4', 'Türk Hava Yolları, Avrupa\'nın En İyi Havayolu Unvanını 11. Kez Kazandı'),
  ];

  it('fasst Berichte zur selben Geschichte zusammen und zählt die weiteren', () => {
    const out = groupStories([...skytrax, mk('x', 'Türk Hava Yolları Minsk uçuşlarına yeniden başladı')], THY, NOW);
    const award = out.filter((i) => i.id.startsWith('s'));
    expect(award.length).toBeLessThan(skytrax.length);
    expect(award.reduce((sum, i) => sum + 1 + (i.alsoReported ?? 0), 0)).toBe(skytrax.length);
    expect(out.some((i) => i.id === 'x' && i.alsoReported === undefined)).toBe(true);
  });

  it('verschiedene Geschichten bleiben getrennt', () => {
    const items = [mk('a', 'THY Minsk uçuşlarına yeniden başladı'), mk('b', 'THY Genel Müdürü TİKA’yı ziyaret etti'), mk('c', 'THY yeni pist açtı')];
    expect(groupStories(items, THY, NOW)).toHaveLength(3);
  });

  it('KAP-Meldungen werden nie zusammengefasst, die Reihenfolge bleibt erhalten', () => {
    const items = [kap('k1', 'Pay Geri Alım İşlemleri'), kap('k2', 'Pay Geri Alım İşlemleri'), ...skytrax];
    const out = groupStories(items, THY, NOW);
    expect(out.slice(0, 2).map((i) => i.id)).toEqual(['k1', 'k2']);
    const order = out.map((i) => items.findIndex((x) => x.id === i.id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('die Kernmeldung ist stabil, egal in welcher Reihenfolge die Meldungen ankommen', () => {
    const a = groupStories(skytrax, THY, NOW).map((i) => i.id).sort();
    const b = groupStories([...skytrax].reverse(), THY, NOW + 3 * 3_600_000).map((i) => i.id).sort();
    expect(a).toEqual(b);
  });

  it('storyTokens lässt Firmenname und Füllwörter weg', () => {
    const t = storyTokens('Türk Hava Yolları için yeni Skytrax ödülü', companyStems(THY));
    expect(t.has('skytr')).toBe(true);
    expect(t.has('türk')).toBe(false);
    expect(t.has('için')).toBe(false);
  });
});

describe('Nachrichten-Prompt: Wirkung und Firmenbezug', () => {
  it('erklärt die Skala und verlangt Firmenbezug UND Kurswirkung', () => {
    expect(NEWS_SYSTEM).toMatch(/ZWEI Dinge/);
    expect(NEWS_SYSTEM).toMatch(/DIESE Firma/);
    expect(NEWS_SYSTEM).toMatch(/Reine Erwähnung des Firmennamens ist KEINE hohe Relevanz/);
    expect(NEWS_SYSTEM).toMatch(/5 = wesentlich/);
    expect(NEWS_SYSTEM).toMatch(/1 = Rauschen/);
    expect(NEWS_SYSTEM).toMatch(/nur Rauschen/);
  });

  it('gibt die Zahl weiterer Berichte mit, aber nur wenn es welche gibt', () => {
    const { payload } = buildNewsPayload({ symbol: 'THYAO', market: 'BIST' }, [mk('a', 'x', { alsoReported: 7 }), mk('b', 'y')], new Date(NOW));
    expect(payload.items[0]!.weitereBerichte).toBe(7);
    expect(payload.items[1]).not.toHaveProperty('weitereBerichte');
    expect(NEWS_SYSTEM).toMatch(/weitereBerichte/);
  });
});
