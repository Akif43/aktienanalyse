import { describe, expect, it } from 'vitest';
import {
  classifyGraham,
  computeGraham,
  DEFAULT_GRAHAM_SETTINGS,
  grahamGrowthValue,
  grahamImpliedGrowth,
  type GrahamInput,
  type GrahamValuation,
  type GrahamYearInput,
} from '../src';

const B = 1e9;
const CURRENT_YEAR = 2026;
/** Testkurs 45 TL/USD, passt zu den ca.-Erwartungen des Auftrags (45–48). */
const FX = 45;

/** Gewinne einer Reihe ab startYear (in Milliarden), ohne EBIT. */
function years(values: number[], startYear: number, extra: Partial<GrahamYearInput> = {}): GrahamYearInput[] {
  return values.map((v, i) => ({ year: startYear + i, netIncome: v * B, ebit: null, avgFx: null, ...extra }));
}

function ok(result: ReturnType<typeof computeGraham>): GrahamValuation {
  if (result.status !== 'ok') throw new Error(`Erwartete Bewertung, bekam ${result.reason}`);
  return result;
}

function input(overrides: Partial<GrahamInput>): GrahamInput {
  return { market: 'US', price: 100, shares: 1 * B, netDebt: 0, reportingCurrency: 'USD', years: years([1, 1, 1, 1, 1], 2021), currentFx: null, dividendYears: [], currentYear: CURRENT_YEAR, ...overrides };
}

describe('Testfall THY (THYAO): stabil, hoch verschuldet, grenzwertig', () => {
  const thyYears = years([0.96, 2.73, 6.0, 2.4, 2.9], 2021);
  thyYears[2] = { ...thyYears[2]!, ebit: 2.86 * B }; // 2023: Jahresüberschuss 6,0 ≫ 1,5 × operatives Ergebnis 2,86 → bereinigen
  const thy = input({
    market: 'BIST',
    price: 300,
    shares: 1.38 * B,
    netDebt: 1.2 * 300 * 1.38 * B, // Nettoverschuldung höher als Marktkapitalisierung
    reportingCurrency: 'USD', // THY berichtet in USD
    years: thyYears,
    currentFx: FX,
    dividendYears: [{ year: 2025, amount: 3.4 }],
    dividendCoverageFromYear: 2016,
  });
  const r = ok(computeGraham(thy));

  it('bereinigt 2023 auf das operative Ergebnis und markiert das Jahr', () => {
    const y2023 = r.years.find((y) => y.year === 2023)!;
    expect(y2023.adjustedForOneOff).toBe(true);
    expect(y2023.adjusted).toBeCloseTo(2.86 * B);
    expect(r.years.filter((y) => y.adjustedForOneOff)).toHaveLength(1);
    expect(r.notes).toContainEqual({ code: 'adjustedYears', years: '2023' });
  });

  it('ordnet THY als stabil ein', () => {
    expect(r.type).toBe('stable');
    expect(r.coefficientOfVariation).toBeCloseTo(0.31, 1);
  });

  it('normalisiertes EPS ≈ 78 TL (Erwartung ca. 78)', () => {
    expect(r.eps).toBeCloseTo(77.28, 1);
    expect(Math.abs(r.eps / 78 - 1)).toBeLessThan(0.15);
  });

  it('geforderte Rendite 15,5 % (4 + 5 + 3,5 + 3 wegen Verschuldung > 100 %), KGV 6,45', () => {
    expect(r.companyRisk).toBe(3);
    expect(r.requiredReturn).toBeCloseTo(15.5);
    expect(r.scenarios.base.pe).toBeCloseTo(6.4516, 3);
    expect(r.scenarios.conservative.pe).toBeCloseTo(4.9516, 3);
    expect(r.scenarios.optimistic.pe).toBeCloseTo(7.4516, 3);
  });

  it('Sicherheitsmarge 40 %: Kaufgrenze ≈ 299 bei Kurs 300 → knapp "Fair bewertet"', () => {
    expect(r.safetyMargin).toBe(40);
    expect(r.scenarios.base.intrinsicValue).toBeCloseTo(498.6, 0);
    expect(r.scenarios.base.buyLimit).toBeCloseTo(299.2, 0);
    expect(r.verdict).toBe('fair');
    // deckt sich mit der Erwartung "Günstig bis Fair, grenzwertig"
    expect(['undervalued', 'fair']).toContain(r.verdict);
  });

  it('Checkliste: Dividende unterbrochen, Nettoschuld nicht unter Marktkapitalisierung', () => {
    expect(r.checklist.dividends.ok).toBe(false);
    expect(r.checklist.netDebtBelowMarketCap.ok).toBe(false);
    expect(r.checklist.noLossYear.ok).toBe(true);
    expect(r.checklist.peTtm.usedTtm).toBe(false);
    expect(r.notes).toContainEqual({ code: 'ttmFallback' });
  });

  it('kein Wachstumsfirmen-Zusatz bei stabilem Typ', () => {
    expect(r.growthScenarios).toBeNull();
    expect(r.impliedGrowth).toBeNull();
  });
});

