import type { TechnicalSnapshot } from '@aktien/core';
import { formatPercent, formatPrice } from '../lib/format';
import { useT, type DictKey } from '../lib/i18n';

type Tone = 'up' | 'down' | 'flat';
export interface GlanceFact {
  tone: Tone;
  key: DictKey;
  params?: Record<string, string | number>;
}

/** Tagesspanne in Prozent des Kurses, ab der die Schwankung als ruhig bzw. unruhig gilt. */
export const CALM_BELOW = 1.5;
export const WILD_ABOVE = 3.5;

/**
 * Einfache Aussagen zur Lage der Aktie, allein aus den berechneten Kennzahlen (ohne KI). So bleibt die Übersicht auch
 * ohne KI-Schlüssel verständlich. Die Formulierungen stehen im Wörterbuch, hier werden nur Fakten ausgewählt.
 */
export function glanceFacts(s: TechnicalSnapshot, fmt: { percent: (v: number) => string; price: (v: number) => string }): GlanceFact[] {
  const facts: GlanceFact[] = [];

  if (s.trend.state === 'aufwärts') facts.push({ tone: 'up', key: 'glance.trendUp' });
  else if (s.trend.state === 'abwärts') facts.push({ tone: 'down', key: 'glance.trendDown' });
  else if (s.trend.state === 'seitwärts') facts.push({ tone: 'flat', key: 'glance.trendSide' });

  const d200 = s.sma['200'].priceDistancePercent;
  if (d200 !== null && d200 !== undefined) {
    facts.push(d200 >= 0 ? { tone: 'up', key: 'glance.above200', params: { pct: fmt.percent(Math.abs(d200)) } } : { tone: 'down', key: 'glance.below200', params: { pct: fmt.percent(Math.abs(d200)) } });
  }

  const r = s.range52w;
  if (r && !r.partial) {
    const params = { low: fmt.price(r.low), high: fmt.price(r.high), pct: fmt.percent(r.percentBelowHigh), pctLow: fmt.percent(r.percentAboveLow) };
    facts.push(r.percentBelowHigh < 3 ? { tone: 'up', key: 'glance.nearHigh', params } : { tone: 'flat', key: 'glance.range', params });
  }

  const atr = s.atr14.percentOfPrice;
  if (atr !== null && atr !== undefined) {
    const level: DictKey = atr < CALM_BELOW ? 'glance.swingCalm' : atr > WILD_ABOVE ? 'glance.swingWild' : 'glance.swingNormal';
    facts.push({ tone: 'flat', key: 'glance.swing', params: { pct: fmt.percent(atr), levelKey: level } });
  }

  if (s.rsi14.zone === 'überkauft') facts.push({ tone: 'down', key: 'glance.hot' });
  else if (s.rsi14.zone === 'überverkauft') facts.push({ tone: 'up', key: 'glance.cold' });

  return facts;
}

export function Glance({ snapshot, currency }: { snapshot: TechnicalSnapshot; currency?: string }) {
  const { t } = useT();
  const facts = glanceFacts(snapshot, {
    percent: (v) => formatPercent(v, false),
    price: (v) => formatPrice(v, currency),
  });
  if (facts.length === 0) return null;
  return (
    <section className="glance" aria-label={t('glance.title')}>
      <h2 className="section-title">{t('glance.title')}</h2>
      <ul className="glance-list">
        {facts.map((f) => {
          const { levelKey, ...rest } = (f.params ?? {}) as Record<string, string | number>;
          const params = levelKey ? { ...rest, level: t(levelKey as DictKey) } : rest;
          return (
            <li key={f.key} className={`glance-item glance-${f.tone}`}>
              <span className="glance-dot" aria-hidden />
              <span>{t(f.key, params)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
