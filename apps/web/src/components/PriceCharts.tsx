import type { FxPerformance, Market, Timeframe } from '@aktien/core';
import { useMemo, useState } from 'react';
import { periodStats, TIMEFRAMES, useChartModel, type ChartCurrency } from '../lib/chart-model';
import { direction, formatNumber, formatPercent, formatPrice, formatVolume } from '../lib/format';
import { useT } from '../lib/i18n';
import { Chart, type ChartOverlays, type LegendValue } from './Chart';
import { Chip, ErrorNote, Segmented, Spinner } from './ui';

const CURRENCIES: readonly ChartCurrency[] = ['TRY', 'USD', 'EUR'];

function useTimeframeOptions() {
  const { t } = useT();
  return useMemo(() => TIMEFRAMES.map((value) => ({ value, label: t(`tf.${value}` as const) })), [t]);
}

/** Einfacher Kursverlauf mit klaren Zeiträumen und drei Kennzahlen darunter. Für die Einsteiger-Ansicht. */
export function SimpleChart({ ticker, market, currencyLabel }: { ticker: string; market: Market; currencyLabel?: string }) {
  const { t } = useT();
  const [tf, setTf] = useState<Timeframe>('6M');
  const [currency, setCurrency] = useState<ChartCurrency>('TRY');
  const { series, fx, data } = useChartModel(ticker, market, tf, currency);
  const options = useTimeframeOptions();
  const stats = data ? periodStats(data.candles) : null;
  const shownCurrency = currency === 'TRY' ? currencyLabel : currency;
  const dir = direction(stats?.changePercent);

  return (
    <section className="simple-chart">
      <Segmented options={options} value={tf} label={t('chart.period')} onChange={setTf} />
      {market === 'BIST' && (
        <div className="currency-switch">
          <span className="muted">{t('chart.currency')}:</span>
          <Segmented options={CURRENCIES.map((value) => ({ value, label: t(`cur.${value}` as const) }))} value={currency} label={t('chart.currency')} onChange={setCurrency} />
        </div>
      )}

      <div className="chart-wrap">
        {fx?.isError ? (
          <ErrorNote error={fx.error} onRetry={() => fx.refetch()} />
        ) : series.isPending || fx?.isPending ? (
          <Spinner label={t('chart.loading')} />
        ) : series.isError && !series.data ? (
          <ErrorNote error={series.error} onRetry={() => series.refetch()} />
        ) : data && data.candles.length > 0 ? (
          <Chart data={data} mode="line" intraday={tf === '1T' || tf === '1W' || tf === '1M'} overlays={{ sma20: false, sma50: false, sma200: false, bollinger: false }} showVolume={false} showRsi={false} showMacd={false} onLegend={() => {}} />
        ) : (
          <div className="center-note">{t('chart.noData')}</div>
        )}
      </div>

      {stats && (
        <div className="range-grid stats-grid">
          <div>
            <span className="muted">{t('chart.change')}</span>
            <b className={`tone-${dir === 'flat' ? 'flat' : dir}`}>{formatPercent(stats.changePercent)}</b>
          </div>
          <div>
            <span className="muted">{t('chart.high')}</span>
            <b>{formatPrice(stats.high, shownCurrency)}</b>
          </div>
          <div>
            <span className="muted">{t('chart.low')}</span>
            <b>{formatPrice(stats.low, shownCurrency)}</b>
          </div>
        </div>
      )}
      {currency !== 'TRY' && <p className="row-hint pad">{t('chart.currencyNote', { currency })}</p>}
    </section>
  );
}

