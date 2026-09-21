import { describe, expect, it } from 'vitest';
import { collectAllowedNumbers, extractNumbers, findUnsupported, guardValue, readings, sanitizeText, scanUnsupported, splitSentences } from '../src/ai/guard';

const allowed = collectAllowedNumbers({
  price: 285.5,
  rsi: 38.59,
  sma200: { value: 303.8488, distancePercent: -6.04 },
  zones: [{ low: 276.25, high: 280.75, touches: 7 }],
  title: 'THY hisseleri yüzde 3,5 yükseldi, hedef fiyat 350 TL',
  bigNumber: 1234567.891,
});

describe('readings (Zahlenformate)', () => {
  it('deutsche und englische Schreibweisen', () => {
    expect(readings('285,50')).toEqual([{ value: 285.5, decimals: 2 }]);
    expect(readings('1.234,56')).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(readings('1,234.56')).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(readings('1.234.567')).toEqual([{ value: 1234567, decimals: 0 }]);
    expect(readings('42')).toEqual([{ value: 42, decimals: 0 }]);
  });

  it('mehrdeutige Tausender/Dezimal-Schreibweise liefert beide Lesarten', () => {
    const r = readings('1.234');
    expect(r).toContainEqual({ value: 1.234, decimals: 3 });
    expect(r).toContainEqual({ value: 1234, decimals: 0 });
    expect(readings('0.500')).toEqual([{ value: 0.5, decimals: 3 }]);
  });
});

describe('extractNumbers', () => {
  it('ignoriert Datum, Uhrzeit, IDs und Buchstabenkombinationen', () => {
    const raw = extractNumbers('Am 21.09.2026 um 10:36 liegt S1 bei SMA50 und R2, Testwert SL3.').map((n) => n.raw);
    expect(raw).toEqual([]);
  });

  it('findet Zahlen mit Einheit und markiert Preise', () => {
    const [a, b] = extractNumbers('Kurs 285,50 ₺ und 3 %');
    expect(a).toMatchObject({ raw: '285,50', isPrice: true });
    expect(b).toMatchObject({ raw: '3', isPrice: false });
  });

  it('trennt Schrägstrich-Folgen (MACD 12/26/9)', () => {
    expect(extractNumbers('MACD (12/26/9)').map((n) => n.raw)).toEqual(['12', '26', '9']);
  });
});

describe('findUnsupported', () => {
  it('erlaubt Zahlen aus der Eingabe, auch gerundet oder abgeschnitten', () => {
    expect(findUnsupported('Der RSI liegt bei 38,6 und damit im neutralen Bereich.', allowed)).toEqual([]);
    expect(findUnsupported('RSI von 38,59.', allowed)).toEqual([]);
    expect(findUnsupported('RSI um 38.', allowed)).toEqual([]); // abgeschnitten
    expect(findUnsupported('RSI um 39.', allowed)).toEqual([]); // gerundet
    expect(findUnsupported('Der Kurs von 285,50 TRY', allowed)).toEqual([]);
    expect(findUnsupported('Kurs rund 286 ₺ (gerundet).', allowed)).toEqual([]);
  });

  it('erlaubt Beträge negativer Werte', () => {
    expect(findUnsupported('Der Kurs liegt 6,04 % unter dem SMA 200.', allowed)).toEqual([]);
    expect(findUnsupported('Der Kurs liegt 6 % unter dem SMA 200.', allowed)).toEqual([]);
  });

  it('erlaubt Zahlen aus Texten der Eingabe (Nachrichtentitel)', () => {
    expect(findUnsupported('Die Meldung nennt ein Kursziel von 350 TL und +3,5 %.', allowed)).toEqual([]);
  });

  it('lehnt erfundene Zahlen ab', () => {
    expect(findUnsupported('Das Kursziel liegt bei 420 ₺.', allowed)).toEqual(['420']);
    expect(findUnsupported('Die Aktie kann um 25 % steigen.', allowed)).toEqual(['25']);
    expect(findUnsupported('Der RSI liegt bei 45,3.', allowed)).toEqual(['45,3']);
  });

  it('kleine Zahlen sind frei, aber nicht direkt vor einer Währung', () => {
    expect(findUnsupported('Es gibt 3 Widerstandszonen und 2 Argumente.', allowed)).toEqual([]);
    expect(findUnsupported('Stop-Loss bei 5 ₺.', allowed)).toEqual(['5']);
    expect(findUnsupported('Stop-Loss bei 8 TRY.', allowed)).toEqual(['8']);
    expect(findUnsupported('Der Kurs sank um 9 $.', allowed)).toEqual(['9']);
    expect(findUnsupported('Es gab 7 Berührungen.', allowed)).toEqual([]); // 7 steht in der Eingabe (touches)
  });

  it('Indikator-Perioden, RSI-Schwellen und Jahreszahlen sind frei', () => {
    expect(findUnsupported('SMA 20, 50 und 200, RSI (14), MACD (12/26/9), Schwelle 70 und 30, seit 2024.', allowed)).toEqual([]);
  });

  it('englische und deutsche Tausenderschreibweise', () => {
    expect(findUnsupported('Umsatz 1.234.568', allowed)).toEqual([]);
    expect(findUnsupported('Umsatz 1,234,568', allowed)).toEqual([]);
    expect(findUnsupported('Umsatz 9.999.999', allowed)).toEqual(['9.999.999']);
  });

  it('Genauigkeit: 2-Dezimalzahl muss exakt (gerundet) passen', () => {
    expect(findUnsupported('Widerstand 280,75', allowed)).toEqual([]);
    expect(findUnsupported('Widerstand 280,80', allowed)).toEqual(['280,80']);
  });
});

