import { AdapterError } from '../errors';
import { request, type HttpOptions } from '../http';

export interface StoredValue<T> {
  value: T;
  /** Zeitpunkt des letzten Schreibens (Unix-Millisekunden). */
  updatedAt: number;
}

/** Einfacher Schlüssel-Wert-Speicher für Auswertungen und Zähler. Lokal im Speicher, produktiv Supabase. */
export interface KeyValueStore {
  get<T>(key: string): Promise<StoredValue<T> | null>;
  set<T>(key: string, value: T): Promise<void>;
}

/** Nur für Tests und lokale Entwicklung: geht beim Neustart verloren (auf Vercel bei jedem Kaltstart). */
export class MemoryKv implements KeyValueStore {
  private readonly map = new Map<string, StoredValue<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string): Promise<StoredValue<T> | null> {
    return (this.map.get(key) as StoredValue<T> | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, { value, updatedAt: this.now() });
  }
}

export interface SupabaseKvOptions extends HttpOptions {
  /** Projekt-URL, z. B. https://abcd1234.supabase.co */
  url: string;
  /** Service-Role-Key (nur serverseitig verwenden, nie im Frontend). */
  serviceKey: string;
  table?: string;
}

/**
 * Speicher in Supabase (Postgres) über die REST-Schnittstelle, ohne zusätzliche Bibliothek.
 * Tabelle: siehe supabase/schema.sql (Spalten key, value, updated_at).
 */
export class SupabaseKv implements KeyValueStore {
  private readonly base: string;
  private readonly table: string;

  constructor(private readonly opts: SupabaseKvOptions) {
    if (!opts.url || !opts.serviceKey) throw new AdapterError('CONFIG', 'SUPABASE_URL und SUPABASE_SERVICE_KEY nötig', 'supabase');
    this.base = opts.url.replace(/\/+$/, '');
    this.table = opts.table ?? 'kv_cache';
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.opts.serviceKey, authorization: `Bearer ${this.opts.serviceKey}`, 'content-type': 'application/json', ...extra };
  }

  async get<T>(key: string): Promise<StoredValue<T> | null> {
    const url = `${this.base}/rest/v1/${this.table}?key=eq.${encodeURIComponent(key)}&select=value,updated_at&limit=1`;
    const res = await request(url, { headers: this.headers() }, 'supabase', { retries: 1, timeoutMs: 10_000, fetch: this.opts.fetch, sleep: this.opts.sleep }, { unauthorized: 'CONFIG' });
    if (!res.ok) throw new AdapterError('UPSTREAM', `Supabase lesen: HTTP ${res.status}`, 'supabase');
    const rows = (await res.json().catch(() => null)) as { value: T; updated_at: string }[] | null;
    if (!Array.isArray(rows)) throw new AdapterError('BAD_RESPONSE', 'Supabase lieferte kein Array', 'supabase');
    const row = rows[0];
    return row ? { value: row.value, updatedAt: Date.parse(row.updated_at) } : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const res = await request(
      `${this.base}/rest/v1/${this.table}?on_conflict=key`,
      {
        method: 'POST',
        headers: this.headers({ prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      },
      'supabase',
      { retries: 1, timeoutMs: 10_000, fetch: this.opts.fetch, sleep: this.opts.sleep },
      { unauthorized: 'CONFIG' },
    );
    if (!res.ok) throw new AdapterError('UPSTREAM', `Supabase schreiben: HTTP ${res.status}`, 'supabase');
  }
}

/** Fehlertoleranter Speicher: fällt bei Supabase-Ausfall auf den Arbeitsspeicher zurück, statt die Auswertung zu blockieren. */
export class ResilientKv implements KeyValueStore {
  constructor(
    private readonly primary: KeyValueStore,
    private readonly fallback: KeyValueStore = new MemoryKv(),
    private readonly onError?: (err: unknown) => void,
  ) {}

  async get<T>(key: string): Promise<StoredValue<T> | null> {
    try {
      return (await this.primary.get<T>(key)) ?? (await this.fallback.get<T>(key));
    } catch (err) {
      this.onError?.(err);
      return this.fallback.get<T>(key);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.fallback.set(key, value);
    try {
      await this.primary.set(key, value);
    } catch (err) {
      this.onError?.(err);
    }
  }
}
