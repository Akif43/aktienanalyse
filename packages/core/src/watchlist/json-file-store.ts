import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Instrument } from '../types';
import { addEntry, removeEntry, type WatchlistEntry, type WatchlistStore } from './watchlist';

const fileSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      instrument: z.object({ symbol: z.string().min(1), market: z.enum(['BIST', 'US', 'XETRA']), name: z.string().optional() }),
      addedAt: z.number(),
      newsQuery: z.string().optional(),
    }),
  ),
});

/** Watchlist als JSON-Datei für lokale Entwicklung (Node). Schreibt atomar (Temp-Datei + Rename). */
export class JsonFileWatchlistStore implements WatchlistStore {
  constructor(private readonly path: string) {}

  async list(): Promise<WatchlistEntry[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`Watchlist-Datei ${this.path} ist beschädigt: ${parsed.error.issues[0]?.message}`);
    return parsed.data.entries;
  }

  async add(entry: Omit<WatchlistEntry, 'addedAt'> & { addedAt?: number }): Promise<WatchlistEntry> {
    const res = addEntry(await this.list(), { ...entry, addedAt: entry.addedAt ?? Date.now() });
    await this.write(res.entries);
    return res.added;
  }

  async remove(instrument: Instrument): Promise<boolean> {
    const res = removeEntry(await this.list(), instrument);
    if (res.removed) await this.write(res.entries);
    return res.removed;
  }

  private async write(entries: WatchlistEntry[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf-8');
    await rename(tmp, this.path);
  }
}
