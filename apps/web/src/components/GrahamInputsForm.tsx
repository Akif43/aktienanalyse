import type { Fundamentals, GrahamReportingCurrency, Market } from '@aktien/core';
import { useState } from 'react';
import { grahamInputsStore, type GrahamManual, type GrahamManualYear } from '../lib/graham-store';
import { useT } from '../lib/i18n';
import { Segmented } from './ui';

interface YearRow {
  id: number;
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
 * Millionen. Eine hier gespeicherte Jahresreihe ersetzt die automatische komplett.
 */
export function GrahamInputsForm({ ticker, market, auto, manual, onReset }: { ticker: string; market: Market; auto: Fundamentals | undefined; manual: GrahamManual | undefined; onReset: () => void }) {
  const { t } = useT();
  const isBist = market === 'BIST';
  const avgUsdTry = auto?.avgUsdTry ?? {};
  const sourceYears = manual?.years ?? auto?.years ?? [];

  const [rows, setRows] = useState<YearRow[]>(() =>
    sourceYears.map((y, i) => ({ id: i, year: String(y.year), netIncome: fmt(y.netIncome, MILLION), ebit: fmt(y.ebit, MILLION), avgFx: fmt(y.avgFx ?? avgUsdTry[y.year] ?? null) })),
  );
  const [nextId, setNextId] = useState(sourceYears.length);
  const [currency, setCurrency] = useState<GrahamReportingCurrency>(manual?.reportingCurrency ?? auto?.reportingCurrency ?? 'TRY');
  const [shares, setShares] = useState(fmt(manual?.shares ?? auto?.shares, MILLION));
  const [netDebt, setNetDebt] = useState(fmt(manual?.netDebt ?? auto?.netDebt, MILLION));
  const [currentFx, setCurrentFx] = useState(fmt(manual?.currentFx ?? auto?.currentFx));
  const [ttmEps, setTtmEps] = useState(fmt(manual?.ttmEps));
  const [dividends, setDividends] = useState((manual?.dividendYears ?? auto?.dividends ?? []).map((d) => `${d.year}=${fmt(d.amount)}`).join('; '));
  const [error, setError] = useState(false);

  const setRow = (id: number, patch: Partial<YearRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((rs) => [...rs, { id: nextId, year: '', netIncome: '', ebit: '', avgFx: '' }]);
    setNextId((n) => n + 1);
  };

  const apply = () => {
    const years: GrahamManualYear[] = [];
    let bad = false;
    for (const r of rows) {
      const year = parseNumber(r.year);
      const income = parseNumber(r.netIncome);
      const ebit = parseNumber(r.ebit);
      const fx = parseNumber(r.avgFx);
      if (year === 'bad' || income === 'bad' || ebit === 'bad' || fx === 'bad') bad = true;
      if (typeof year === 'number' && typeof income === 'number') years.push({ year, netIncome: income * MILLION, ebit: typeof ebit === 'number' ? ebit * MILLION : null, avgFx: typeof fx === 'number' && fx > 0 ? fx : null });
    }
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
    if (typeof sh === 'number') next.shares = sh * MILLION;
    if (typeof nd === 'number') next.netDebt = nd * MILLION;
    if (isBist) next.reportingCurrency = currency;
    if (isBist && typeof fx === 'number') next.currentFx = fx;
    if (typeof eps === 'number') next.ttmEps = eps;
    if (div.length > 0) next.dividendYears = div;
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
          <input className="search-input" inputMode="numeric" type="text" value={r.year} aria-label={t('graham.form.year')} onChange={(e) => setRow(r.id, { year: e.target.value })} />
          <input className="search-input" inputMode="decimal" type="text" value={r.netIncome} aria-label={t('graham.form.netIncome')} onChange={(e) => setRow(r.id, { netIncome: e.target.value })} />
          <input className="search-input" inputMode="decimal" type="text" value={r.ebit} aria-label={t('graham.form.ebit')} onChange={(e) => setRow(r.id, { ebit: e.target.value })} />
          {isBist && <input className="search-input" inputMode="decimal" type="text" value={r.avgFx} aria-label={t('graham.form.avgFx')} onChange={(e) => setRow(r.id, { avgFx: e.target.value })} />}
          <button type="button" className="delete-btn" aria-label={t('graham.form.removeYear', { year: r.year })} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
            −
          </button>
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