describe('sanitizeText', () => {
  it('entfernt nur Sätze mit nicht belegten Zahlen', () => {
    const r = sanitizeText('Der RSI liegt bei 38,6. Das Kursziel beträgt 420 ₺. Der Trend ist abwärts gerichtet.', allowed);
    expect(r.text).toBe('Der RSI liegt bei 38,6. Der Trend ist abwärts gerichtet.');
    expect(r.removedSentences).toBe(1);
    expect(r.unsupported).toEqual(['420']);
  });

  it('zerlegt Abkürzungen nicht in Sätze', () => {
    expect(splitSentences('Der Kurs liegt z. B. nahe SMA 50. Ca. 15 Min. verzögert. Nächster Satz.')).toEqual([
      'Der Kurs liegt z. B. nahe SMA 50.',
      'Ca. 15 Min. verzögert.',
      'Nächster Satz.',
    ]);
  });

  it('lässt saubere Texte unverändert', () => {
    const text = 'Der Kurs liegt unter dem SMA 200. Das spricht für Schwäche.';
    expect(sanitizeText(text, allowed)).toEqual({ text, removedSentences: 0, unsupported: [] });
  });
});

describe('guardValue', () => {
  it('bereinigt verschachtelte Objekte und Listen, lässt IDs und Enums unberührt', () => {
    const input = {
      verdict: 'bearish',
      candidateId: 'SL2',
      summary: 'Schwache Lage. Ziel 999 ₺ wird erreicht.',
      argumentsFor: ['RSI bei 38,6 nahe überverkauft.', 'Kursziel 777 TL laut Analyse.'],
      entry: { candidateId: 'E1', comment: 'Rücksetzer bis 280,75 möglich.' },
    };
    const { value, report } = guardValue(input, allowed);
    expect(value.verdict).toBe('bearish');
    expect(value.candidateId).toBe('SL2');
    expect(value.summary).toBe('Schwache Lage.');
    expect(value.argumentsFor).toEqual(['RSI bei 38,6 nahe überverkauft.']);
    expect(value.entry).toEqual({ candidateId: 'E1', comment: 'Rücksetzer bis 280,75 möglich.' });
    expect(report.removed).toBe(2);
    expect(report.unsupported.sort()).toEqual(['777', '999']);
    expect(input.argumentsFor).toHaveLength(2); // Eingabe bleibt unverändert
  });

  it('scanUnsupported meldet ohne zu verändern', () => {
    expect(scanUnsupported({ a: 'Wert 555', b: ['Wert 38,6', 'Wert 666'], sentiment: 'positiv 777' }, allowed)).toEqual(['555', '666']);
  });
});

describe('collectAllowedNumbers', () => {
  it('sammelt Zahlen aus Werten, Beträgen und Texten', () => {
    const a = collectAllowedNumbers({ x: -6.04, y: [1.5], t: 'Gewinn 12,5 Mio.' });
    expect(a).toEqual(expect.arrayContaining([-6.04, 6.04, 1.5, 12.5]));
  });
});