describe('Testfall Tüpraş (TUPRS): zyklisch, solide Bilanz → teuer', () => {
  const r = ok(
    computeGraham(
      input({
        market: 'BIST',
        price: 376,
        shares: 1.927 * B,
        netDebt: 0,
        reportingCurrency: 'USD', // Gewinne des Auftrags sind bereits in USD
        years: years([2.5, 2.2, 0.55, 0.8, 2.2], 2022), // 2026 annualisiert
        currentFx: FX,
      }),
    ),
  );

  it('erkennt den Gewinnrückgang von −75 % als zyklisch (hat Vorrang vor dem Erholungswachstum)', () => {
    expect(r.hasBigDecline).toBe(true);
    expect(r.type).toBe('cyclical');
    expect(r.avgGrowth).toBeGreaterThan(0.15); // wäre ohne Vorrang als "Wachstum" durchgegangen
  });

  it('normalisiertes EPS = Durchschnitt aller 5 Jahre ≈ 38,5 TL (Erwartung ca. 35, ±15 % wären 29,8 bis 40,3)', () => {
    expect(r.normalizedEarnings).toBeCloseTo(1.65 * B);
    expect(r.eps).toBeCloseTo(38.53, 1);
    expect(Math.abs(r.eps / 35 - 1)).toBeLessThan(0.15);
  });

  it('Rendite 13,5 % (4 + 5 + 3,5 + 1 zyklisch), Marge 30 %', () => {
    expect(r.companyRisk).toBe(1);
    expect(r.requiredReturn).toBeCloseTo(13.5);
    expect(r.safetyMargin).toBe(30);
  });

  it('Einstufung "Teuer": Kurs 376 liegt über dem optimistischen inneren Wert ≈ 324', () => {
    expect(r.scenarios.optimistic.intrinsicValue).toBeCloseTo(323.9, 0);
    expect(r.verdict).toBe('expensive');
  });
});

