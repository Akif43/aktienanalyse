import { describe, expect, it } from 'vitest';
import { collectAllowedNumbers, findUnsupported } from '../src/ai/guard';
import { buildTechnicalRequest, computeTechnicalSnapshot, buildCandidates, buildTechnicalPayload, DemoProvider, formatMsg, isLang, languageRule, LANGS, messageCatalog, msg, technicalOutputSchema } from '../src';
import { readJsonFixture } from './helpers';
import type { Candle } from '../src';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Systemmeldungen (Msg)', () => {
  it('jede Meldung ist in allen Sprachen vorhanden und hat dieselben Platzhalter', () => {
    const catalog = messageCatalog();
    expect(Object.keys(catalog).length).toBeGreaterThan(10);
    for (const [code, texts] of Object.entries(catalog)) {
      for (const lang of LANGS) expect(texts[lang], `${code}/${lang}`).toBeTruthy();
      expect(placeholders(texts.tr), code).toEqual(placeholders(texts.de));
    }
  });

  it('setzt Werte in die gewählte Sprache ein', () => {
    expect(formatMsg(msg('refreshTooSoon', { minutes: 5 }), 'de')).toBe('Neue Auswertung frühestens in 5 Min. möglich.');
    expect(formatMsg(msg('refreshTooSoon', { minutes: 5 }), 'tr')).toContain('5 dk');
    expect(formatMsg(msg('approximateData'), 'tr')).not.toBe(formatMsg(msg('approximateData'), 'de'));
  });

  it('lässt fehlende Werte sichtbar, statt zu raten', () => {
    expect(formatMsg(msg('refreshTooSoon'), 'de')).toContain('{minutes}');
  });

  it('erkennt gültige Sprachcodes', () => {
    expect(isLang('de')).toBe(true);
    expect(isLang('tr')).toBe(true);
    expect(isLang('en')).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});

describe('Sprache der KI-Texte', () => {
  const ref = readJsonFixture<{ candles: Candle[] }>('thyao-1d.reference.json');
  const snapshot = computeTechnicalSnapshot(ref.candles);
  const candidates = buildCandidates(snapshot);
  const input = { instrument: { symbol: 'THYAO', market: 'BIST' as const, currency: 'TRY' }, quote: null, snapshot, candidates };

  it('schreibt die Ausgabesprache in Prompt und Payload', () => {
    const tr = buildTechnicalPayload({ ...input, lang: 'tr' });
    expect(tr.ausgabeSprache).toBe('tr');
    expect(buildTechnicalRequest(tr, 'tr').system).toContain('Türkisch');
    expect(buildTechnicalRequest(tr, 'de').system).toContain(languageRule('de'));
    expect(buildTechnicalPayload(input).ausgabeSprache).toBe('de');
  });

  it('verlangt ein Laien-Kurzfazit mit Vor- und Nachteilen', () => {
    const ok = {
      verdict: 'neutral',
      confidence: 'mittel',
      plain: { headline: 'Kurs bewegt sich seitwärts.', explanation: 'Keine klare Richtung.', pros: ['a'], cons: ['b'] },
      summary: 's',
      argumentsFor: ['a'],
      argumentsAgainst: ['b'],
      risks: ['r'],
      entry: { candidateId: null, comment: 'c' },
      stopLoss: { candidateId: null, comment: 'c' },
      targets: [],
      horizon: 'mittelfristig',
      horizonComment: 'h',
    };
    expect(technicalOutputSchema.safeParse(ok).success).toBe(true);
    expect(technicalOutputSchema.safeParse({ ...ok, plain: { ...ok.plain, cons: [] } }).success).toBe(false);
    expect(technicalOutputSchema.safeParse({ ...ok, plain: undefined }).success).toBe(false);
  });

  it('der Demo-Anbieter antwortet in der verlangten Sprache', async () => {
    const demo = new DemoProvider();
    const ask = async (lang: 'de' | 'tr') => {
      const payload = buildTechnicalPayload({ ...input, lang });
      const req = buildTechnicalRequest(payload, lang);
      return (await demo.generateJSON(req)).data as { plain: { headline: string } };
    };
    const de = await ask('de');
    const tr = await ask('tr');
    expect(de.plain.headline).toMatch(/Demo/);
    expect(tr.plain.headline).toMatch(/demo/i);
    expect(tr.plain.headline).not.toBe(de.plain.headline);
  });
});

describe('Zahlenwächter mit türkischen Texten', () => {
  const allowed = collectAllowedNumbers({ price: 285.5, rsi: 38.59, high52: 310.25 });

  it('erkennt erfundene Zahlen auch in türkischen Sätzen', () => {
    expect(findUnsupported('Hedef fiyat 420 TL seviyesinde.', allowed)).toEqual(['420']);
    expect(findUnsupported('Fiyat 285,50 TL civarında, RSI 38,6.', allowed)).toEqual([]);
  });

  it('lässt türkische Prozent-Schreibweise mit belegten Zahlen zu', () => {
    expect(findUnsupported('Fiyat 52 haftalık zirvenin yaklaşık yüzde 8 altında.', allowed)).toEqual([]);
    expect(findUnsupported('Fiyat %38,6 seviyesinde.', allowed)).toEqual([]);
  });
});
