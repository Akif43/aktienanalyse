import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { formatPercent, formatPrice, formatSignedPrice } from '../lib/format';
import { usePortfolioPrices } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { positionAvgPrice, positionCurrency, positionGain, positionQuantity, portfolioTotals } from '../lib/portfolio';
import { portfolioStore, usePortfolio, type PortfolioPosition } from '../lib/portfolio-store';

export function PortfolioScreen() {
  const { t } = useT();
  const positions = usePortfolio();
  const { priceByKey, fx, isPending } = usePortfolioPrices(positions);
  const [editing, setEditing] = useState(false);
  const totals = useMemo(() => portfolioTotals(positions, priceByKey, fx), [positions, priceByKey, fx]);
  const usesFx = positions.some((p) => positionCurrency(p) !== 'TRY');

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('depot.title')}</h1>
        <div className="header-actions">
          {positions.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setEditing((e) => !e)}>
              {editing ? t('watch.done') : t('watch.edit')}
            </button>
          )}
          <Link to="/depot/neu" className="icon-btn" aria-label={t('depot.addBtn')}>
            +
          </Link>
        </div>
      </header>

      {positions.length === 0 ? (
        <section className="empty">
          <p className="empty-title">{t('depot.empty')}</p>
          <p className="muted">{t('depot.emptyText')}</p>
          <div className="stack">
            <Link to="/depot/neu" className="btn">
              {t('depot.addBtn')}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="verdict-card">
            <div className="row">
              <div className="row-label">{t('depot.value')}</div>
              <div className="row-value">{isPending ? <Spinner /> : formatPrice(totals.valueTRY, 'TRY')}</div>
            </div>
            <div className="row">
              <div className="row-label">{t('depot.cost')}</div>
              <div className="row-value">{formatPrice(totals.costTRY, 'TRY')}</div>
            </div>
            <div className="row">
              <div className="row-label">{t('depot.gain')}</div>
              <div className={`row-value ${totals.gainTRY >= 0 ? 'tone-up' : 'tone-down'}`}>
                {formatSignedPrice(totals.gainTRY, 'TRY')}
                {totals.gainPercent !== null && <div className="row-hint">{formatPercent(totals.gainPercent)}</div>}
              </div>
            </div>
          </section>
          {totals.incomplete && <p className="row-hint pad">{t('depot.incompleteNote')}</p>}
          {usesFx && <p className="row-hint pad">{t('depot.convertedNote')}</p>}

          <ul className="list" aria-label={t('depot.list')}>
            {positions.map((p) => (
              <PositionRow key={p.key} position={p} currentPrice={priceByKey.get(p.key)} editing={editing} />
            ))}
          </ul>

          <p className="disclaimer small">{t('depot.disclaimer')}</p>
        </>
      )}
    </main>
  );
}

function PositionRow({ position, currentPrice, editing }: { position: PortfolioPosition; currentPrice: number | null | undefined; editing: boolean }) {
  const { t } = useT();
  const currency = positionCurrency(position);
  const quantity = positionQuantity(position);
  const avgPrice = positionAvgPrice(position);
  const gain = positionGain(position, currentPrice);
  const to = position.kind === 'stock' ? `/s/${encodeURIComponent(position.key)}` : `/f/${encodeURIComponent(position.key)}`;

  return (
    <li className="watch-row">
      {editing && (
        <button type="button" className="delete-btn" aria-label={t('depot.removeAria', { symbol: position.symbol })} onClick={() => portfolioStore.removePosition(position.key)}>
          −
        </button>
      )}
      <Link to={to} className="watch-link">
        <div className="watch-left">
          <div className="watch-symbol">{position.name ?? position.symbol}</div>
          <div className="watch-name">
            {position.symbol} <span className="tag">{t('depot.quantity')}: {quantity}</span>
          </div>
          <div className="row-hint">{t('depot.avgPrice')}: {formatPrice(avgPrice, currency)}</div>
        </div>
        <div className="watch-right">
          {currentPrice === undefined ? (
            <div className="skeleton" aria-label={t('watch.loadingAria')} />
          ) : currentPrice === null || gain === null ? (
            <div className="watch-error">{t('watch.unavailable')}</div>
          ) : (
            <>
              <div className="watch-price">{formatPrice(currentPrice, currency)}</div>
              <span className={`pill pill-${gain.amount >= 0 ? 'up' : 'down'}`}>{formatSignedPrice(gain.amount, currency)}</span>
              {gain.percent !== null && <div className="watch-fresh">{formatPercent(gain.percent)}</div>}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}