describe('Testfall Aselsan (ASELS): Wachstum, eingepreistes Wachstum über 25 %', () => {
  // ANNAHME (nicht aus dem Auftrag): Jahresüberschuss 2022 ≈ 5,0 Mrd. TL, ergänzt für die 3 Wachstumsraten.
  // Aus dem Auftrag: TL-EPS 2023: 2,31 | 2024: 4,39 | 2025: 6,57 bei 4,56 Mrd. Aktien.
  const shares = 4.56 * B;
  const tl = (eps: number) => (eps * shares) / B;
  const aselsanYears: GrahamYearInput[] = [
    { year: 2022, netIncome: 5.0 * B, ebit: null, avgFx: 16.7 },
    { year: 2023, netIncome: tl(2.31) * B, ebit: null, avgFx: 24.22 },
    { year: 2024, netIncome: tl(4.39) * B, ebit: null, avgFx: 33.07 },
    { year: 2025, netIncome: tl(6.57) * B, ebit: null, avgFx: 39.89 },
  ];
  const r = ok(computeGraham(input({ market: 'BIST', price: 390, shares, netDebt: 0, reportingCurrency: 'TRY', years: aselsanYears, currentFx: FX })));

  it('rechnet TL-Gewinne zum Jahresschnittskurs in USD um und erkennt ein Wachstumsunternehmen', () => {
    expect(r.years[3]!.base).toBeCloseTo((tl(6.57) * B) / 39.89);
    expect(r.avgGrowth).toBeGreaterThan(0.15);
    expect(r.hasLossYear).toBe(false);
    expect(r.type).toBe('growth');
    expect(r.notes).toContainEqual({ code: 'ias29' });
    expect(r.notes).toContainEqual({ code: 'fewYears', years: 4 });
  });

  it('EPS = Gewinn des letzten Jahres (USD) × aktueller Kurs ÷ Aktien ≈ 7,4 TL (berichtet: 6,57)', () => {
    expect(r.eps).toBeCloseTo(7.41, 1);
    expect(Math.abs(r.eps / 6.57 - 1)).toBeLessThan(0.15);
  });

  it('Einstufung "Teuer" (Schritt 5: fairer Wert ≈ 59 TL gegen Kurs 390)', () => {
    expect(r.requiredReturn).toBeCloseTo(12.5);
    expect(r.scenarios.base.intrinsicValue).toBeCloseTo(59.3, 0);
    expect(r.verdict).toBe('expensive');
  });

  it('eingepreistes Wachstum über 25 % pro Jahr (empfindlich: TL-Werte sind inflationsbereinigt)', () => {
    expect(r.impliedGrowth).toBeGreaterThan(24);
    expect(r.impliedGrowth).toBeCloseTo(25.65, 1);
    const g25 = r.growthScenarios!.find((s) => s.growth === 25)!;
    expect(g25.value).toBeLessThan(390); // selbst 25 % Wachstum rechtfertigen den Kurs knapp nicht
    expect(r.growthScenarios!.map((s) => s.growth)).toEqual([10, 15, 20, 25]);
  });
});

describe('Schritt 2: Einmaleffekte bereinigen', () => {
  const run = (netIncome: number, ebit: number | null) => {
    const ys = years([1, 1, 1, 1, 1], 2021);
    ys[4] = { ...ys[4]!, netIncome: netIncome * B, ebit: ebit === null ? null : ebit * B };
    return ok(computeGraham(input({ years: ys }))).years[4]!;
  };

  it('genau das 1,5-fache gilt noch nicht als verzerrt (nur "mehr als")', () => {
    expect(run(3, 2).adjustedForOneOff).toBe(false);
  });
  it('knapp darüber wird auf das operative Ergebnis bereinigt', () => {
    const y = run(3.01, 2);
    expect(y.adjustedForOneOff).toBe(true);
    expect(y.adjusted).toBeCloseTo(2 * B);
  });
  it('ohne operatives Ergebnis oder bei EBIT ≤ 0 wird nie bereinigt', () => {
    expect(run(5, null).adjustedForOneOff).toBe(false);
    expect(run(5, 0).adjustedForOneOff).toBe(false);
    expect(run(5, -1).adjustedForOneOff).toBe(false);
  });
});

describe('Schritt 3: Unternehmenstyp', () => {
  const typeOf = (values: number[]) => ok(computeGraham(input({ years: years(values, 2021) }))).type;

  it('stabil: gleichmäßige Gewinne', () => expect(typeOf([1, 1.05, 1, 1.02, 1.04])).toBe('stable'));
  it('Wachstum: Ø-Wachstum der letzten 3 Jahre > 15 %, kein Verlustjahr', () => expect(typeOf([1, 1.1, 1.3, 1.6, 2.0])).toBe('growth'));
  it('Wachstum ab genau 15 % noch nicht (nur "mehr als")', () => expect(typeOf([1, 1, 1.15, 1.3225, 1.520875])).toBe('stable'));
  it('zyklisch: Gewinnrückgang über 50 %', () => expect(typeOf([2, 2, 2, 0.9, 2])).toBe('cyclical'));
  it('Rückgang von genau 50 % reicht nicht', () => expect(typeOf([2, 2, 2, 1, 1])).toBe('stable'));
  it('zyklisch: Variationskoeffizient > 0,5 auch ohne Rückgang', () => {
    const r = ok(computeGraham(input({ years: years([0.1, 0.5, 1.0, 1.5, 2.5], 2021) })));
    expect(r.hasBigDecline).toBe(false);
    expect(r.coefficientOfVariation).toBeGreaterThan(0.5);
    expect(r.type).toBe('cyclical');
  });
  it('Verlustjahr verhindert "Wachstum"', () => expect(typeOf([-0.2, 0.5, 1, 1.5, 2.2])).not.toBe('growth'));
  it('nur 3 Jahre: rechnet mit 2 Wachstumsraten und weist darauf hin', () => {
    const r = ok(computeGraham(input({ years: years([1, 1.5, 2.2], 2023) })));
    expect(r.growthRates).toHaveLength(2);
    expect(r.notes).toContainEqual({ code: 'fewGrowthRates', rates: 2 });
    expect(r.notes).toContainEqual({ code: 'fewYears', years: 3 });
  });
});

