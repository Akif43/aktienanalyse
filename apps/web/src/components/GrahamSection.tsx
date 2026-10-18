import { computeGraham, GRAHAM_MAX_GROWTH, type Fundamentals, type GrahamNote, type GrahamNotValuable, type GrahamValuation, type GrahamVerdict, type Market } from '@aktien/core';
import { useMemo } from 'react';
import { mergeGrahamInput, type GrahamMerged } from '../lib/graham-input';
import { grahamInputsStore, useGrahamInputs, useGrahamSettings } from '../lib/graham-store';
import { formatNumber, formatPrice, formatVolume } from '../lib/format';
import { useFundamentals } from '../lib/hooks';
import { useT, type DictKey } from '../lib/i18n';
import { Collapsible } from './Collapsible';
import { GrahamInputsForm } from './GrahamInputsForm';
import { ErrorNote, Spinner } from './ui';

const LEVEL: Record<GrahamVerdict, number> = { stronglyUndervalued: 1, undervalued: 2, fair: 3, slightlyExpensive: 4, expensive: 5 };
const CALC_OPEN_KEY = 'aktien.graham.calc.open';
const FORM_OPEN_KEY = 'aktien.graham.form.open';

/** Bewertung nach Graham auf der Aktien-Detailseite: Einstufung, Szenarien, Rechnung, Checkliste und Eingabemaske. */
export function GrahamSection({ ticker, market, price, currency }: { ticker: string; market: Market; price: number | undefined; currency: string | undefined }) {
  const { t } = useT();
  const fundamentals = useFundamentals(ticker);
  const manual = useGrahamInputs()[ticker.toUpperCase()];
  const settings = useGrahamSettings();

  const merged = useMemo(() => (price === undefined ? null : mergeGrahamInput(fundamentals.data, manual, { market, price })), [fundamentals.data, manual, market, price]);
  const result = useMemo(() => (merged?.input ? computeGraham(merged.input, settings) : null), [merged, settings]);
  const waiting = fundamentals.isPending && !manual?.years;

  return (
    <section className="group graham">
      <h3>{t('graham.title')}</h3>

      {waiting ? (
        <Spinner label={t('graham.loading')} />
      ) : (
        <>
          {fundamentals.isError && !manual?.years && <ErrorNote message={t('graham.loadError')} onRetry={() => fundamentals.refetch()} />}
          {price === undefined ? (
            <p className="row-hint pad">{t('graham.priceLoading')}</p>
          ) : result?.status === 'ok' ? (
            <GrahamResultView v={result} currency={currency} market={market} />
          ) : (
            <NotValuableNote merged={merged} result={result?.status === 'notValuable' ? result : null} />
          )}
          <Notes fundamentals={fundamentals.data} result={result?.status === 'ok' ? result : null} usesManual={Boolean(merged?.usesManual)} mixedSeries={Boolean(merged?.mixedSeries)} />
          <div className="graham-form-wrap">
            <Collapsible title={t('graham.form.title')} subtitle={t('graham.form.subtitle')} storageKey={FORM_OPEN_KEY}>
              <GrahamInputsForm
                key={`${ticker}:${fundamentals.data ? 'a' : 'n'}:${manual ? 'm' : 'x'}`}
                ticker={ticker}
                market={market}
                auto={fundamentals.data}
                manual={manual}
                onReset={() => grahamInputsStore.clear(ticker)}
              />
            </Collapsible>
          </div>
        </>
      )}
      <p className="row-hint pad">{t('graham.bankHint')}</p>
      <p className="disclaimer small">{t('graham.disclaimer')}</p>
    </section>
  );
}