/** Kerzenchart mit Linien (Durchschnitte, Bollinger) und Unterfenstern (RSI, MACD). Nur im Bereich für Fortgeschrittene. */
export function CandleSection({ ticker, market }: { ticker: string; market: Market }) {
  const { t } = useT();
  const [tf, setTf] = useState<Timeframe>('6M');
  const [overlays, setOverlays] = useState<ChartOverlays>({ sma20: true, sma50: true, sma200: true, bollinger: false });
  const [volume, setVolume] = useState(true);
  const [rsi, setRsi] = useState(false);
  const [macd, setMacd] = useState(false);
  const [legend, setLegend] = useState<LegendValue | null>(null);
  const { series, data, daily, intraday } = useChartModel(ticker, market, tf, 'TRY');
  const options = useTimeframeOptions();

  const toggle = (key: keyof ChartOverlays) => setOverlays((o) => ({ ...o, [key]: !o[key] }));
  const last = data?.candles.at(-1);
  const shown = legend ?? (last ? { ...last, volume: data?.volume.at(-1)?.value } : null);

  return (
    <section>
      <h3 className="sub-title">{t('adv.candles')}</h3>
      <p className="row-hint">{t('adv.candlesHelp')}</p>
      <Segmented options={options} value={tf} label={t('chart.period')} onChange={setTf} />
      {shown && (
        <div className="legend" aria-live="off">
          <span>{t('legend.open')} {formatNumber(shown.open)}</span>
          <span>{t('legend.high')} {formatNumber(shown.high)}</span>
          <span>{t('legend.low')} {formatNumber(shown.low)}</span>
          <span>{t('legend.close')} {formatNumber(shown.close)}</span>
          {shown.volume !== undefined && <span>{t('legend.volume')} {formatVolume(shown.volume)}</span>}
        </div>
      )}
      <div className="chart-wrap">
        {series.isPending ? (
          <Spinner label={t('chart.loading')} />
        ) : series.isError && !series.data ? (
          <ErrorNote error={series.error} onRetry={() => series.refetch()} />
        ) : data && data.candles.length > 0 ? (
          <Chart data={data} mode="candles" intraday={intraday} overlays={overlays} showVolume={volume} showRsi={rsi} showMacd={macd} onLegend={setLegend} />
        ) : (
          <div className="center-note">{t('chart.noData')}</div>
        )}
      </div>
      {series.data && (
        <p className="row-hint pad">
          {t('adv.source', { source: series.data.source, approx: series.data.approximate ? t('adv.approx') : '', interval: series.data.interval })}
          {series.data.droppedBars > 0 ? t('adv.dropped', { count: series.data.droppedBars }) : ''}
        </p>
      )}

      <div className="chips" aria-label={t('adv.indicators')}>
        <Chip active={overlays.sma20 && daily} disabled={!daily} onClick={() => toggle('sma20')} color="var(--c-sma20)">
          SMA 20
        </Chip>
        <Chip active={overlays.sma50 && daily} disabled={!daily} onClick={() => toggle('sma50')} color="var(--c-sma50)">
          SMA 50
        </Chip>
        <Chip active={overlays.sma200 && daily} disabled={!daily} onClick={() => toggle('sma200')} color="var(--c-sma200)">
          SMA 200
        </Chip>
        <Chip active={overlays.bollinger && daily} disabled={!daily} onClick={() => toggle('bollinger')} color="var(--c-bb)">
          Bollinger
        </Chip>
        <Chip active={rsi && daily} disabled={!daily} onClick={() => setRsi((v) => !v)}>
          RSI
        </Chip>
        <Chip active={macd && daily} disabled={!daily} onClick={() => setMacd((v) => !v)}>
          MACD
        </Chip>
        <Chip active={volume} onClick={() => setVolume((v) => !v)}>
          {t('chip.volume')}
        </Chip>
      </div>
      {!daily && <p className="row-hint pad">{t('adv.dailyOnly')}</p>}
    </section>
  );
}

/** Lira-Effekt: dieselbe Kursentwicklung in Lira und in Dollar/Euro, in einfachen Worten. */
export function FxEffect({ fx }: { fx: FxPerformance[] }) {
  const { t, dynamic } = useT();
  if (fx.length === 0) return null;
  const main = fx[0]!;
  return (
    <section className="group fx-effect">
      <h3>{t('fx.title')}</h3>
      <p className="row-hint pad">{t('fx.text')}</p>
      {main.periods.map((p, i) => (
        <div className="fx-period" key={p.label}>
          <div className="fx-title">{dynamic(`fx.period.${p.label}`, p.label)}</div>
          <div className="fx-values">
            <div>
              <span className="muted">{t('fx.lira')}</span>
              <b className={p.localPercent >= 0 ? 'tone-up' : 'tone-down'}>{formatPercent(p.localPercent)}</b>
            </div>
            {fx.map((f) => {
              const v = f.periods[i]?.foreignPercent;
              return v === undefined ? null : (
                <div key={f.currency}>
                  <span className="muted">{dynamic(`fx.in${f.currency}`, f.currency)}</span>
                  <b className={v >= 0 ? 'tone-up' : 'tone-down'}>{formatPercent(v)}</b>
                </div>
              );
            })}
          </div>
          <div className="row-hint">
            {t(p.fxPercent >= 0 ? 'fx.weaker' : 'fx.stronger', { currency: dynamic(`fx.${main.currency}`, main.currency), pct: formatPercent(Math.abs(p.fxPercent), false) })}
          </div>
        </div>
      ))}
    </section>
  );
}
