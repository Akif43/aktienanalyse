import { useState } from 'react';
import { Link } from 'react-router-dom';
import { marketState } from '@aktien/core';
import { ChangePill, ErrorNote, Spinner } from '../components/ui';
import { formatAsOf, formatPrice, formatTime, freshnessText, marketName } from '../lib/format';
import { useQuotes } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { EXAMPLE_TICKERS, useWatchlist, watchlistStore } from '../lib/watchlist';

export function WatchlistScreen() {
  const { t } = useT();
  const items = useWatchlist();
  const tickers = items.map((i) => i.ticker);
  const quotes = useQuotes(tickers);
  const [editing, setEditing] = useState(false);
  const byTicker = new Map((quotes.data ?? []).map((r) => [r.ticker, r]));

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('watch.title')}</h1>
        <div className="header-actions">
          {items.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setEditing((e) => !e)}>
              {editing ? t('watch.done') : t('watch.edit')}
            </button>
          )}
          <Link to="/suche" className="icon-btn" aria-label={t('watch.addAria')}>
            +
          </Link>
        </div>
      </header>

      {items.length === 0 ? (
        <section className="empty">
          <p className="empty-title">{t('watch.emptyTitle')}</p>
          <p className="muted">{t('watch.emptyText')}</p>
          <div className="stack">
            <Link to="/suche" className="btn">
              {t('watch.searchBtn')}
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => EXAMPLE_TICKERS.forEach((e) => watchlistStore.add(e.ticker, e.name))}>
              {t('watch.exampleBtn')}
            </button>
          </div>
        </section>
      ) : (
        <>
          {quotes.isError && !quotes.data && <ErrorNote error={quotes.error} onRetry={() => quotes.refetch()} />}
          <ul className="list" aria-label={t('watch.list')}>
            {items.map((item) => {
              const r = byTicker.get(item.ticker);
              const q = r?.quote;
              return (
                <li key={item.ticker} className="watch-row">
                  {editing && (
                    <button type="button" className="delete-btn" aria-label={t('watch.removeAria', { symbol: item.symbol })} onClick={() => watchlistStore.remove(item.ticker)}>
                      −
                    </button>
                  )}
                  <Link to={`/s/${encodeURIComponent(item.ticker)}`} className="watch-link">
                    <div className="watch-left">
                      <div className="watch-symbol">{item.name ?? q?.name ?? item.symbol}</div>
                      <div className="watch-name">
                        {item.symbol} <span className="tag">{marketName(item.market)}</span>
                      </div>
                    </div>
                    <div className="watch-right">
                      {q ? (
                        <>
                          <div className="watch-price">{formatPrice(q.price, q.currency)}</div>
                          <ChangePill percent={q.changePercent} />
                          <div className="watch-fresh">
                            {formatAsOf(q.asOf, q.market)} · {freshnessText(q.freshness)}
                            {marketState(q) === 'closed' ? ` · ${t('market.closedShort')}` : ''}
                          </div>
                        </>
                      ) : r?.error ? (
                        <div className="watch-error">{r.error.code === 'NOT_FOUND' ? t('watch.unknown') : t('watch.unavailable')}</div>
                      ) : (
                        <div className="skeleton" aria-label={t('watch.loadingAria')} />
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="status-line">
            {quotes.isFetching ? <Spinner label={t('watch.updating')} /> : quotes.dataUpdatedAt ? t('watch.updatedAt', { time: formatTime(quotes.dataUpdatedAt) }) : ''}
            {quotes.isError && quotes.data && <span className="tone-down"> · {t('watch.updateFailed')}</span>}
          </p>
          <p className="disclaimer small">{t('watch.disclaimer')}</p>
        </>
      )}
    </main>
  );
}
