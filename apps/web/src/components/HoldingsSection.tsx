import type { Market } from '@aktien/core';
import { useState } from 'react';
import { LotForm } from './LotForm';
import { formatDate, formatPrice, formatSignedPrice, formatPercent } from '../lib/format';
import { useT } from '../lib/i18n';
import { positionAvgPrice, positionCurrency, positionGain, positionQuantity, positionValue } from '../lib/portfolio';
import { portfolioStore, usePortfolio, type NewPosition } from '../lib/portfolio-store';

/**
 * "Mein Bestand": zeigt die eigenen Käufe einer Aktie oder eines Fonds direkt auf ihrer Detailseite und erlaubt,
 * neue Käufe einzutragen bzw. einzelne wieder zu entfernen. Rein lokal (kein Server), ergänzt die Watchlist/Merkliste.
 */
export function HoldingsSection({ instrument, currentPrice }: { instrument: NewPosition; currentPrice: number | null | undefined }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const positions = usePortfolio();
  const position = positions.find((p) => p.key === instrument.key.toUpperCase());
  const currency = positionCurrency({ kind: instrument.kind, market: instrument.market as Market | undefined });

  const addLot = (lot: { quantity: number; price: number; date: number }) => {
    portfolioStore.addLot(instrument, lot);
    setAdding(false);
  };

  const quantity = position ? positionQuantity(position) : 0;
  const avgPrice = position ? positionAvgPrice(position) : null;
  const value = position ? positionValue(position, currentPrice) : null;
  const gain = position ? positionGain(position, currentPrice) : null;

  return (
    <section className="group">
      <h3>{t('depot.holdingsTitle')}</h3>
      {!position || position.lots.length === 0 ? (
        <div className="row-hint pad">{t('depot.holdingsEmpty')}</div>
      ) : (
        <>
          <div className="row">
            <div className="row-label">{t('depot.quantity')}</div>
            <div className="row-value">{quantity}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('depot.avgPrice')}</div>
            <div className="row-value">{formatPrice(avgPrice, currency)}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('depot.value')}</div>
            <div className="row-value">{value === null ? <span className="muted">{t('plan.notComputable')}</span> : formatPrice(value, currency)}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('depot.gain')}</div>
            <div className={`row-value ${gain && gain.amount >= 0 ? 'tone-up' : gain ? 'tone-down' : ''}`}>
              {gain === null ? (
                <span className="muted">{t('plan.notComputable')}</span>
              ) : (
                <>
                  {formatSignedPrice(gain.amount, currency)}
                  {gain.percent !== null && <div className="row-hint">{formatPercent(gain.percent)}</div>}
                </>
              )}
            </div>
          </div>

          <h4 className="lots-title">{t('depot.lotsTitle')}</h4>
          <ul className="lots-list">
            {[...position.lots].sort((a, b) => b.date - a.date).map((lot) => (
              <li key={lot.id} className="lots-row">
                <span>{formatDate(lot.date)}</span>
                <span>
                  {lot.quantity} × {formatPrice(lot.price, currency)}
                </span>
                <button type="button" className="delete-btn" aria-label={t('depot.removeLotAria', { date: formatDate(lot.date) })} onClick={() => portfolioStore.removeLot(instrument.key, lot.id)}>
                  −
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {adding ? (
        <LotForm currency={currency} onSubmit={addLot} onCancel={() => setAdding(false)} />
      ) : (
        <div className="stack">
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
            {t('depot.addBtn')}
          </button>
        </div>
      )}
    </section>
  );
}
