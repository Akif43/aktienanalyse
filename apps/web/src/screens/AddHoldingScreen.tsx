import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LotForm } from '../components/LotForm';
import { ErrorNote, Segmented, Spinner } from '../components/ui';
import { useFundSearch, useSearch } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { positionCurrency } from '../lib/portfolio';
import { portfolioStore, type NewPosition } from '../lib/portfolio-store';

type Tab = 'stocks' | 'funds';

/** Aktie oder Fonds suchen und den ersten Kauf dafür eintragen. Danach zurück zum Depot. */
export function AddHoldingScreen() {
  const { t } = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('stocks');
  const [selected, setSelected] = useState<NewPosition | null>(null);

  if (selected) {
    const currency = positionCurrency(selected);
    return (
      <main className="screen">
        <header className="large-header">
          <h1>{t('depot.addTitle')}</h1>
        </header>
        <button type="button" className="link-btn" onClick={() => setSelected(null)}>
          {t('depot.changeSelection')}
        </button>
        <h2 className="section-title">{t('depot.addFor', { symbol: selected.symbol })}</h2>
        {selected.name && <p className="muted">{selected.name}</p>}
        <LotForm
          currency={currency}
          onSubmit={(lot) => {
            portfolioStore.addLot(selected, lot);
            navigate('/depot');
          }}
          onCancel={() => setSelected(null)}
        />
      </main>
    );
  }

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('depot.addTitle')}</h1>
      </header>
      <Segmented
        options={[
          { value: 'stocks', label: t('search.tabStocks') },
          { value: 'funds', label: t('search.tabFunds') },
        ]}
        value={tab}
        label={t('depot.addTitle')}
        onChange={setTab}
      />
      {tab === 'stocks' ? <StockPicker onSelect={setSelected} /> : <FundPicker onSelect={setSelected} />}
    </main>
  );
}

function StockPicker({ onSelect }: { onSelect: (p: NewPosition) => void }) {
  const { t, dynamic } = useT();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');

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
      {term.trim() === '' ? null : search.isPending ? (
        <Spinner label={t('search.loading')} />
      ) : search.isError ? (
        <ErrorNote error={search.error} onRetry={() => search.refetch()} />
      ) : results.length === 0 ? (
        <div className="center-note">{t('search.noResults', { term: term.trim() })}</div>
      ) : (
        <ul className="list" aria-label={t('search.results')}>
          {results.map((r) => (
            <li key={r.ticker} className="watch-row">
              <button type="button" className="watch-link" onClick={() => onSelect({ kind: 'stock', key: r.ticker, symbol: r.symbol, market: r.market, name: r.name })}>
                <div className="watch-left">
                  <div className="watch-symbol">
                    {r.symbol} <span className="tag">{dynamic(`market.${r.market}`, r.marketLabel)}</span>
                  </div>
                  <div className="watch-name">{r.name}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FundPicker({ onSelect }: { onSelect: (p: NewPosition) => void }) {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');

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
      {term.trim() === '' ? null : search.isPending ? (
        <Spinner label={t('search.loading')} />
      ) : search.isError ? (
        <ErrorNote error={search.error} onRetry={() => search.refetch()} />
      ) : results.length === 0 ? (
        <div className="center-note">{t('search.noResults', { term: term.trim() })}</div>
      ) : (
        <ul className="list" aria-label={t('search.results')}>
          {results.map((r) => (
            <li key={r.code} className="watch-row">
              <button type="button" className="watch-link" onClick={() => onSelect({ kind: 'fund', key: r.code, symbol: r.code, name: r.name })}>
                <div className="watch-left">
                  <div className="watch-symbol">
                    {r.code} <span className="tag">{t('search.tabFunds')}</span>
                  </div>
                  <div className="watch-name">{r.name}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