describe('Schritt 4: normalisiertes EPS', () => {
  it('stabil/zyklisch: Durchschnitt der letzten 5 Jahre, auch wenn mehr Jahre geliefert werden', () => {
    const r = ok(computeGraham(input({ years: years([100, 100, 1, 2, 3, 2, 2], 2019), shares: 1 * B })));
    expect(r.yearsUsed).toBe(5);
    expect(r.normalizedEarnings).toBeCloseTo(2 * B);
  });
  it('Wachstum: Gewinn des letzten Jahres', () => {
    const r = ok(computeGraham(input({ years: years([1, 1.2, 1.5, 1.9, 2.4], 2021) })));
    expect(r.type).toBe('growth');
    expect(r.normalizedEarnings).toBeCloseTo(2.4 * B);
    expect(r.eps).toBeCloseTo(2.4);
  });
  it('US/XETRA: keine Umrechnung und kein Länderrisiko', () => {
    const r = ok(computeGraham(input({ market: 'XETRA', years: years([2, 2, 2, 2, 2], 2021), shares: 1 * B })));
    expect(r.eps).toBeCloseTo(2);
    expect(r.requiredReturn).toBeCloseTo(9);
  });
  it('BIST, TL-Berichter: Jahresschnittskurs je Jahr (nicht der aktuelle Kurs) für die Umrechnung in USD', () => {
    const ys: GrahamYearInput[] = [20, 40, 80].map((tlBn, i) => ({ year: 2023 + i, netIncome: tlBn * B, ebit: null, avgFx: [20, 40, 80][i]! }));
    const r = ok(computeGraham(input({ market: 'BIST', reportingCurrency: 'TRY', years: ys, currentFx: 100, shares: 1 * B })));
    expect(r.years.map((y) => y.base)).toEqual([1 * B, 1 * B, 1 * B]); // TL-Inflation herausgerechnet
    expect(r.eps).toBeCloseTo(100); // 1 Mrd. USD × 100 TL/USD ÷ 1 Mrd. Aktien
  });
});

describe('Schritt 5 und 7: Risikoaufschläge und Sicherheitsmarge', () => {
  // Marktkapitalisierung 1000 (Kurs 10 × 100 Aktien)
  const withDebt = (netDebt: number) => ok(computeGraham(input({ price: 10, shares: 100, netDebt, years: years([1e-7, 1e-7, 1e-7, 1e-7, 1e-7], 2021) })));

  it('Nettoverschuldung bis genau 50 % der Marktkapitalisierung: kein Aufschlag, Marge 30 %', () => {
    const r = withDebt(500);
    expect(r.companyRisk).toBe(0);
    expect(r.safetyMargin).toBe(30);
  });
  it('über 50 %: +2 %, Marge 40 %', () => {
    const r = withDebt(501);
    expect(r.companyRisk).toBe(2);
    expect(r.safetyMargin).toBe(40);
  });
  it('genau 100 %: weiter +2 %; darüber +3 %', () => {
    expect(withDebt(1000).companyRisk).toBe(2);
    expect(withDebt(1001).companyRisk).toBe(3);
  });
  it('Nettoguthaben (negative Nettoverschuldung) erzeugt keinen Aufschlag', () => {
    expect(withDebt(-300).companyRisk).toBe(0);
  });
  it('zyklisch zählt +1 zusätzlich zur Verschuldung', () => {
    const r = ok(computeGraham(input({ price: 10, shares: 100, netDebt: 600, years: years([4e-7, 4e-7, 1e-7, 4e-7, 4e-7], 2021) })));
    expect(r.type).toBe('cyclical');
    expect(r.companyRisk).toBe(3);
  });
  it('Einstellungen wirken: niedrigerer risikofreier Zins erhöht das faire KGV, andere Marge ändert die Kaufgrenze', () => {
    const base = ok(computeGraham(input({})));
    const custom = ok(computeGraham(input({}), { ...DEFAULT_GRAHAM_SETTINGS, riskFreeRate: 2, safetyMargin: 50 }));
    expect(custom.scenarios.base.pe).toBeGreaterThan(base.scenarios.base.pe);
    expect(custom.scenarios.base.buyLimit / custom.scenarios.base.intrinsicValue).toBeCloseTo(0.5);
  });
  it('konservatives KGV wird nie negativ', () => {
    const r = ok(computeGraham(input({}), { ...DEFAULT_GRAHAM_SETTINGS, riskFreeRate: 90 }));
    expect(r.scenarios.conservative.pe).toBe(0);
    expect(r.scenarios.conservative.intrinsicValue).toBe(0);
  });
});