function NotValuableNote({ merged, result }: { merged: GrahamMerged | null; result: GrahamNotValuable | null }) {
  const { t } = useT();
  let text: string | null = null;
  if (merged && merged.missing.length > 0) {
    text = t('graham.notValuable.missing', { fields: merged.missing.map((f) => t(`graham.field.${f}` as const)).join(', ') });
  } else if (result) {
    switch (result.reason) {
      case 'negativeEps':
        text = t('graham.notValuable.negativeEps');
        break;
      case 'tooFewYears':
        text = t('graham.notValuable.tooFewYears', { have: result.have ?? 0, need: result.need ?? 0 });
        break;
      case 'missingFx':
        text = result.years && result.years.length > 0 ? t('graham.notValuable.missingFx', { years: result.years.join(', ') }) : t('graham.notValuable.missingFxNow');
        break;
      case 'invalidInput':
        text = t('graham.notValuable.invalidInput');
        break;
    }
  }
  return text ? <div className="warn-note">{text}</div> : null;
}

function noteText(n: GrahamNote, t: ReturnType<typeof useT>['t']): string {
  switch (n.code) {
    case 'fewYears':
      return t('graham.note.fewYears', { years: n.years, window: n.window });
    case 'cyclicalDiscount':
      return t('graham.note.cyclicalDiscount', { percent: formatNumber(n.percent, 1) });
    case 'fewGrowthRates':
      return t('graham.note.fewGrowthRates', { rates: n.rates });
    case 'adjustedYears':
      return t('graham.note.adjustedYears', { years: n.years });
    case 'ias29':
      return t('graham.note.ias29');
    case 'ttmFallback':
      return t('graham.note.ttmFallback');
  }
}

const SOURCE_NAME: Record<Fundamentals['source'], string> = { yahoo: 'Yahoo Finance', isyatirim: 'İş Yatırım', edgar: 'SEC EDGAR' };

function Notes({ fundamentals, result, usesManual, mixedSeries }: { fundamentals: Fundamentals | undefined; result: GrahamValuation | null; usesManual: boolean; mixedSeries: boolean }) {
  const { t } = useT();
  const lines: string[] = [];
  for (const n of result?.notes ?? []) lines.push(noteText(n, t));
  for (const w of fundamentals?.warnings ?? []) {
    if (w.code === 'sourceFallback') lines.push(t('graham.warn.sourceFallback', { reason: w.reason }));
    else if (w.code === 'edgarFallback') lines.push(t('graham.warn.edgarFallback', { reason: w.reason }));
    else lines.push(t(`graham.warn.${w.code}` as const));
  }
  if (usesManual) lines.push(t('graham.manualUsed'));
  if (mixedSeries) lines.push(t('graham.note.mixedSeries'));
  if (fundamentals && fundamentals.years.length > 0) lines.push(t('graham.source', { source: SOURCE_NAME[fundamentals.source] }));
  if (lines.length === 0) return null;
  return (
    <ul className="graham-notes">
      {lines.map((l, i) => (
        <li key={i} className="row-hint">
          {l}
        </li>
      ))}
    </ul>
  );
}

