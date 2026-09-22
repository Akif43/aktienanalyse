import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Segmented, Spinner } from '../components/ui';
import { useFundSearch, useSearch } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { useWatchlist, watchlistStore } from '../lib/watchlist';
import { fundStore, useFundWatchlist } from '../lib/funds-store';

type Tab = 'stocks' | 'funds';

export function SearchScreen() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('stocks');

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('search.title')}</h1>
      </header>
      <Segmented
        options={[
          { value: 'stocks', label: t('search.tabStocks') },
          { value: 'funds', label: t('search.tabFunds') },
        ]}
        value={tab}
        label={t('search.title')}
        onChange={setTab}
      />
      {tab === 'stocks' ? <StockSearch /> : <FundSearch />}
    </main>
  );
}

function StockSearch() {
  const { t, dynamic } = useT();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const watch = useWatchlist();

  // Entprellt: erst nach kurzer Tipp-Pause suchen, um Yahoo nicht bei jedem Buchstaben zu fragen
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const search = useSearch(term);
  const results = search.data ?? [];

  return (
    <>
      <input
        className="search-input"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('search.placeholder')}
        aria-label={t('search.aria')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />
      <p className="row-hint pad">{t('search.hint')}</p>

      {term.trim() === '' ? null : search.isPending ? (
        <Spinner label={t('search.loading')} />
      ) : search.isError ? (
        <ErrorNote error={search.error} onRetry={() => search.refetch()} />
      ) : results.length === 0 ? (
        <div className="center-note">{t('search.noResults', { term: term.trim() })}</div>
      ) : (
        <ul className="list" aria-label={t('search.results')}>
          {results.map((r) => {
            const added = watch.some((w) => w.ticker === r.ticker.toUpperCase());
            return (
              <li key={r.ticker} className="watch-row">
                <Link to={`/s/${encodeURIComponent(r.ticker)}`} className="watch-link">
                  <div className="watch-left">
                    <div className="watch-symbol">
                      {r.symbol} <span className="tag">{dynamic(`market.${r.market}`, r.marketLabel)}</span>
                    </div>
                    <div className="watch-name">{r.name}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  className={`add-btn ${added ? 'added' : ''}`}
                  aria-label={added ? t('search.removeAria', { symbol: r.symbol }) : t('search.addAria', { symbol: r.symbol })}
                  onClick={() => (added ? watchlistStore.remove(r.ticker) : watchlistStore.add(r.ticker, r.name))}
                >
                  {added ? '✓' : '+'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Türkische Investment- und Rentenfonds (TEFAS), z. B. "AFT", "YAY". */
function FundSearch() {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const funds = useFundWatchlist();

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const search = useFundSearch(term);
  const results = search.data ?? [];

  return (
    <>
      <input
        className="search-input"
        type="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('search.fundPlaceholder')}
        aria-label={t('search.fundAria')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <p className="row-hint pad">{t('search.fundHint')}</p>

      {term.trim() === '' ? null : search.isPending ? (
        <Spinner label={t('search.loading')} />
      ) : search.isError ? (
        <ErrorNote error={search.error} onRetry={() => search.refetch()} />
      ) : results.length === 0 ? (
        <div className="center-note">{t('search.noResults', { term: term.trim() })}</div>
      ) : (
        <ul className="list" aria-label={t('search.results')}>
          {results.map((r) => {
            const added = funds.some((f) => f.code === r.code);
            return (
              <li key={r.code} className="watch-row">
                <Link to={`/f/${encodeURIComponent(r.code)}`} className="watch-link">
                  <div className="watch-left">
                    <div className="watch-symbol">
                      {r.code} <span className="tag">{t('search.tabFunds')}</span>
                    </div>
                    <div className="watch-name">{r.name}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  className={`add-btn ${added ? 'added' : ''}`}
                  aria-label={added ? t('search.fundRemoveAria', { code: r.code }) : t('search.fundAddAria', { code: r.code })}
                  onClick={() => (added ? fundStore.remove(r.code) : fundStore.add(r.code, r.name))}
                >
                  {added ? '✓' : '+'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