describe('Einstufung (Grenzen)', () => {
  const sc = {
    conservative: { intrinsicValue: 80, buyLimit: 50 },
    base: { intrinsicValue: 100, buyLimit: 70 },
    optimistic: { intrinsicValue: 120, buyLimit: 85 },
  };
  it.each([
    [40, 'stronglyUndervalued'],
    [50, 'stronglyUndervalued'],
    [50.01, 'undervalued'],
    [70, 'undervalued'],
    [70.01, 'fair'],
    [100, 'fair'],
    [100.01, 'slightlyExpensive'],
    [120, 'slightlyExpensive'],
    [120.01, 'expensive'],
  ])('Kurs %s → %s', (price, expected) => {
    expect(classifyGraham(price, sc)).toBe(expected);
  });
});

describe('Graham-Wachstumsformel (Schritt 6)', () => {
  it('Wert = EPS × (8,5 + 2g) × (4,4 / Y)', () => {
    expect(grahamGrowthValue(10, 10, 5)).toBeCloseTo(10 * 28.5 * 0.88);
    expect(grahamGrowthValue(10, 0, 4.4)).toBeCloseTo(85);
  });
  it('eingepreistes Wachstum ist die Umkehrung: Wert(g) ergibt wieder den Kurs', () => {
    for (const price of [50, 200, 390, 1000]) {
      const g = grahamImpliedGrowth(price, 7.4, 5);
      expect(grahamGrowthValue(7.4, g, 5)).toBeCloseTo(price, 6);
    }
  });
  it('wird nicht auf 25 % gedeckelt (die Anzeige sagt dann "über 25 %")', () => {
    expect(grahamImpliedGrowth(1000, 5, 5)).toBeGreaterThan(25);
  });
  it('Y aus den Einstellungen geht ein', () => {
    const r4 = ok(computeGraham(input({ years: years([1, 1.2, 1.5, 1.9, 2.4], 2021) }), { ...DEFAULT_GRAHAM_SETTINGS, bondYield: 4.4 }));
    expect(r4.growthScenarios![0]!.value).toBeCloseTo(2.4 * (8.5 + 20));
  });
});

describe('nicht bewertbar', () => {
  it('negativer normalisierter Gewinn → "mit dieser Methode nicht bewertbar"', () => {
    const r = computeGraham(input({ years: years([-1, -2, -1, 0.1, -3], 2021) }));
    expect(r.status).toBe('notValuable');
    if (r.status === 'notValuable') {
      expect(r.reason).toBe('negativeEps');
      expect(r.eps).toBeLessThan(0);
    }
  });
  it('Gewinn von genau 0 ebenfalls nicht bewertbar', () => {
    const r = computeGraham(input({ years: years([0, 0, 0, 0, 0], 2021) }));
    expect(r).toMatchObject({ status: 'notValuable', reason: 'negativeEps' });
  });
  it('zu wenig Jahre (Mindestens 3)', () => {
    expect(computeGraham(input({ years: years([1, 1], 2024) }))).toMatchObject({ status: 'notValuable', reason: 'tooFewYears', have: 2, need: 3 });
  });
  it('ungültige Eingaben (Kurs/Aktienzahl ≤ 0)', () => {
    expect(computeGraham(input({ price: 0 }))).toMatchObject({ status: 'notValuable', reason: 'invalidInput' });
    expect(computeGraham(input({ shares: 0 }))).toMatchObject({ status: 'notValuable', reason: 'invalidInput' });
  });
  it('BIST ohne aktuellen Wechselkurs oder ohne Jahresschnittskurs eines TL-Jahres', () => {
    expect(computeGraham(input({ market: 'BIST', currentFx: null }))).toMatchObject({ status: 'notValuable', reason: 'missingFx' });
    const ys = years([1, 1, 1], 2023, { avgFx: 30 });
    ys[1] = { ...ys[1]!, avgFx: null };
    expect(computeGraham(input({ market: 'BIST', reportingCurrency: 'TRY', years: ys, currentFx: 45 }))).toMatchObject({ status: 'notValuable', reason: 'missingFx', years: [2024] });
  });
});

