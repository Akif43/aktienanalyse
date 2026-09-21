import { instrumentKey } from '../symbols';
import type { Instrument } from '../types';

export interface WatchlistEntry {
  instrument: Instrument;
  /** Hinzugefügt am (Unix-Millisekunden). */
  addedAt: number;
  /** Eigene News-Suchanfrage, falls Name + Kürzel zu viel Rauschen liefert. */
  newsQuery?: string;
}

/** Speicher für die Watchlist. Lokal eine JSON-Datei, später Supabase (Phase 4/5). */
export interface WatchlistStore {
  list(): Promise<WatchlistEntry[]>;
  add(entry: Omit<WatchlistEntry, 'addedAt'> & { addedAt?: number }): Promise<WatchlistEntry>;
  remove(instrument: Instrument): Promise<boolean>;
}

/** Reine Logik (ohne I/O), gemeinsam genutzt von allen Store-Implementierungen. */
export function addEntry(entries: readonly WatchlistEntry[], entry: WatchlistEntry): { entries: WatchlistEntry[]; added: WatchlistEntry } {
  const key = instrumentKey(entry.instrument);
  const existing = entries.find((e) => instrumentKey(e.instrument) === key);
  if (existing) {
    // Doppeltes Hinzufügen aktualisiert nur den Namen bzw. die Suche, Reihenfolge und Datum bleiben.
    const merged: WatchlistEntry = {
      ...existing,
      instrument: { ...existing.instrument, name: entry.instrument.name ?? existing.instrument.name },
      newsQuery: entry.newsQuery ?? existing.newsQuery,
    };
    return { entries: entries.map((e) => (e === existing ? merged : e)), added: merged };
  }
  return { entries: [...entries, entry], added: entry };
}

export function removeEntry(entries: readonly WatchlistEntry[], instrument: Instrument): { entries: WatchlistEntry[]; removed: boolean } {
  const key = instrumentKey(instrument);
  const next = entries.filter((e) => instrumentKey(e.instrument) !== key);
  return { entries: next, removed: next.length !== entries.length };
}

export class InMemoryWatchlistStore implements WatchlistStore {
  private entries: WatchlistEntry[] = [];

  async list(): Promise<WatchlistEntry[]> {
    return [...this.entries];
  }

  async add(entry: Omit<WatchlistEntry, 'addedAt'> & { addedAt?: number }): Promise<WatchlistEntry> {
    const res = addEntry(this.entries, { ...entry, addedAt: entry.addedAt ?? Date.now() });
    this.entries = res.entries;
    return res.added;
  }

  async remove(instrument: Instrument): Promise<boolean> {
    const res = removeEntry(this.entries, instrument);
    this.entries = res.entries;
    return res.removed;
  }
}
