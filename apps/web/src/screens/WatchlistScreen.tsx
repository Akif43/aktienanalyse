import { useState } from 'react';
import { Link } from 'react-router-dom';
import { marketState } from '@aktien/core';
import { ChangePill, ErrorNote, Spinner } from '../components/ui';
import { formatAsOf, formatPrice, formatTime, freshnessText, marketName } from '../lib/format';
import { EXAMPLE_FUNDS, fundStore, useFundWatchlist, type FundWatchItem } from '../lib/funds-store';
import { useFund, useQuotes } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { EXAMPLE_TICKERS, useWatchlist, watchlistStore } from '../lib/watchlist';

export function WatchlistScreen() {
  const { t } = useT();
  const items = useWatchlist();
  const funds = useFundWatchlist();
  const tickers = items.map((i) => i.ticker);
  const quotes = useQuotes(tickers);
  const [editing, setEditing] = useState(false);
  const byTicker = new Map((quotes.data ?? []).map((r) => [r.ticker, r]));

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('watch.title')}</h1>
        <div className="header-actions">
          {(items.length > 0 || funds.length > 0) && (
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

      <FundsSection editing={editing} funds={funds} />
    </main>
  );
}

function FundsSection({ editing, funds }: { editing: boolean; funds: FundWatchItem[] }) {
  const { t } = useT();

  return (
    <>
      <div className="funds-header">
        <h2 className="section-title">{t('watch.fundsTitle')}</h2>
        <Link to="/suche" className="icon-btn icon-btn-small" aria-label={t('watch.fundsAddAria')}>
          +
        </Link>
      </div>

      {funds.length === 0 ? (
        <section className="empty">
          <p className="muted">{t('watch.fundsEmpty')}</p>
          <div className="stack">
            <Link to="/suche" className="btn">
              {t('watch.fundsSearchBtn')}
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => EXAMPLE_FUNDS.forEach((f) => fundStore.add(f.code, f.name))}>
              {t('watch.exampleBtn')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <ul className="list" aria-label={t('watch.fundsList')}>
            {funds.map((item) => (
              <FundRow key={item.code} item={item} editing={editing} />
            ))}
          </ul>
          <p className="disclaimer small">{t('watch.fundsDisclaimer')}</p>
        </>
      )}
    </>
  );
}

function FundRow({ item, editing }: { item: FundWatchItem; editing: boolean }) {
  const { t } = useT();
  const fund = useFund(item.code);

  return (
    <li className="watch-row">
      {editing && (
        <button type="button" className="delete-btn" aria-label={t('watch.fundRemoveAria', { code: item.code })} onClick={() => fundStore.remove(item.code)}>
          −
        </button>
      )}
      <Link to={`/f/${encodeURIComponent(item.code)}`} className="watch-link">
        <div className="watch-left">
          <div className="watch-symbol">{item.name ?? fund.data?.name ?? item.code}</div>
          <div className="watch-name">
            {item.code} <span className="tag">{fund.data?.category ?? t('fund.noCategory')}</span>
          </div>
        </div>
        <div className="watch-right">
          {fund.data ? (
            <>
              <div className="watch-price">{formatPrice(fund.data.price, 'TRY')}</div>
              <ChangePill percent={fund.data.dailyChangePercent} />
            </>
          ) : fund.isError ? (
            <div className="watch-error">{t('watch.unavailable')}</div>
          ) : (
            <div className="skeleton" aria-label={t('watch.loadingAria')} />
          )}
        </div>
      </Link>
    </li>
  );
}
