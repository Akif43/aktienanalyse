import { useState } from 'react';
import { Link } from 'react-router-dom';
import { freshnessLabel, marketState } from '@aktien/core';
import { ChangePill, ErrorNote, Spinner } from '../components/ui';
import { formatAsOf, formatPrice, marketName } from '../lib/format';
import { useQuotes } from '../lib/hooks';
import { EXAMPLE_TICKERS, useWatchlist, watchlistStore } from '../lib/watchlist';

export function WatchlistScreen() {
  const items = useWatchlist();
  const tickers = items.map((i) => i.ticker);
  const quotes = useQuotes(tickers);
  const [editing, setEditing] = useState(false);
  const byTicker = new Map((quotes.data ?? []).map((r) => [r.ticker, r]));

  return (
    <main className="screen">
      <header className="large-header">
        <h1>Watchlist</h1>
        <div className="header-actions">
          {items.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Fertig' : 'Bearbeiten'}
            </button>
          )}
          <Link to="/suche" className="icon-btn" aria-label="Aktie hinzufügen">
            +
          </Link>
        </div>
      </header>

      {items.length === 0 ? (
        <section className="empty">
          <p className="empty-title">Noch keine Aktien</p>
          <p className="muted">Suche eine Aktie oder starte mit einer Beispielliste (BIST, US, XETRA).</p>
          <div className="stack">
            <Link to="/suche" className="btn">
              Aktie suchen
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => EXAMPLE_TICKERS.forEach((e) => watchlistStore.add(e.ticker, e.name))}>
              Beispielliste hinzufügen
            </button>
          </div>
        </section>
      ) : (
        <>
          {quotes.isError && !quotes.data && <ErrorNote error={quotes.error} onRetry={() => quotes.refetch()} />}
          <ul className="list" aria-label="Aktien">
            {items.map((item) => {
              const r = byTicker.get(item.ticker);
              const q = r?.quote;
              return (
                <li key={item.ticker} className="watch-row">
                  {editing && (
                    <button type="button" className="delete-btn" aria-label={`${item.symbol} entfernen`} onClick={() => watchlistStore.remove(item.ticker)}>
                      −
                    </button>
                  )}
                  <Link to={`/s/${encodeURIComponent(item.ticker)}`} className="watch-link">
                    <div className="watch-left">
                      <div className="watch-symbol">
                        {item.symbol} <span className="tag">{marketName(item.market)}</span>
                      </div>
                      <div className="watch-name">{item.name ?? q?.name ?? ' '}</div>
                    </div>
                    <div className="watch-right">
                      {q ? (
                        <>
                          <div className="watch-price">{formatPrice(q.price, q.currency)}</div>
                          <ChangePill percent={q.changePercent} />
                          <div className="watch-fresh">
                            {formatAsOf(q.asOf, q.market)} · {freshnessLabel(q.freshness)}
                            {marketState(q) === 'closed' ? ' · geschlossen' : ''}
                          </div>
                        </>
                      ) : r?.error ? (
                        <div className="watch-error" title={r.error.message}>
                          {r.error.code === 'NOT_FOUND' ? 'Unbekannt' : 'Nicht verfügbar'}
                        </div>
                      ) : (
                        <div className="skeleton" aria-label="Lädt" />
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="status-line">
            {quotes.isFetching ? <Spinner label="Aktualisiere …" /> : quotes.dataUpdatedAt ? `Aktualisiert ${new Date(quotes.dataUpdatedAt).toLocaleTimeString('de-DE')}` : ''}
            {quotes.isError && quotes.data && <span className="tone-down"> · Aktualisierung fehlgeschlagen</span>}
          </p>
          <p className="disclaimer small">Keine Anlageberatung. BIST- und XETRA-Kurse sind ca. 15 Minuten verzögert.</p>
        </>
      )}
    </main>
  );
}
