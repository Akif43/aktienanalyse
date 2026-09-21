import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshnessLabel, hashString, InMemoryWatchlistStore, instrumentKey, marketState, parseInstrument, toYahooSymbol } from '../src';
import { JsonFileWatchlistStore } from '../src/node';

describe('Symbole', () => {
  it('bildet Yahoo-Ticker je Markt', () => {
    expect(toYahooSymbol({ symbol: 'thyao', market: 'BIST' })).toBe('THYAO.IS');
    expect(toYahooSymbol({ symbol: 'SAP', market: 'XETRA' })).toBe('SAP.DE');
    expect(toYahooSymbol({ symbol: 'AAPL', market: 'US' })).toBe('AAPL');
    expect(toYahooSymbol({ symbol: 'BRK-B', market: 'US' })).toBe('BRK-B');
  });

  it('erkennt den Markt am Suffix, sonst gilt der Standardmarkt', () => {
    expect(parseInstrument('thyao.is')).toEqual({ symbol: 'THYAO', market: 'BIST' });
    expect(parseInstrument(' sap.de ')).toEqual({ symbol: 'SAP', market: 'XETRA' });
    expect(parseInstrument('aapl')).toEqual({ symbol: 'AAPL', market: 'US' });
    expect(parseInstrument('ASELS', 'BIST')).toEqual({ symbol: 'ASELS', market: 'BIST' });
  });

  it('lehnt ungültige Eingaben ab (auch Versuche, die URL zu manipulieren)', () => {
    for (const bad of ['', '  ', '../etc', 'A B', 'THYAO?range=1d', 'x'.repeat(30), 'A/B']) {
      expect(() => parseInstrument(bad)).toThrow(/Ungültiges Kürzel/);
    }
  });

  it('instrumentKey ist eindeutig je Markt', () => {
    expect(instrumentKey({ symbol: 'x', market: 'US' })).not.toBe(instrumentKey({ symbol: 'x', market: 'BIST' }));
  });

  it('freshnessLabel', () => {
    expect(freshnessLabel({ kind: 'realtime' })).toBe('Echtzeit');
    expect(freshnessLabel({ kind: 'delayed', minutes: 20 })).toBe('verzögert (ca. 20 Min.)');
    expect(freshnessLabel({ kind: 'eod' })).toContain('Tagesschluss');
  });

  it('hashString ist stabil und unterscheidet Eingaben', () => {
    expect(hashString('a')).toBe(hashString('a'));
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('https://x/1')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('InMemoryWatchlistStore', () => {
  it('fügt hinzu, verhindert Dubletten und entfernt', async () => {
    const s = new InMemoryWatchlistStore();
    await s.add({ instrument: { symbol: 'THYAO', market: 'BIST' } });
    await s.add({ instrument: { symbol: 'AAPL', market: 'US' } });
    const again = await s.add({ instrument: { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' }, newsQuery: 'THY' });

    const list = await s.list();
    expect(list.map((e) => e.instrument.symbol)).toEqual(['THYAO', 'AAPL']); // Reihenfolge bleibt
    expect(again.instrument.name).toBe('Türk Hava Yolları');
    expect(list[0]!.newsQuery).toBe('THY');

    expect(await s.remove({ symbol: 'THYAO', market: 'BIST' })).toBe(true);
    expect(await s.remove({ symbol: 'THYAO', market: 'BIST' })).toBe(false);
    expect((await s.list()).map((e) => e.instrument.symbol)).toEqual(['AAPL']);
  });

  it('unterscheidet gleiche Kürzel an verschiedenen Märkten', async () => {
    const s = new InMemoryWatchlistStore();
    await s.add({ instrument: { symbol: 'ABC', market: 'US' } });
    await s.add({ instrument: { symbol: 'ABC', market: 'BIST' } });
    expect(await s.list()).toHaveLength(2);
  });
});

describe('JsonFileWatchlistStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wl-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('startet leer, speichert dauerhaft und legt Ordner an', async () => {
    const path = join(dir, 'sub', 'wl.json');
    const s = new JsonFileWatchlistStore(path);
    expect(await s.list()).toEqual([]);

    await s.add({ instrument: { symbol: 'SAP', market: 'XETRA', name: 'SAP SE' }, addedAt: 42 });
    const reopened = new JsonFileWatchlistStore(path);
    expect(await reopened.list()).toEqual([{ instrument: { symbol: 'SAP', market: 'XETRA', name: 'SAP SE' }, addedAt: 42 }]);
    expect(JSON.parse(await readFile(path, 'utf-8')).version).toBe(1);

    expect(await reopened.remove({ symbol: 'SAP', market: 'XETRA' })).toBe(true);
    expect(await new JsonFileWatchlistStore(path).list()).toEqual([]);
  });

  it('meldet beschädigte Dateien statt sie zu überschreiben', async () => {
    const path = join(dir, 'wl.json');
    await writeFile(path, JSON.stringify({ version: 1, entries: [{ instrument: { symbol: 'X', market: 'MARS' }, addedAt: 1 }] }));
    const s = new JsonFileWatchlistStore(path);
    await expect(s.list()).rejects.toThrow(/beschädigt/);
    await expect(s.add({ instrument: { symbol: 'A', market: 'US' } })).rejects.toThrow(/beschädigt/);
    expect(JSON.parse(await readFile(path, 'utf-8')).entries).toHaveLength(1); // unverändert
  });
});

describe('marketState', () => {
  const session = { start: 1_000_000, end: 1_000_000 + 8 * 3600 };
  const delayed = { kind: 'delayed', minutes: 15 } as const;
  const at = (s: number) => s * 1000;

  it('offen: innerhalb der Sitzung mit frischem Kurs', () => {
    expect(marketState({ session, asOf: session.start + 3600, freshness: delayed }, at(session.start + 3600 + 15 * 60))).toBe('open');
  });

  it('geschlossen: vor Beginn und nach Ende', () => {
    const q = { session, asOf: session.end, freshness: delayed };
    expect(marketState(q, at(session.start - 60))).toBe('closed');
    expect(marketState(q, at(session.end + 60))).toBe('closed');
  });

  it('Feiertag: Sitzungsfenster gilt, aber der letzte Kurs ist alt → geschlossen', () => {
    const q = { session, asOf: session.start - 20 * 3600, freshness: delayed };
    expect(marketState(q, at(session.start + 5 * 3600))).toBe('closed');
  });

  it('kurz nach Handelsbeginn zählt der Vortageskurs noch nicht als Feiertag (Karenzzeit)', () => {
    const q = { session, asOf: session.start - 16 * 3600, freshness: delayed };
    expect(marketState(q, at(session.start + 10 * 60))).toBe('open');
    expect(marketState(q, at(session.start + 46 * 60))).toBe('closed'); // 15 + 30 Min. Karenz vorbei
  });

  it('unbekannt ohne Sitzungsfenster oder bei Tagesschlusskursen', () => {
    expect(marketState({ session: undefined, asOf: 1, freshness: delayed }, 1)).toBe('unknown');
    expect(marketState({ session, asOf: 1, freshness: { kind: 'eod' } }, at(session.start + 1))).toBe('unknown');
  });
});
