import type { TechnicalSnapshot, Zone } from '@aktien/core';
import type { ReactNode } from 'react';
import { formatDate, formatNumber, formatPercent, formatVolume } from '../lib/format';
import { useT } from '../lib/i18n';

function Row({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'up' | 'down'; hint?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {hint && <div className="row-hint">{hint}</div>}
      </div>
      <div className={`row-value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
    </div>
  );
}

const tone = (v: number | null | undefined): 'up' | 'down' | undefined => (v === null || v === undefined || v === 0 ? undefined : v > 0 ? 'up' : 'down');

function ZoneRow({ zone, price }: { zone: Zone; price: number }) {
  const { t } = useT();
  const inside = price >= zone.low && price <= zone.high;
  const kind = inside ? 'I' : zone.id.startsWith('R') ? 'R' : 'S';
  return (
    <Row
      label={t(`level.${kind}` as const, { id: zone.id })}
      hint={zone.touches === 1 ? t('tech.touch1') : t('tech.touches', { n: zone.touches })}
      value={
        <>
          {formatNumber(zone.low)} – {formatNumber(zone.high)}
          <div className="row-hint">{formatPercent(zone.distancePercent)}</div>
        </>
      }
    />
  );
}

/** Kennzahlen für Fortgeschrittene. Jede Zeile trägt eine kurze Erklärung in einfacher Sprache. */
export function TechPanel({ snapshot: s }: { snapshot: TechnicalSnapshot }) {
  const { t, dynamic, msg } = useT();
  const cross = s.crossSma50Sma200;
  const macd = s.macd.state;
  const ma = (n: '20' | '50' | '200') => (
    <Row
      key={n}
      label={t('tech.averageRow', { n })}
      value={
        <>
          {formatNumber(s.sma[n].value)} / {formatNumber(s.ema[n].value)}
          <div className={`row-hint ${tone(s.sma[n].priceDistancePercent) ? `tone-${tone(s.sma[n].priceDistancePercent)}` : ''}`}>
            {t('tech.averageHint', { pct: formatPercent(s.sma[n].priceDistancePercent) })}
          </div>
        </>
      }
    />
  );

  return (
    <div className="tech">
      {s.warnings.length > 0 && (
        <div className="warn-note" role="note">
          <strong>{t('tech.dataHint')}:</strong>
          <ul>
            {s.warnings.map((w) => {
              const text = msg(w);
              return <li key={text}>{text}</li>;
            })}
          </ul>
        </div>
      )}

      <section className="group">
        <h3>{t('tech.trend')}</h3>
        <Row
          label={t('tech.trendStructure')}
          hint={t('tech.trendStructureHint', { highs: s.trend.highs.join(' ') || '–', lows: s.trend.lows.join(' ') || '–' })}
          value={dynamic(`trend.${s.trend.state}`, s.trend.state)}
          tone={s.trend.state === 'aufwärts' ? 'up' : s.trend.state === 'abwärts' ? 'down' : undefined}
        />
        <Row
          label={t('tech.smaCross')}
          value={cross.regime === 'golden' ? t('tech.smaCrossAbove') : cross.regime === 'death' ? t('tech.smaCrossBelow') : dynamic('trend.unbekannt', '–')}
          tone={cross.regime === 'golden' ? 'up' : cross.regime === 'death' ? 'down' : undefined}
          hint={
            cross.lastCross
              ? t(cross.lastCross.type === 'golden' ? 'tech.golden' : 'tech.death', { date: formatDate(cross.lastCross.time * 1000), bars: cross.lastCross.barsAgo })
              : t('tech.noCross')
          }
        />
      </section>

      <section className="group">
        <h3>{t('tech.averages')}</h3>
        <p className="row-hint pad">{t('hint.sma')}</p>
        {ma('20')}
        {ma('50')}
        {ma('200')}
      </section>

      <section className="group">
        <h3>{t('tech.momentum')}</h3>
        <Row label="RSI (14)" value={formatNumber(s.rsi14.value, 1)} hint={`${dynamic(`zone.${s.rsi14.zone}`, s.rsi14.zone)}. ${t('hint.rsi')}`} tone={s.rsi14.zone === 'überverkauft' ? 'up' : s.rsi14.zone === 'überkauft' ? 'down' : undefined} />
        <Row
          label="MACD (12/26/9)"
          value={dynamic(`macd.${macd.position}`, macd.position)}
          tone={macd.position === 'über Signal' ? 'up' : macd.position === 'unter Signal' ? 'down' : undefined}
          hint={
            <>
              {macd.lastCross ? `${t(macd.lastCross.type === 'bullish' ? 'tech.macdBullCross' : 'tech.macdBearCross', { bars: macd.lastCross.barsAgo })} · ` : ''}
              {t('tech.histogram', { value: formatNumber(s.macd.histogram) })}
              <div>{t('hint.macd')}</div>
            </>
          }
        />
      </section>

      <section className="group">
        <h3>{t('tech.volatility')}</h3>
        <Row
          label="Bollinger (20, 2)"
          value={`${formatNumber(s.bollinger.lower)} – ${formatNumber(s.bollinger.upper)}`}
          hint={
            <>
              {t('tech.bollingerHint', { pb: formatNumber(s.bollinger.percentB, 2), bw: formatPercent(s.bollinger.bandwidthPercent, false) })}
              <div>{t('hint.bollinger')}</div>
            </>
          }
        />
        <Row
          label="ATR (14)"
          value={formatNumber(s.atr14.value)}
          hint={
            <>
              {t('tech.atrHint', { pct: formatPercent(s.atr14.percentOfPrice, false) })}
              <div>{t('hint.atr')}</div>
            </>
          }
        />
      </section>

      <section className="group">
        <h3>{t('tech.volumeTitle')}</h3>
        <Row label={t('tech.volumeTrend')} value={dynamic(`vol.${s.volume.label}`, s.volume.label)} hint={t('tech.volumeAvg', { a: formatVolume(s.volume.avg20), b: formatVolume(s.volume.avg50) })} />
        <Row label={t('tech.upDown')} value={s.volume.upDownVolumeRatio === null ? '–' : formatNumber(s.volume.upDownVolumeRatio, 2)} hint={t('tech.upDownHint')} />
      </section>

      <section className="group">
        <h3>{t('tech.levels')}</h3>
        {s.levels.resistances.length === 0 && s.levels.supports.length === 0 && s.levels.inside.length === 0 && <div className="row-hint pad">{t('tech.noLevels')}</div>}
        {[...s.levels.resistances].reverse().map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
        {s.levels.resistances.length === 0 && (
          <div className="row-hint pad">
            {t('tech.noResistance')}{' '}
            {s.range52w && s.range52w.percentBelowHigh > 0.5 ? t('tech.nextObstacle', { high: formatNumber(s.range52w.high) }) : t('tech.nearHigh')}
          </div>
        )}
        {s.levels.inside.map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
        {s.levels.supports.map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
      </section>

      {s.range52w && (
        <section className="group">
          <h3>{s.range52w.partial ? t('tech.range52Partial', { bars: s.range52w.bars }) : t('tech.range52')}</h3>
          <Row label={t('tech.high52')} value={formatNumber(s.range52w.high)} hint={t('tech.belowHigh', { pct: formatPercent(s.range52w.percentBelowHigh, false) })} />
          <Row label={t('tech.low52')} value={formatNumber(s.range52w.low)} hint={t('tech.aboveLow', { pct: formatPercent(s.range52w.percentAboveLow, false) })} />
        </section>
      )}

      <p className="row-hint pad">{t('tech.footer')}</p>
    </div>
  );
}
