/**
 * Kleiner In-Memory-Cache mit Ablaufzeit. Gleichzeitige Anfragen auf denselben Schlüssel teilen sich
 * einen Abruf. Fehler werden nicht zwischengespeichert. Gilt je Serverinstanz: auf Vercel schont er
 * die Yahoo-Limits, solange die Funktion warm ist, mehr nicht.
 */
export class TtlCache {
  private readonly values = new Map<string, { expires: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxEntries = 300,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > this.now()) return hit.value as T;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = load()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private set(key: string, value: unknown, ttlMs: number): void {
    if (this.values.size >= this.maxEntries) {
      const t = this.now();
      for (const [k, v] of this.values) if (v.expires <= t) this.values.delete(k);
      // Immer noch voll: ältesten Eintrag entfernen (Map behält die Einfügereihenfolge).
      if (this.values.size >= this.maxEntries) this.values.delete(this.values.keys().next().value!);
    }
    this.values.set(key, { expires: this.now() + ttlMs, value });
  }

  get size(): number {
    return this.values.size;
  }
}
