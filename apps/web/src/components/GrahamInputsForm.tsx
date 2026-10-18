import type { Fundamentals, GrahamReportingCurrency, Market } from '@aktien/core';
import { useState } from 'react';
import { overlayYears } from '../lib/graham-input';
import { grahamInputsStore, type GrahamManual, type GrahamManualYear } from '../lib/graham-store';
import { useT } from '../lib/i18n';
import { Segmented } from './ui';

interface YearRow {
  id: number;
  /** Vom Nutzer in dieser Maske hinzugefügt (Jahr noch änderbar). */
  isNew: boolean;
  /** Schon gespeicherter eigener Wert dieses Jahres (bleibt unverändert erhalten, solange die Felder nicht geändert werden). */
  saved: GrahamManualYear | null;
  /** Ausgangswerte der Felder, um geänderte Zeilen zu erkennen. */
  initial: { netIncome: string; ebit: string; avgFx: string } | null;
  year: string;
  netIncome: string;
  ebit: string;
  avgFx: string;
}

const MILLION = 1_000_000;
const fmt = (n: number | null | undefined, divisor = 1): string => (n === null || n === undefined || !Number.isFinite(n) ? '' : String(Math.round((n / divisor) * 1000) / 1000));

/** `null` bei leerem Feld, `'bad'` bei Text, der keine Zahl ist. */
function parseNumber(raw: string): number | null | 'bad' {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 'bad';
}

function parseDividends(raw: string): { year: number; amount: number }[] | 'bad' {
  const out: { year: number; amount: number }[] = [];
  for (const part of raw.split(/[;\n]/)) {
    if (part.trim() === '') continue;
    const [y, a, ...rest] = part.split('=');
    const year = Number(y?.trim());
    const amount = parseNumber(a ?? '');
    if (rest.length > 0 || !Number.isInteger(year) || amount === 'bad' || amount === null || amount < 0) return 'bad';
    out.push({ year, amount });
  }
  return out;
}

/**
 * Eigene Werte zu einer Aktie. Vorbefüllt mit den aktuell gültigen Werten (eigene oder automatische). Beträge in
 * Millionen. Gespeichert werden nur geänderte und neu hinzugefügte Jahre: Sie überlagern die automatische Reihe für
 * dieses Jahr, alle anderen Jahre bleiben automatisch (und bekommen spätere Aktualisierungen).
 */