describe('Graham-Checkliste', () => {
  const run = (overrides: Partial<GrahamInput>) => ok(computeGraham(input({ price: 10, shares: 1 * B, years: years([1, 1, 1, 1, 1], 2021), ...overrides }))).checklist;

  it('KGV der letzten 12 Monate ≤ 20 (ohne TTM: letztes Geschäftsjahr)', () => {
    expect(run({ price: 20 }).peTtm).toMatchObject({ ok: true, usedTtm: false });
    expect(run({ price: 20.5 }).peTtm.ok).toBe(false);
  });
  it('mit angegebenem TTM-EPS wird dieses genutzt', () => {
    expect(run({ price: 30, ttmEps: 2 }).peTtm).toMatchObject({ ok: true, usedTtm: true, value: 15 });
    expect(run({ price: 30, ttmEps: -1 }).peTtm.ok).toBe(false);
  });
  it('Kurs ≤ 25 × Ø Gewinn der letzten bis zu 7 Jahre', () => {
    const many = years([1, 1, 1, 1, 1, 1, 1, 50], 2019); // nur die letzten 7 zählen
    expect(run({ years: many, price: 25 * ((6 + 50) / 7) }).grahamNumber).toMatchObject({ ok: true, yearsUsed: 7 });
    expect(run({ price: 25.5 }).grahamNumber.ok).toBe(false);
  });
  it('Dividende: in allen 10 abgeschlossenen Jahren gezahlt → ja', () => {
    const paid = Array.from({ length: 10 }, (_, i) => ({ year: 2016 + i, amount: 1 }));
    expect(run({ dividendYears: paid }).dividends.ok).toBe(true);
  });
  it('Dividende: Lücke in vollständig bekannter Historie → nein; Aktie ohne jede Dividende → nein', () => {
    const gap = Array.from({ length: 10 }, (_, i) => ({ year: 2016 + i, amount: i === 4 ? 0 : 1 }));
    expect(run({ dividendYears: gap, dividendCoverageFromYear: 2016 }).dividends.ok).toBe(false);
    expect(run({ dividendYears: [], dividendCoverageFromYear: 2016 }).dividends.ok).toBe(false);
  });
  it('Dividende: Historie reicht nicht 10 Jahre zurück → unbekannt statt nein', () => {
    const recent = Array.from({ length: 6 }, (_, i) => ({ year: 2020 + i, amount: 1 }));
    expect(run({ dividendYears: recent, dividendCoverageFromYear: 2020 }).dividends.ok).toBeNull();
    expect(run({ dividendYears: recent }).dividends.ok).toBeNull();
  });
  it('Nettoverschuldung < Marktkapitalisierung', () => {
    expect(run({ netDebt: 9 * B }).netDebtBelowMarketCap.ok).toBe(true);
    expect(run({ netDebt: 10 * B }).netDebtBelowMarketCap.ok).toBe(false);
  });
  it('kein Verlustjahr: prüft die unbereinigten Jahresüberschüsse der letzten 5 Jahre', () => {
    expect(run({ years: years([1, 1, 1, 1, 1], 2021) }).noLossYear.ok).toBe(true);
    expect(run({ years: years([1, 1, -0.1, 1, 1], 2021) }).noLossYear.ok).toBe(false);
    expect(run({ years: years([-5, 1, 1, 1, 1, 1], 2020) }).noLossYear.ok).toBe(true); // Verlust liegt vor dem 5-Jahres-Fenster
  });
});
