import type { FxPerformance, Market, TechnicalSnapshot, Zone } from '@aktien/core';
import type { ReactNode } from 'react';
import { formatDate, formatNumber, formatPercent, formatVolume } from '../lib/format';

function Row({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'up' | 'down'; hint?: string }) {
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
  const inside = price >= zone.low && price <= zone.high;
  return (
    <Row
      label={`${zone.id}${inside ? ' (Kurs in Zone)' : ''}`}
      hint={`${zone.touches} Berührung${zone.touches === 1 ? '' : 'en'}`}
      value={
        <>
          {formatNumber(zone.low)} – {formatNumber(zone.high)}
          <div className="row-hint">{formatPercent(zone.distancePercent)}</div>
        </>
      }
    />
  );
}

export function TechPanel({ snapshot: s, market, fx = [] }: { snapshot: TechnicalSnapshot; market: Market; fx?: FxPerformance[] }) {
  const cross = s.crossSma50Sma200;
  const macd = s.macd.state;
  const ma = (n: '20' | '50' | '200') => (
    <Row
      key={n}
      label={`SMA ${n} / EMA ${n}`}
      value={
        <>
          {formatNumber(s.sma[n].value)} / {formatNumber(s.ema[n].value)}
          <div className={`row-hint ${tone(s.sma[n].priceDistancePercent) ? `tone-${tone(s.sma[n].priceDistancePercent)}` : ''}`}>
            Kurs {formatPercent(s.sma[n].priceDistancePercent)} zum SMA
          </div>
        </>
      }
    />
  );

  return (
    <div className="tech">
      {s.warnings.length > 0 && (
        <div className="warn-note" role="note">
          <strong>Datenhinweis:</strong>
          <ul>
            {s.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="group">
        <h3>Trend</h3>
        <Row
          label="Trendstruktur"
          hint={`Swing-Hochs: ${s.trend.highs.join(' ') || '–'} · Tiefs: ${s.trend.lows.join(' ') || '–'}`}
          value={s.trend.state}
          tone={s.trend.state === 'aufwärts' ? 'up' : s.trend.state === 'abwärts' ? 'down' : undefined}
        />
        <Row
          label="SMA 50 vs. SMA 200"
          value={cross.regime === 'golden' ? 'SMA 50 über SMA 200' : cross.regime === 'death' ? 'SMA 50 unter SMA 200' : 'unbekannt'}
          tone={cross.regime === 'golden' ? 'up' : cross.regime === 'death' ? 'down' : undefined}
          hint={
            cross.lastCross
              ? `${cross.lastCross.type === 'golden' ? 'Golden' : 'Death'} Cross am ${formatDate(cross.lastCross.time * 1000)} (vor ${cross.lastCross.barsAgo} Kerzen)`
              : 'Kein Kreuz im Datenzeitraum'
          }
        />
      </section>

      <section className="group">
        <h3>Gleitende Durchschnitte</h3>
        {ma('20')}
        {ma('50')}
        {ma('200')}
      </section>

      <section className="group">
        <h3>Momentum</h3>
        <Row label="RSI (14)" value={formatNumber(s.rsi14.value, 1)} hint={s.rsi14.zone} tone={s.rsi14.zone === 'überverkauft' ? 'up' : s.rsi14.zone === 'überkauft' ? 'down' : undefined} />
        <Row
          label="MACD (12/26/9)"
          value={macd.position}
          tone={macd.position === 'über Signal' ? 'up' : macd.position === 'unter Signal' ? 'down' : undefined}
          hint={
            macd.lastCross
              ? `${macd.lastCross.type === 'bullish' ? 'Bullisches' : 'Bärisches'} Kreuz vor ${macd.lastCross.barsAgo} Kerzen · Histogramm ${formatNumber(s.macd.histogram)}`
              : `Histogramm ${formatNumber(s.macd.histogram)}`
          }
        />
      </section>

      <section className="group">
        <h3>Volatilität</h3>
        <Row label="Bollinger-Bänder (20, 2)" value={`${formatNumber(s.bollinger.lower)} – ${formatNumber(s.bollinger.upper)}`} hint={`%B ${formatNumber(s.bollinger.percentB, 2)} · Bandbreite ${formatPercent(s.bollinger.bandwidthPercent, false)}`} />
        <Row label="ATR (14)" value={formatNumber(s.atr14.value)} hint={`${formatPercent(s.atr14.percentOfPrice, false)} vom Kurs (durchschnittliche Tagesspanne)`} />
      </section>

      <section className="group">
        <h3>Volumen</h3>
        <Row label="Volumentrend" value={s.volume.label} hint={`Ø20 ${formatVolume(s.volume.avg20)} · Ø50 ${formatVolume(s.volume.avg50)}`} />
        <Row label="Aufwärts-/Abwärtsvolumen (20 Tage)" value={s.volume.upDownVolumeRatio === null ? '–' : formatNumber(s.volume.upDownVolumeRatio, 2)} hint="Über 1: mehr Handel an Kurstagen im Plus" />
      </section>

      <section className="group">
        <h3>Unterstützung &amp; Widerstand</h3>
        {s.levels.resistances.length === 0 && s.levels.supports.length === 0 && s.levels.inside.length === 0 && <div className="row-hint pad">Keine belastbaren Zonen gefunden.</div>}
        {[...s.levels.resistances].reverse().map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
        {s.levels.resistances.length === 0 && <div className="row-hint pad">Kein Widerstand über dem Kurs (Kurs nahe Hoch im Datenzeitraum).</div>}
        {s.levels.inside.map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
        {s.levels.supports.map((z) => (
          <ZoneRow key={z.id} zone={z} price={s.price} />
        ))}
      </section>

      {s.range52w && (
        <section className="group">
          <h3>52-Wochen-Spanne{s.range52w.partial ? ` (nur ${s.range52w.bars} Kerzen)` : ''}</h3>
          <Row label="52W-Hoch" value={formatNumber(s.range52w.high)} hint={`Kurs ${formatPercent(s.range52w.percentBelowHigh, false)} darunter`} />
          <Row label="52W-Tief" value={formatNumber(s.range52w.low)} hint={`Kurs ${formatPercent(s.range52w.percentAboveLow, false)} darüber`} />
        </section>
      )}

      {market === 'BIST' && fx.length > 0 && (
        <section className="group">
          <h3>Entwicklung in TRY und Fremdwährung</h3>
          {fx[0]!.periods.map((p, i) => (
            <div className="row" key={p.label}>
              <div className="row-label">
                {p.label}
                <div className="row-hint">
                  Lira {p.fxPercent >= 0 ? 'schwächer' : 'stärker'} um {formatPercent(Math.abs(p.fxPercent), false)} zum {fx[0]!.currency}
                </div>
              </div>
              <div className="row-value">
                <span className={p.localPercent >= 0 ? 'tone-up' : 'tone-down'}>{formatPercent(p.localPercent)} TRY</span>
                {fx.map((f) => {
                  const v = f.periods[i]?.foreignPercent;
                  return v === undefined ? null : (
                    <div key={f.currency} className={`row-hint ${v >= 0 ? 'tone-up' : 'tone-down'}`}>
                      {formatPercent(v)} {f.currency}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
      {market === 'BIST' && (
        <div className="info-note" role="note">
          <strong>Inflation beachten:</strong> Die türkische Lira verliert seit Jahren stark an Wert. Kursgewinne in TRY sind daher nominal und überzeichnen die reale
          Entwicklung. Der Vergleich oben zeigt dieselbe Kursentwicklung in USD und EUR (Umrechnung mit dem Tageskurs). Im Chart lässt sich die Währung umschalten.
        </div>
      )}
      <p className="row-hint pad">Alle Kennzahlen werden im Code aus Tageskerzen berechnet, nicht von einer KI geschätzt. Die letzte Kerze kann während der Börsenzeit unvollständig sein.</p>
    </div>
  );
}
