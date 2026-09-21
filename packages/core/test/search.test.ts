import { describe, expect, it } from 'vitest';
import { cleanName, searchInstruments } from '../src';
import { readFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

describe('searchInstruments', () => {
  it('liefert BIST, XETRA und US-Aktien und blendet ETFs, Futures und fremde Börsen aus', async () => {
    const m = mockFetch(text(readFixture('yahoo-search-sap.json')));
    const res = await searchInstruments('sap', { fetch: m.fetch });

    expect(res.map((r) => r.ticker)).toEqual(['SAP', 'SAP.DE']); // SAP.TO/SAP.WA/… entfallen
    expect(res[0]).toMatchObject({ symbol: 'SAP', market: 'US', name: 'SAP SE', marketLabel: 'US-Börse' });
    expect(res[1]).toMatchObject({ symbol: 'SAP', market: 'XETRA', ticker: 'SAP.DE', marketLabel: 'XETRA' });
    expect(m.calls[0]!.url).toContain('q=sap');
  });

  it('entfernt das Yahoo-Suffix bei BIST und ignoriert ETFs', async () => {
    const res = await searchInstruments('thy', { fetch: mockFetch(text(readFixture('yahoo-search-thy.json'))).fetch });
    const thyao = res.find((r) => r.symbol === 'THYAO');
    expect(thyao).toMatchObject({ market: 'BIST', ticker: 'THYAO.IS' });
    expect(thyao!.name).toMatch(/Hava Yollari/i);
    expect(res.some((r) => r.symbol === 'THY')).toBe(false); // ETF
    expect(res.find((r) => r.symbol === 'TKA')).toMatchObject({ market: 'XETRA', ticker: 'TKA.DE' });
  });

  it('macht bei leerer oder zu langer Eingabe gar keinen Request', async () => {
    const m = mockFetch(json({ quotes: [] }));
    expect(await searchInstruments('   ', { fetch: m.fetch })).toEqual([]);
    expect(await searchInstruments('x'.repeat(41), { fetch: m.fetch })).toEqual([]);
    expect(m.calls).toHaveLength(0);
  });

  it('kodiert die Eingabe für die URL', async () => {
    const m = mockFetch(json({ quotes: [] }));
    await searchInstruments('a&b=c d', { fetch: m.fetch });
    expect(m.calls[0]!.url).toContain('q=a%26b%3Dc%20d');
    expect(new URL(m.calls[0]!.url).searchParams.get('q')).toBe('a&b=c d');
  });

  it('meldet Fehler und dedupliziert', async () => {
    const dup = json({ quotes: [{ symbol: 'A', exchange: 'NMS', quoteType: 'EQUITY' }, { symbol: 'A', exchange: 'NMS', quoteType: 'EQUITY' }] });
    expect(await searchInstruments('a', { fetch: mockFetch(dup).fetch })).toHaveLength(1);
    const err = await searchInstruments('a', { fetch: mockFetch(text('', 500)).fetch, retries: 0 }).catch((e) => e);
    expect(err.code).toBe('UPSTREAM');
    const bad = await searchInstruments('a', { fetch: mockFetch(json({ quotes: 5 })).fetch }).catch((e) => e);
    expect(bad.code).toBe('BAD_RESPONSE');
  });

  it('cleanName', () => {
    expect(cleanName('  SAP   SE ')).toBe('SAP SE');
  });
});
