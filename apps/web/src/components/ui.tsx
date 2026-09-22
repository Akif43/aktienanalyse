import { marketState, type Quote } from '@aktien/core';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { direction, formatPercent, formatSigned, freshnessText } from '../lib/format';
import { useT, type DictKey } from '../lib/i18n';

/** "Live" bzw. "ca. 15 Min. verzögert" plus Börsenstatus. */
export function FreshnessBadge({ quote }: { quote: Quote }) {
  const { t, lang } = useT();
  const state = marketState(quote);
  const kind = quote.freshness.kind;
  return (
    <span className="badges">
      <span className={`badge badge-${kind}`}>
        <span className="dot" aria-hidden />
        {freshnessText(quote.freshness, lang)}
      </span>
      {state !== 'unknown' && <span className={`badge badge-${state}`}>{state === 'open' ? t('market.open') : t('market.closed')}</span>}
    </span>
  );
}

export function ChangePill({ percent, change, showAbsolute = false }: { percent: number | null; change?: number | null; showAbsolute?: boolean }) {
  const dir = direction(percent);
  return (
    <span className={`pill pill-${dir}`}>
      {showAbsolute && change !== undefined && <span className="pill-abs">{formatSigned(change)}</span>}
      {formatPercent(percent)}
    </span>
  );
}

export function Disclaimer() {
  const { t } = useT();
  return (
    <p className="disclaimer" role="note">
      <strong>{t('disclaimer.strong')}</strong> {t('disclaimer.text')}
    </p>
  );
}

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, disabled, onClick, children, color }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button type="button" className={`chip ${active ? 'chip-on' : ''}`} disabled={disabled} aria-pressed={active} onClick={onClick}>
      {color && <span className="chip-swatch" style={{ background: color }} aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div className="center-note" role="status">
      <span className="spinner" aria-hidden /> {label ?? t('common.loading')}
    </div>
  );
}

const KNOWN_ERRORS = ['NETWORK', 'UNAUTHORIZED', 'RATE_LIMITED', 'NOT_FOUND', 'BLOCKED', 'UPSTREAM', 'BAD_RESPONSE', 'BAD_REQUEST', 'AI_NOT_CONFIGURED', 'INTERNAL'] as const;

/** Verständliche Fehlermeldung mit Handlungshinweis in der gewählten Sprache (der Servertext bleibt außen vor). */
export function ErrorNote({ error, onRetry, message }: { error?: unknown; onRetry?: () => void; message?: string }) {
  const { t } = useT();
  let text = message ?? t('error.generic');
  let hint = '';
  if (!message && error instanceof ApiError) {
    const code = KNOWN_ERRORS.find((c) => c === error.code);
    if (code) {
      text = t(`error.${code}` as DictKey);
      const hintKey = `error.${code}.hint` as DictKey;
      // Hinweise gibt es nur für einen Teil der Codes
      const h = t(hintKey);
      if (h !== hintKey) hint = h;
    } else if (error.status >= 500) {
      text = t('error.UPSTREAM');
      hint = t('error.UPSTREAM.hint');
    }
  }
  return (
    <div className="error-note" role="alert">
      <div>{text}</div>
      {hint && <div className="muted">{hint}</div>}
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

const icons = {
  list: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.6-6.1-1.4 1.4M7.3 16.7l-1.4 1.4m0-12.2 1.4 1.4m9.4 9.4 1.4 1.4',
  depot: 'M23 6 13.5 15.5 8.5 10.5 1 18M17 6h6v6',
};

export function TabBar() {
  const { t } = useT();
  const tab = (to: string, label: string, icon: keyof typeof icons, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={icons[icon]} />
      </svg>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label={t('nav.aria')}>
      {tab('/', t('nav.watchlist'), 'list', true)}
      {tab('/suche', t('nav.search'), 'search')}
      {tab('/depot', t('nav.depot'), 'depot')}
      {tab('/einstellungen', t('nav.settings'), 'gear')}
    </nav>
  );
}
