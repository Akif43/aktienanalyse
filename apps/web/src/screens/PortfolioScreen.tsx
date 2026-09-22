import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Segmented, Spinner } from '../components/ui';
import { cashStore, useCash, type CashCurrency, type CashHoldings } from '../lib/cash-store';
import { buildChartData } from '../lib/chart-data';
import type { ChartCurrency } from '../lib/currency';
import { FUND_TZ } from '../lib/fund-chart';
import { formatPercent, formatPrice, formatSignedPrice } from '../lib/format';
import { usePortfolioHistory, usePortfolioPrices } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { cashTotal, convertAmount, positionAvgPrice, positionCurrency, positionGain, positionQuantity, positionValue, portfolioTotals, type FxRates } from '../lib/portfolio';
import { portfolioHistory } from '../lib/portfolio-history';
import { portfolioStore, usePortfolio, type PortfolioPosition } from '../lib/portfolio-store';

const CURRENCIES: readonly ChartCurrency[] = ['TRY', 'USD', 'EUR'];

export function PortfolioScreen() {
  const { t } = useT();
  const positions = usePortfolio();
  const cash = useCash();
  const { priceByKey, fx, isPending } = usePortfolioPrices(positions);
  const [editing, setEditing] = useState(false);
  const [editingCash, setEditingCash] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<ChartCurrency>('TRY');
  const totals = useMemo(() => portfolioTotals(positions, priceByKey, fx, displayCurrency), [positions, priceByKey, fx, displayCurrency]);
  const cashSum = useMemo(() => cashTotal(cash, displayCurrency, fx), [cash, displayCurrency, fx]);
  const hasCash = cash.TRY > 0 || cash.USD > 0 || cash.EUR > 0;
  const usesFx = positions.some((p) => positionCurrency(p) !== 'TRY') || cash.USD > 0 || cash.EUR > 0;
  const incomplete = totals.incomplete || cashSum.incomplete;
  const totalWealth = totals.value + cashSum.amount;

  const { priceHistory, fx: fxHistory, isPending: historyPending } = usePortfolioHistory(positions);
  const historyCandles = useMemo(() => {
    const base = portfolioHistory(positions, priceHistory, fxHistory, displayCurrency, FUND_TZ);
    // Bargeld hat kein Kaufdatum: wird mit dem aktuellen Betrag über den ganzen Zeitraum dazugerechnet, damit der Chart das Gesamtvermögen zeigt.
    return cashSum.amount === 0 ? base : base.map((c) => ({ ...c, open: c.open + cashSum.amount, high: c.high + cashSum.amount, low: c.low + cashSum.amount, close: c.close + cashSum.amount }));
  }, [positions, priceHistory, fxHistory, displayCurrency, cashSum.amount]);
  const historyData = useMemo(() => (historyCandles.length > 1 ? buildChartData(historyCandles, { tz: FUND_TZ, daily: true, withIndicators: false }) : null), [historyCandles]);

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

      {positions.length === 0 && !hasCash ? (
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
          <div className="currency-switch">
            <span className="muted">{t('chart.currency')}:</span>
            <Segmented options={CURRENCIES.map((value) => ({ value, label: t(`cur.${value}` as const) }))} value={displayCurrency} label={t('chart.currency')} onChange={setDisplayCurrency} />
          </div>

          <section className="verdict-card">
            <div className="row">
              <div className="row-label">{t('depot.totalWealth')}</div>
              <div className="row-value">{isPending ? <Spinner /> : formatPrice(totalWealth, displayCurrency)}</div>
            </div>
            {hasCash && (
              <div className="row">
                <div className="row-label">{t('depot.cashValue')}</div>
                <div className="row-value">{formatPrice(cashSum.amount, displayCurrency)}</div>
              </div>
            )}
            <div className="row">
              <div className="row-label">{t('depot.cost')}</div>
              <div className="row-value">{formatPrice(totals.cost, displayCurrency)}</div>
            </div>
            <div className="row">
              <div className="row-label">{t('depot.gain')}</div>
              <div className={`row-value ${totals.gain >= 0 ? 'tone-up' : 'tone-down'}`}>
                {formatSignedPrice(totals.gain, displayCurrency)}
                {totals.gainPercent !== null && <div className="row-hint">{formatPercent(totals.gainPercent)}</div>}
              </div>
            </div>
          </section>
          {incomplete && <p className="row-hint pad">{t('depot.incompleteNote')}</p>}
          {usesFx && <p className="row-hint pad">{t('depot.convertedNote')}</p>}

          {positions.length > 0 && (
            <section>
              <h2 className="section-title">{t('depot.historyTitle')}</h2>
              <div className="chart-wrap">
                {historyPending && !historyData ? (
                  <Spinner label={t('chart.loading')} />
                ) : historyData ? (
                  <Chart data={historyData} mode="line" intraday={false} overlays={{ sma20: false, sma50: false, sma200: false, bollinger: false }} showVolume={false} showRsi={false} showMacd={false} onLegend={() => {}} />
                ) : (
                  <div className="center-note">{t('chart.noData')}</div>
                )}
              </div>
              {hasCash && <p className="row-hint pad">{t('depot.historyCashNote')}</p>}
            </section>
          )}

          {positions.length > 0 && (
            <ul className="list" aria-label={t('depot.list')}>
              {positions.map((p) => (
                <PositionRow key={p.key} position={p} currentPrice={priceByKey.get(p.key)} editing={editing} fx={fx} displayCurrency={displayCurrency} />
              ))}
            </ul>
          )}

          {editingCash ? (
            <CashEditor cash={cash} onDone={() => setEditingCash(false)} />
          ) : (
            <CashSection cash={cash} onEdit={() => setEditingCash(true)} />
          )}

          <p className="disclaimer small">{t('depot.disclaimer')}</p>
        </>
      )}
    </main>
  );
}

