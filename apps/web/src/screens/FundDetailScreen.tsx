import { convertCandles, type FundPeriod } from '@aktien/core';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { HoldingsSection } from '../components/HoldingsSection';
import { ChangePill, ErrorNote, Segmented, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { FX_SYMBOL, periodStats, type ChartCurrency } from '../lib/chart-model';
import { buildFundChartData, FUND_TZ, fundCandles } from '../lib/fund-chart';
import { formatCount, formatDate, formatPercent, formatPrice } from '../lib/format';
import { useFund, useFundBenchmark, useFundHistory, useHistory } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { fundStore, useFundWatchlist } from '../lib/funds-store';

const PERIODS: readonly FundPeriod[] = ['week', 'month', '3month', '6month', 'ytd', 'year', '3year', '5year'];
const CURRENCIES: readonly ChartCurrency[] = ['TRY', 'USD', 'EUR'];

/** YYYY-MM-DD (Istanbuler Kalendertag von TEFAS) → Unix-Millisekunden, für die lokale Datumsformatierung. */
function dateMs(isoDate: string): number {
  return Date.parse(`${isoDate}T12:00:00Z`);
}

export function FundDetailScreen() {
  const { t, dynamic } = useT();
  const { code: raw = '' } = useParams();
  const code = decodeURIComponent(raw).toUpperCase();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<FundPeriod>('6month');
  const [currency, setCurrency] = useState<ChartCurrency>('TRY');

  const funds = useFundWatchlist();
  const item = funds.find((f) => f.code === code);

  const info = useFund(code);
  const history = useFundHistory(code, period);
  const benchmark = useFundBenchmark(code, period);

  // Fonds sind immer in Lira notiert; für den Chart wird bei Bedarf mit dem Tageskurs umgerechnet (wie beim Aktienchart).
  const needsFx = currency !== 'TRY';
  const fx = useHistory(currency === 'EUR' ? FX_SYMBOL.EUR : FX_SYMBOL.USD, needsFx);

  const rawCandles = useMemo(() => (history.data ? fundCandles(history.data) : undefined), [history.data]);
  const candles = useMemo(() => {
    if (!rawCandles) return undefined;
    if (!needsFx) return rawCandles;
    return fx.data ? convertCandles(rawCandles, fx.data.candles, FUND_TZ) : undefined;
  }, [rawCandles, needsFx, fx.data]);
  const data = candles ? buildFundChartData(candles) : undefined;
  const stats = data ? periodStats(data.candles) : null;
  const periodOptions = useMemo(() => PERIODS.map((p) => ({ value: p, label: t(`fund.p.${p}` as const) })), [t]);

  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    return (
      <main className="screen">
        <ErrorNote message={t('error.fundNotFound')} />
        <Link to="/" className="btn">
          {t('common.toList')}
        </Link>
      </main>
    );
  }

  const name = item?.name ?? info.data?.name;

  return (
    <main className="screen">
      <div className="nav-bar">
        <button type="button" className="link-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          {t('common.back')}
        </button>
        <button type="button" className="link-btn" aria-pressed={Boolean(item)} onClick={() => (item ? fundStore.remove(code) : fundStore.add(code, name))}>
          {item ? t('detail.inList') : t('detail.addToList')}
        </button>
      </div>

      <header className="detail-head">
        <h1>{name ?? code}</h1>
        <div className="muted">
          {code} <span className="tag">{info.data?.category ?? t('fund.noCategory')}</span>
        </div>
        {info.isPending ? (
          <Spinner />
        ) : info.isError ? (
          <ErrorNote message={info.error instanceof ApiError && info.error.code === 'NOT_FOUND' ? t('error.fundNotFound') : undefined} error={info.error instanceof ApiError && info.error.code === 'NOT_FOUND' ? undefined : info.error} onRetry={() => info.refetch()} />
        ) : (
          info.data && (
            <div className="price-block">
              <div className="price">{formatPrice(info.data.price, 'TRY')}</div>
              <ChangePill percent={info.data.dailyChangePercent} />
              <div className="quote-meta">
                <span className="muted">{t('fund.asOf', { date: formatDate(dateMs(info.data.asOf)) })}</span>
              </div>
              <p className="row-hint pad">{t('fund.freshness')}</p>
              <div className="range-grid">
                {info.data.categoryRank !== null && info.data.categoryFundCount !== null && (
                  <div>
                    <span className="muted">{t('fund.rank')}</span>
                    <b>{t('fund.rankValue', { rank: info.data.categoryRank, count: info.data.categoryFundCount })}</b>
                  </div>
                )}
                {info.data.investorCount !== null && (
                  <div>
                    <span className="muted">{t('fund.investors')}</span>
                    <b>{formatCount(info.data.investorCount)}</b>
                  </div>
                )}
                {info.data.marketSharePercent !== null && (
                  <div>
                    <span className="muted">{t('fund.marketShare')}</span>
                    <b>{formatPercent(info.data.marketSharePercent, false)}</b>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </header>

      <Segmented options={periodOptions} value={period} label={t('chart.period')} onChange={setPeriod} />
      <div className="currency-switch">
        <span className="muted">{t('chart.currency')}:</span>
        <Segmented options={CURRENCIES.map((value) => ({ value, label: t(`cur.${value}` as const) }))} value={currency} label={t('chart.currency')} onChange={setCurrency} />
      </div>

      <div className="chart-wrap">
        {needsFx && fx.isError ? (
          <ErrorNote error={fx.error} onRetry={() => fx.refetch()} />
        ) : history.isPending || (needsFx && fx.isPending) ? (
          <Spinner label={t('chart.loading')} />
        ) : history.isError ? (
          <ErrorNote error={history.error} onRetry={() => history.refetch()} />
        ) : data && data.candles.length > 0 ? (
          <Chart data={data} mode="line" intraday={false} overlays={{ sma20: false, sma50: false, sma200: false, bollinger: false }} showVolume={false} showRsi={false} showMacd={false} onLegend={() => {}} />
        ) : (
          <div className="center-note">{t('chart.noData')}</div>
        )}
      </div>

      {stats && (
        <div className="range-grid stats-grid">
          <div>
            <span className="muted">{t('chart.change')}</span>
            <b className={`tone-${stats.changePercent && stats.changePercent < 0 ? 'down' : 'up'}`}>{formatPercent(stats.changePercent)}</b>
          </div>
          <div>
            <span className="muted">{t('chart.high')}</span>
            <b>{formatPrice(stats.high, currency)}</b>
          </div>
          <div>
            <span className="muted">{t('chart.low')}</span>
            <b>{formatPrice(stats.low, currency)}</b>
          </div>
        </div>
      )}
      {needsFx && <p className="row-hint pad">{t('chart.currencyNote', { currency })}</p>}

      <section className="group">
        <h3>{t('fund.benchmarkTitle')}</h3>
        <p className="row-hint pad">{t('fund.benchmarkText')}</p>
        {benchmark.isPending ? (
          <Spinner label={t('chart.loading')} />
        ) : benchmark.isError ? (
          <ErrorNote error={benchmark.error} onRetry={() => benchmark.refetch()} />
        ) : (benchmark.data ?? []).length === 0 ? (
          <div className="row-hint pad">{t('chart.noData')}</div>
        ) : (
          (benchmark.data ?? []).map((p) => (
            <div className="row" key={`${p.kind}:${p.label}`}>
              <div className="row-label">{p.kind === 'category' ? p.label : dynamic(`fund.kind.${p.kind}`, p.label)}</div>
              <div className={`row-value ${p.returnPercent >= 0 ? 'tone-up' : 'tone-down'}`}>{formatPercent(p.returnPercent)}</div>
            </div>
          ))
        )}
      </section>

      <HoldingsSection instrument={{ kind: 'fund', key: code, symbol: code, name }} currentPrice={info.data?.price ?? null} />

      <p className="disclaimer">{t('fund.disclaimer')}</p>
    </main>
  );
}
