import { AdapterError, type AdapterErrorCode } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Austauschbar für Tests. Standard: globales fetch. */
  fetch?: FetchLike;
  /** Austauschbar für Tests, damit Retries nicht real warten. */
  sleep?: (ms: number) => Promise<void>;
  /** Zusätzliche Versuche nach dem ersten (nur bei 429/5xx/Netzwerkfehlern). */
  retries?: number;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * HTTP-Aufruf mit Timeout und Backoff. Ordnet Statuscodes einheitlichen Fehlern zu:
 * 429 → RATE_LIMITED (Retry), 401/403 → BLOCKED (kein Retry), 5xx/Netzwerk → UPSTREAM (Retry).
 * Alle anderen Antworten (auch 404) gibt die Funktion zurück, der Aufrufer entscheidet.
 * Mit `unauthorized: 'CONFIG'` gilt 401 als ungültiger API-Key statt als Sperre.
 */
export async function request(
  url: string,
  init: RequestInit,
  adapter: string,
  opts: HttpOptions = {},
  extra: { unauthorized?: AdapterErrorCode } = {},
): Promise<Response> {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let lastError: AdapterError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt, lastError));
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        lastError = new AdapterError('RATE_LIMITED', `HTTP 429 von ${hostOf(url)}${await detail(res)}`, adapter);
        lastError.retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        continue;
      }
      if (res.status === 401 && extra.unauthorized) {
        throw new AdapterError(extra.unauthorized, `HTTP 401 von ${hostOf(url)}: API-Key ungültig oder fehlt`, adapter);
      }
      if (res.status === 401 || res.status === 403) {
        throw new AdapterError('BLOCKED', `HTTP ${res.status} von ${hostOf(url)} (Zugriff verweigert oder geblockt)${await detail(res)}`, adapter);
      }
      if (res.status >= 500) {
        lastError = new AdapterError('UPSTREAM', `HTTP ${res.status} von ${hostOf(url)}${await detail(res)}`, adapter);
        continue;
      }
      return res;
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      lastError = new AdapterError('UPSTREAM', `Netzwerkfehler/Timeout bei ${hostOf(url)}: ${(err as Error).message}`, adapter, err);
    }
  }
  throw lastError!;
}

function backoffMs(attempt: number, err?: AdapterError): number {
  if (err?.retryAfterMs) return Math.min(err.retryAfterMs, 30_000);
  return 500 * 2 ** (attempt - 1); // 500 ms, 1 s, 2 s …
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

/**
 * Kurzer Auszug der Fehlerantwort für die Meldung (bei Gemini steht dort z. B., ob das Minuten- oder das
 * Tageskontingent erschöpft ist). Bevorzugt das Feld error.message, sonst der Rohtext. Höchstens 200 Zeichen.
 */
async function detail(res: Response): Promise<string> {
  try {
    const raw = (await res.clone().text()).trim();
    if (!raw) return '';
    let msg = raw;
    try {
      const j = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown };
      const inner = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
      if (typeof inner === 'string') msg = inner;
    } catch {
      /* kein JSON: Rohtext verwenden */
    }
    msg = msg.replace(/\s+/g, ' ').trim();
    if (msg.startsWith('<')) return ''; // HTML-Fehlerseiten sind nutzlos
    return `: ${msg.slice(0, 200)}`;
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