function PositionRow({
  position,
  currentPrice,
  editing,
  fx,
  displayCurrency,
}: {
  position: PortfolioPosition;
  currentPrice: number | null | undefined;
  editing: boolean;
  fx: FxRates;
  displayCurrency: ChartCurrency;
}) {
  const { t } = useT();
  const currency = positionCurrency(position);
  const quantity = positionQuantity(position);
  const avgPrice = positionAvgPrice(position);
  const value = positionValue(position, currentPrice);
  const gain = positionGain(position, currentPrice);
  const valueDisplay = value === null ? null : convertAmount(value, currency, displayCurrency, fx);
  const gainDisplay = gain === null ? null : convertAmount(gain.amount, currency, displayCurrency, fx);
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
          {currentPrice !== undefined && currentPrice !== null && <div className="row-hint">{t('depot.currentPrice')}: {formatPrice(currentPrice, currency)}</div>}
        </div>
        <div className="watch-right">
          {currentPrice === undefined ? (
            <div className="skeleton" aria-label={t('watch.loadingAria')} />
          ) : currentPrice === null || valueDisplay === null || gainDisplay === null || gain === null ? (
            <div className="watch-error">{t('watch.unavailable')}</div>
          ) : (
            <>
              <div className="watch-price">{formatPrice(valueDisplay, displayCurrency)}</div>
              <span className={`pill pill-${gainDisplay >= 0 ? 'up' : 'down'}`}>{formatSignedPrice(gainDisplay, displayCurrency)}</span>
              {gain.percent !== null && <div className="watch-fresh">{formatPercent(gain.percent)}</div>}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

function CashSection({ cash, onEdit }: { cash: CashHoldings; onEdit: () => void }) {
  const { t } = useT();
  const entries = (['TRY', 'USD', 'EUR'] as const).filter((c) => cash[c] > 0);

  return (
    <section className="group">
      <h3>{t('depot.cashTitle')}</h3>
      {entries.length === 0 ? (
        <div className="row-hint pad">{t('depot.cashEmpty')}</div>
      ) : (
        entries.map((c) => (
          <div className="row" key={c}>
            <div className="row-label">{t(`cur.${c}` as const)}</div>
            <div className="row-value">{formatPrice(cash[c], c)}</div>
          </div>
        ))
      )}
      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={onEdit}>
          {t('depot.editCash')}
        </button>
      </div>
    </section>
  );
}

function CashEditor({ cash, onDone }: { cash: CashHoldings; onDone: () => void }) {
  const { t } = useT();
  const [values, setValues] = useState<Record<CashCurrency, string>>({
    TRY: cash.TRY ? String(cash.TRY) : '',
    USD: cash.USD ? String(cash.USD) : '',
    EUR: cash.EUR ? String(cash.EUR) : '',
  });

  const save = () => {
    for (const c of ['TRY', 'USD', 'EUR'] as const) {
      const n = Number((values[c] || '0').replace(',', '.'));
      cashStore.set(c, Number.isFinite(n) && n >= 0 ? n : 0);
    }
    onDone();
  };

  return (
    <section className="group">
      <h3>{t('depot.cashTitle')}</h3>
      <div className="lot-form">
        {(['TRY', 'USD', 'EUR'] as const).map((c) => (
          <label className="lot-form-field" key={c}>
            <span className="row-hint">{t(`cur.${c}` as const)}</span>
            <input className="search-input" inputMode="decimal" type="text" value={values[c]} onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))} placeholder="0" />
          </label>
        ))}
        <div className="stack">
          <button type="button" className="btn" onClick={save}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onDone}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </section>
  );
}