export function GrahamInputsForm({ ticker, market, auto, manual, onReset }: { ticker: string; market: Market; auto: Fundamentals | undefined; manual: GrahamManual | undefined; onReset: () => void }) {
  const { t } = useT();
  const isBist = market === 'BIST';
  const effectiveYears = overlayYears(auto, manual);

  const [rows, setRows] = useState<YearRow[]>(() =>
    effectiveYears.map((y, i) => {
      const initial = { netIncome: fmt(y.netIncome, MILLION), ebit: fmt(y.ebit, MILLION), avgFx: fmt(y.avgFx) };
      return { id: i, isNew: false, saved: manual?.years?.find((m) => m.year === y.year) ?? null, initial, year: String(y.year), ...initial };
    }),
  );
  const [nextId, setNextId] = useState(effectiveYears.length);
  // Ausgangswerte der Einzelfelder: nur was davon abweicht (oder schon eigen war), wird als eigener Wert gespeichert.
  const init = {
    currency: manual?.reportingCurrency ?? auto?.reportingCurrency ?? ('TRY' as GrahamReportingCurrency),
    shares: fmt(manual?.shares ?? auto?.shares, MILLION),
    netDebt: fmt(manual?.netDebt ?? auto?.netDebt, MILLION),
    currentFx: fmt(manual?.currentFx ?? auto?.currentFx),
    ttmEps: fmt(manual?.ttmEps),
    dividends: (manual?.dividendYears ?? auto?.dividends ?? []).map((d) => `${d.year}=${fmt(d.amount)}`).join('; '),
  };
  const [currency, setCurrency] = useState<GrahamReportingCurrency>(init.currency);
  const [shares, setShares] = useState(init.shares);
  const [netDebt, setNetDebt] = useState(init.netDebt);
  const [currentFx, setCurrentFx] = useState(init.currentFx);
  const [ttmEps, setTtmEps] = useState(init.ttmEps);
  const [dividends, setDividends] = useState(init.dividends);
  const [error, setError] = useState(false);

  const setRow = (id: number, patch: Partial<YearRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((rs) => [{ id: nextId, isNew: true, saved: null, initial: null, year: '', netIncome: '', ebit: '', avgFx: '' }, ...rs]);
    setNextId((n) => n + 1);
  };

  const apply = () => {
    const years: GrahamManualYear[] = [];
    let bad = false;
    for (const r of rows) {
      const unchanged = r.initial !== null && r.netIncome === r.initial.netIncome && r.ebit === r.initial.ebit && r.avgFx === r.initial.avgFx;
      if (unchanged) {
        // Unveränderte automatische Jahre bleiben automatisch; schon gespeicherte eigene Jahre behalten ihre genauen Werte.
        if (r.saved) years.push(r.saved);
        continue;
      }
      const year = parseNumber(r.year);
      const income = parseNumber(r.netIncome);
      const ebit = parseNumber(r.ebit);
      const fx = parseNumber(r.avgFx);
      if (year === 'bad' || income === 'bad' || ebit === 'bad' || fx === 'bad') bad = true;
      if (typeof year === 'number' && typeof income === 'number') years.push({ year, netIncome: income * MILLION, ebit: typeof ebit === 'number' ? ebit * MILLION : null, avgFx: typeof fx === 'number' && fx > 0 ? fx : null });
    }
    if (new Set(years.map((y) => y.year)).size !== years.length) bad = true; // dasselbe Jahr doppelt
    const sh = parseNumber(shares);
    const nd = parseNumber(netDebt);
    const fx = parseNumber(currentFx);
    const eps = parseNumber(ttmEps);
    const div = parseDividends(dividends);
    if (bad || sh === 'bad' || nd === 'bad' || fx === 'bad' || eps === 'bad' || div === 'bad') {
      setError(true);
      return;
    }
    setError(false);
    const next: GrahamManual = {};
    if (years.length > 0) next.years = years;
    // Unveränderte Felder bleiben automatisch (und aktuell); schon gespeicherte eigene Werte behalten ihre genauen Zahlen.
    if (shares !== init.shares && typeof sh === 'number') next.shares = sh * MILLION;
    else if (manual?.shares !== undefined && shares === init.shares) next.shares = manual.shares;
    if (netDebt !== init.netDebt && typeof nd === 'number') next.netDebt = nd * MILLION;
    else if (manual?.netDebt !== undefined && netDebt === init.netDebt) next.netDebt = manual.netDebt;
    if (isBist && (currency !== init.currency || manual?.reportingCurrency !== undefined)) next.reportingCurrency = currency;
    if (isBist && currentFx !== init.currentFx && typeof fx === 'number') next.currentFx = fx;
    else if (isBist && manual?.currentFx !== undefined && currentFx === init.currentFx) next.currentFx = manual.currentFx;
    if (typeof eps === 'number') next.ttmEps = ttmEps === init.ttmEps && manual?.ttmEps !== undefined ? manual.ttmEps : eps;
    if (dividends !== init.dividends && div.length > 0) next.dividendYears = div;
    else if (manual?.dividendYears !== undefined && dividends === init.dividends) next.dividendYears = manual.dividendYears;
    grahamInputsStore.set(ticker, next);
  };

  return (
    <div className="lot-form">
      <p className="row-hint">{t('graham.form.hint')}</p>

      {isBist && (
        <div className="lot-form-field">
          <span className="row-hint">{t('graham.form.currency')}</span>
          <Segmented
            options={[
              { value: 'TRY', label: t('graham.form.currencyTRY') },
              { value: 'USD', label: t('graham.form.currencyUSD') },
            ]}
            value={currency}
            label={t('graham.form.currency')}
            onChange={setCurrency}
          />
        </div>
      )}

      <div className="graham-year-head row-hint">
        <span>{t('graham.form.year')}</span>
        <span>{t('graham.form.netIncome')}</span>
        <span>{t('graham.form.ebit')}</span>
        {isBist && <span>{t('graham.form.avgFx')}</span>}
        <span />
      </div>
      {rows.map((r) => (
        <div className="graham-year-row" key={r.id}>
          <input className="search-input" inputMode="numeric" type="text" value={r.year} readOnly={!r.isNew} aria-label={t('graham.form.year')} onChange={(e) => setRow(r.id, { year: e.target.value })} />
          <input className="search-input" inputMode="decimal" type="text" value={r.netIncome} aria-label={t('graham.form.netIncome')} onChange={(e) => setRow(r.id, { netIncome: e.target.value })} />
          <input className="search-input" inputMode="decimal" type="text" value={r.ebit} aria-label={t('graham.form.ebit')} onChange={(e) => setRow(r.id, { ebit: e.target.value })} />
          {isBist && <input className="search-input" inputMode="decimal" type="text" value={r.avgFx} aria-label={t('graham.form.avgFx')} onChange={(e) => setRow(r.id, { avgFx: e.target.value })} />}
          {r.isNew || r.saved ? (
            <button type="button" className="delete-btn" aria-label={t('graham.form.removeYear', { year: r.year })} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
              −
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          {t('graham.form.addYear')}
        </button>
      </div>

      <label className="lot-form-field">
        <span className="row-hint">{t('graham.form.shares')}</span>
        <input className="search-input" inputMode="decimal" type="text" value={shares} onChange={(e) => setShares(e.target.value)} />
      </label>
      <label className="lot-form-field">
        <span className="row-hint">{t('graham.form.netDebt')}</span>
        <input className="search-input" inputMode="decimal" type="text" value={netDebt} onChange={(e) => setNetDebt(e.target.value)} />
      </label>
      {isBist && (
        <label className="lot-form-field">
          <span className="row-hint">{t('graham.form.currentFx')}</span>
          <input className="search-input" inputMode="decimal" type="text" value={currentFx} onChange={(e) => setCurrentFx(e.target.value)} />
        </label>
      )}
      <label className="lot-form-field">
        <span className="row-hint">{t('graham.form.ttmEps')}</span>
        <input className="search-input" inputMode="decimal" type="text" value={ttmEps} onChange={(e) => setTtmEps(e.target.value)} />
      </label>
      <label className="lot-form-field">
        <span className="row-hint">{t('graham.form.dividends')}</span>
        <input className="search-input" type="text" value={dividends} placeholder="2023=1,5; 2024=2" onChange={(e) => setDividends(e.target.value)} />
        <span className="row-hint">{t('graham.form.dividendsHint')}</span>
      </label>

      {error && <div className="error-note">{t('graham.form.invalid')}</div>}
      <div className="stack">
        <button type="button" className="btn" onClick={apply}>
          {t('graham.form.apply')}
        </button>
        {manual && (
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            {t('graham.form.reset')}
          </button>
        )}
      </div>
    </div>
  );
}
