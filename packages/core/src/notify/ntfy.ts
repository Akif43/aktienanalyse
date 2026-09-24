import { AdapterError } from '../errors';
import { request, type HttpOptions } from '../http';
import type { Notifier, NotifyInput } from './types';

export interface NtfyOptions extends HttpOptions {
  /** Basis-URL, Standard https://ntfy.sh (eigene Instanz möglich). */
  url?: string;
  /** Langer Zufallswert, das einzige Geheimnis (kein Account nötig). */
  topic: string;
}

/**
 * Push über ntfy (https://ntfy.sh). Nutzt die JSON-Veröffentlichung (statt Topic-im-Pfad + Headern),
 * damit Umlaute/türkische Zeichen im Titel keine Header-Kodierungsprobleme verursachen.
 */
export class NtfyNotifier implements Notifier {
  private readonly base: string;

  constructor(private readonly opts: NtfyOptions) {
    if (!opts.topic) throw new AdapterError('CONFIG', 'NTFY_TOPIC fehlt', 'ntfy');
    this.base = (opts.url ?? 'https://ntfy.sh').replace(/\/+$/, '');
  }

  async send(input: NotifyInput): Promise<void> {
    const res = await request(
      this.base,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: this.opts.topic, title: input.title, message: input.message, click: input.url }) },
      'ntfy',
      { retries: 1, timeoutMs: 10_000, fetch: this.opts.fetch, sleep: this.opts.sleep },
    );
    if (!res.ok) throw new AdapterError('UPSTREAM', `ntfy senden: HTTP ${res.status}`, 'ntfy');
  }
}
