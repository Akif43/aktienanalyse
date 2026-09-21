import { freshnessLabel, marketState, type Quote } from '@aktien/core';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { direction, formatPercent, formatSigned } from '../lib/format';

/** "Echtzeit" bzw. "verzögert (ca. 15 Min.)" plus Börsenstatus. */
export function FreshnessBadge({ quote }: { quote: Quote }) {
  const state = marketState(quote);
  const kind = quote.freshness.kind;
  return (
    <span className="badges">
      <span className={`badge badge-${kind}`}>
        <span className="dot" aria-hidden />
        {freshnessLabel(quote.freshness)}
      </span>
      {state !== 'unknown' && <span className={`badge badge-${state}`}>{state === 'open' ? 'Börse offen' : 'Börse geschlossen'}</span>}
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
  return (
    <p className="disclaimer" role="note">
      <strong>Keine Anlageberatung.</strong> Alle Angaben dienen nur der Information, sind ohne Gewähr und können verzögert oder fehlerhaft sein.
      Kursgewinne der Vergangenheit sagen nichts über die Zukunft aus.
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

export function Spinner({ label = 'Lädt …' }: { label?: string }) {
  return (
    <div className="center-note" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

/** Verständliche Fehlermeldung mit Handlungshinweis. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  let text = 'Etwas ist schiefgelaufen.';
  let hint = '';
  if (error instanceof ApiError) {
    text = error.message;
    if (error.code === 'NETWORK') hint = 'Prüfe deine Internetverbindung.';
    else if (error.code === 'UNAUTHORIZED') hint = 'Trage in den Einstellungen das richtige Zugriffstoken ein.';
    else if (error.code === 'RATE_LIMITED') hint = 'Die Datenquelle bremst gerade. Versuche es in einer Minute erneut.';
    else if (error.code === 'NOT_FOUND') hint = 'Diese Aktie kennt die Datenquelle nicht.';
    else if (error.status >= 500) hint = 'Die Datenquelle ist gerade nicht erreichbar.';
  } else if (error instanceof Error) text = error.message;
  return (
    <div className="error-note" role="alert">
      <div>{text}</div>
      {hint && <div className="muted">{hint}</div>}
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

const icons = {
  list: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.6-6.1-1.4 1.4M7.3 16.7l-1.4 1.4m0-12.2 1.4 1.4m9.4 9.4 1.4 1.4',
};

export function TabBar() {
  const tab = (to: string, label: string, icon: keyof typeof icons, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={icons[icon]} />
      </svg>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Hauptnavigation">
      {tab('/', 'Watchlist', 'list', true)}
      {tab('/suche', 'Suche', 'search')}
      {tab('/einstellungen', 'Einstellungen', 'gear')}
    </nav>
  );
}
