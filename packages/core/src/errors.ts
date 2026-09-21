export type AdapterErrorCode =
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'UPSTREAM'
  | 'BAD_RESPONSE'
  | 'UNSUPPORTED'
  | 'CONFIG';

/**
 * Einheitlicher Fehler aller Datenquellen. Die UI und der Fallback-Mechanismus
 * unterscheiden anhand des Codes, ob ein Retry oder ein anderer Adapter sinnvoll ist.
 */
export class AdapterError extends Error {
  /** Vom Server vorgegebene Wartezeit (Retry-After) bei RATE_LIMITED. */
  retryAfterMs?: number;

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly adapter: string,
    override readonly cause?: unknown,
  ) {
    super(`[${adapter}] ${message}`);
    this.name = 'AdapterError';
  }

  /** Nur diese Fehler lohnen einen zweiten Versuch beim selben Anbieter. */
  get retryable(): boolean {
    return this.code === 'RATE_LIMITED' || this.code === 'UPSTREAM';
  }
}