function GrahamResultView({ v, currency, market }: { v: GrahamValuation; currency: string | undefined; market: Market }) {
  const { t } = useT();
  const money = (n: number) => formatPrice(n, currency);
  const base = v.scenarios.base;
  const implied = v.impliedGrowth;

  return (
    <div>
      <div className="graham-head">
        <span className={`graham-badge graham-${LEVEL[v.verdict]}`}>{t(`graham.verdict.${v.verdict}` as const)}</span>
        <span className="row-hint">{t(`graham.type.${v.type}` as const)}</span>
      </div>

      <div className="row">
        <div className="row-label">{t('graham.price')}</div>
        <div className="row-value">{money(v.price)}</div>
      </div>
      <div className="row">
        <div className="row-label">{t('graham.buyLimit')}</div>
        <div className="row-value">{money(base.buyLimit)}</div>
      </div>
      <div className="row">
        <div className="row-label">{t('graham.intrinsic')}</div>
        <div className="row-value">{money(base.intrinsicValue)}</div>
      </div>
      <div className="row">
        <div className="row-label">{t('graham.eps')}</div>
        <div className="row-value">{money(v.eps)}</div>
      </div>

      <h4 className="lots-title">{t('graham.scenarios')}</h4>
      <div className="graham-table-wrap">
        <table className="graham-table">
          <thead>
            <tr>
              <th>{t('graham.col.scenario')}</th>
              <th>{t('graham.col.pe')}</th>
              <th>{t('graham.col.intrinsic')}</th>
              <th>{t('graham.col.buyLimit')}</th>
            </tr>
          </thead>
          <tbody>
            {(['conservative', 'base', 'optimistic'] as const).map((id) => (
              <tr key={id}>
                <td>{t(`graham.scenario.${id}` as const)}</td>
                <td>{formatNumber(v.scenarios[id].pe, 2)}</td>
                <td>{money(v.scenarios[id].intrinsicValue)}</td>
                <td>{money(v.scenarios[id].buyLimit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {implied !== null && (
        <p className="graham-implied">{t(implied > GRAHAM_MAX_GROWTH ? 'graham.impliedAbove' : 'graham.implied', { pct: formatNumber(implied, 1) })}</p>
      )}

      <Checklist v={v} />

      <Collapsible title={t('graham.calc.title')} storageKey={CALC_OPEN_KEY}>
        <Calculation v={v} currency={currency} market={market} />
      </Collapsible>
    </div>
  );
}

function Checklist({ v }: { v: GrahamValuation }) {
  const { t } = useT();
  const c = v.checklist;
  const items: { key: DictKey; params?: Record<string, number>; ok: boolean | null }[] = [
    { key: 'graham.check.pe', ok: c.peTtm.ok },
    { key: 'graham.check.grahamNumber', params: { years: c.grahamNumber.yearsUsed }, ok: c.grahamNumber.ok },
    { key: 'graham.check.dividends', ok: c.dividends.ok },
    { key: 'graham.check.debt', ok: c.netDebtBelowMarketCap.ok },
    { key: 'graham.check.loss', ok: c.noLossYear.ok },
  ];
  return (
    <>
      <h4 className="lots-title">{t('graham.check.title')}</h4>
      {items.map((i) => (
        <div className="row" key={i.key}>
          <div className="row-label">{t(i.key, i.params)}</div>
          <div className={`row-value ${i.ok === true ? 'tone-up' : i.ok === false ? 'tone-down' : 'muted'}`}>{i.ok === true ? t('graham.yes') : i.ok === false ? t('graham.no') : t('graham.unknown')}</div>
        </div>
      ))}
    </>
  );
}

function Calculation({ v, currency, market }: { v: GrahamValuation; currency: string | undefined; market: Market }) {
  const { t } = useT();
  const settings = useGrahamSettings();
  const isBist = market === 'BIST';
  const pct = (n: number) => formatNumber(n, 1);
  const country = isBist ? settings.countryRiskBist : 0;
  const usedYears = v.years.slice(-v.yearsUsed);
  const adjustedYears = usedYears.filter((y) => y.adjustedForOneOff);

  return (
    <div className="graham-calc">
      <h4 className="lots-title">{t('graham.calc.s1')}</h4>
      <p className="row-hint">{isBist ? t('graham.calc.s1bist') : t('graham.calc.s1none')}</p>
      <div className="graham-table-wrap">
        <table className="graham-table">
          <thead>
            <tr>
              <th>{t('graham.calc.yearHead')}</th>
              <th>{t('graham.calc.netIncome')}</th>
              <th>{t('graham.calc.used')}</th>
            </tr>
          </thead>
          <tbody>
            {v.years.map((y) => (
              <tr key={y.year} className={usedYears.includes(y) ? '' : 'graham-unused'}>
                <td>{y.year}</td>
                <td>{formatVolume(y.base)}</td>
                <td>
                  {formatVolume(y.adjusted)}
                  {y.adjustedForOneOff && <span className="tag"> {t('graham.calc.adjustedMark')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="lots-title">{t('graham.calc.s2')}</h4>
      <p className="row-hint">{t('graham.calc.s2text')}</p>
      <p>{adjustedYears.length === 0 ? t('graham.calc.s2none') : t('graham.calc.s2years', { years: adjustedYears.map((y) => y.year).join(', ') })}</p>

      <h4 className="lots-title">{t('graham.calc.s3')}</h4>
      <p>
        <b>{t(`graham.type.${v.type}` as const)}</b>
      </p>
      {v.avgGrowth !== null && <p className="row-hint">{t('graham.calc.s3growth', { pct: pct(v.avgGrowth * 100) })}</p>}
      {Number.isFinite(v.coefficientOfVariation) && v.coefficientOfVariation !== null && <p className="row-hint">{t('graham.calc.s3cv', { cv: formatNumber(v.coefficientOfVariation, 2) })}</p>}
      <p className="row-hint">{v.hasBigDecline ? t('graham.calc.declineYes') : t('graham.calc.declineNo')}</p>
      <p className="row-hint">{v.hasLossYear ? t('graham.calc.lossYes') : t('graham.calc.lossNo')}</p>

      <h4 className="lots-title">{t('graham.calc.s4')}</h4>
      <p className="row-hint">{v.type === 'growth' ? t('graham.calc.s4growth') : t('graham.calc.s4avg', { n: v.yearsUsed })}</p>
      {v.type === 'cyclical' && <p className="row-hint">{v.weakYears.length > 0 ? t('graham.calc.weakYears', { years: v.weakYears.join(', ') }) : t('graham.calc.noWeakYear')}</p>}
      {v.cyclicalDiscountApplied && (
        <p className="row-hint">{t('graham.calc.discount', { pct: formatNumber(settings.cyclicalDiscount, 1), before: formatPrice(v.epsBeforeDiscount, currency), after: formatPrice(v.eps, currency) })}</p>
      )}
      <p>{t('graham.calc.s4eps', { eps: formatPrice(v.eps, currency) })}</p>

      <h4 className="lots-title">{t('graham.calc.s5')}</h4>
      <Row label={t('graham.calc.riskFree')} value={`${pct(settings.riskFreeRate)} %`} />
      <Row label={t('graham.calc.erp')} value={`${pct(settings.equityRiskPremium)} %`} />
      <Row label={t('graham.calc.country')} value={`${pct(country)} %`} />
      <Row label={t('graham.calc.companyRisk')} value={`${pct(v.companyRisk)} %`} />
      <Row label={t('graham.calc.required')} value={`${pct(v.requiredReturn)} %`} bold />
      <Row label={t('graham.calc.fairPe')} value={formatNumber(v.scenarios.base.pe, 2)} bold />
      <Row label={t('graham.calc.marketCap')} value={formatVolume(v.marketCap)} />
      <Row label={t('graham.calc.netDebt')} value={`${pct(v.netDebtRatio * 100)} %`} />

      {v.growthScenarios && (
        <>
          <h4 className="lots-title">{t('graham.calc.s6')}</h4>
          <p className="row-hint">{t('graham.calc.s6text', { y: pct(settings.bondYield) })}</p>
          <h5 className="graham-sub">{t('graham.growthTitle')}</h5>
          {v.growthScenarios.map((g) => (
            <Row key={g.growth} label={t('graham.growthRow', { g: g.growth })} value={formatPrice(g.value, currency)} />
          ))}
        </>
      )}

      <h4 className="lots-title">{t('graham.calc.s7')}</h4>
      <p className="row-hint">{t('graham.calc.s7text', { margin: pct(v.safetyMargin), ratio: pct(v.netDebtRatio * 100) })}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="row">
      <div className="row-label">{label}</div>
      <div className="row-value">{bold ? <b>{value}</b> : value}</div>
    </div>
  );
}
