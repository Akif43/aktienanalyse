import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Spinner } from '../components/ui';
import { useSearch } from '../lib/hooks';
import { useWatchlist, watchlistStore } from '../lib/watchlist';

export function SearchScreen() {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const watch = useWatchlist();

  // Entprellt: erst nach kurzer Tipp-Pause suchen, um Yahoo nicht bei jedem Buchstaben zu fragen
  useEffect(() => {
    const t = setTimeout(() => setTerm(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const search = useSearch(term);
  const results = search.data ?? [];

  return (
    <main className="screen">
      <header className="large-header">
        <h1>Suche</h1>
      </header>
      <input
        className="search-input"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Name oder Kürzel, z. B. THYAO, Apple, SAP"
        aria-label="Aktie suchen"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />
      <p className="row-hint pad">Durchsucht Borsa Istanbul (BIST), XETRA und US-Börsen.</p>

      {term.trim() === '' ? null : search.isPending ? (
        <Spinner label="Suche …" />
      ) : search.isError ? (
        <ErrorNote error={search.error} onRetry={() => search.refetch()} />
      ) : results.length === 0 ? (
        <div className="center-note">Keine Treffer für „{term.trim()}“.</div>
      ) : (
        <ul className="list" aria-label="Suchergebnisse">
          {results.map((r) => {
            const added = watch.some((w) => w.ticker === r.ticker.toUpperCase());
            return (
              <li key={r.ticker} className="watch-row">
                <Link to={`/s/${encodeURIComponent(r.ticker)}`} className="watch-link">
                  <div className="watch-left">
                    <div className="watch-symbol">
                      {r.symbol} <span className="tag">{r.marketLabel}</span>
                    </div>
                    <div className="watch-name">{r.name}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  className={`add-btn ${added ? 'added' : ''}`}
                  aria-label={added ? `${r.symbol} entfernen` : `${r.symbol} zur Watchlist hinzufügen`}
                  onClick={() => (added ? watchlistStore.remove(r.ticker) : watchlistStore.add(r.ticker, r.name))}
                >
                  {added ? '✓' : '+'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
