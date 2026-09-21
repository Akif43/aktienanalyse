import { computeFxPerformance, computeTechnicalSnapshot, msg as coreMsg, parseInstrument, type FxPerformance, type Market } from '@aktien/core';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AdvancedAnalysis, AiUnavailable, VerdictCard } from '../components/AnalysisCard';
import { Collapsible } from '../components/Collapsible';
import { Glance } from '../components/Glance';
import { Glossary } from '../components/Glossary';
import { NewsDetail } from '../components/NewsDetail';
import { NewsList, NewsSummary } from '../components/NewsList';
import { CandleSection, FxEffect, SimpleChart } from '../components/PriceCharts';
import { TechPanel } from '../components/TechPanel';
import { ChangePill, Disclaimer, ErrorNote, FreshnessBadge, Segmented, Spinner } from '../components/ui';
import { FX_SYMBOL } from '../lib/chart-model';
import { formatAsOf, formatNumber, formatPrice, formatVolume, marketName, marketTimezone, newsSearchName } from '../lib/format';
import { useAnalysis, useHistory, useNews, useNewsAnalysis, useQuotes } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { DETAILS_KEY } from '../lib/storage';
import { useWatchlist, watchlistStore } from '../lib/watchlist';

type Tab = 'overview' | 'news' | 'alarme';
const TAB_VALUES: readonly Tab[] = ['overview', 'news', 'alarme'];

export function DetailScreen() {
  const { t, lang } = useT();
  const { ticker: raw = '' } = useParams();
  const ticker = decodeURIComponent(raw).toUpperCase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // Ältere Links (?tab=chart) führen zur Übersicht
  const tab = (TAB_VALUES.find((v) => v === params.get('tab')) ?? 'overview') as Tab;
  // Ist eine Meldung geöffnet, bleibt nur der Aktienname oben: Kurs und Reiter würden von der Erklärung ablenken
  const itemOpen = tab === 'news' && Boolean(params.get('item'));

  const instrument = useMemo(() => {
    try {
      return parseInstrument(ticker);
    } catch {
      return null;
    }
  }, [ticker]);
  const watch = useWatchlist();
  const item = watch.find((i) => i.ticker === ticker);
  const quotes = useQuotes(instrument ? [ticker] : []);
  const result = quotes.data?.[0];
  const quote = result?.quote;
  const name = item?.name ?? quote?.name;

  if (!instrument) {
    return (
      <main className="screen">
        <ErrorNote message={t('error.invalidTicker', { ticker })} />
        <Link to="/" className="btn">
          {t('common.toList')}
        </Link>
      </main>
    );
  }

  const tabs = [
    { value: 'overview', label: t('tab.overview') },
    { value: 'news', label: t('tab.news') },
    { value: 'alarme', label: t('tab.alerts') },
  ] as const;

  return (
    <main className="screen">
      <div className="nav-bar">
        <button type="button" className="link-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          {t('common.back')}
        </button>
        <button type="button" className="link-btn" aria-pressed={Boolean(item)} onClick={() => (item ? watchlistStore.remove(ticker) : watchlistStore.add(ticker, name))}>
          {item ? t('detail.inList') : t('detail.addToList')}
        </button>
      </div>

      <header className="detail-head">
        <h1>{name ?? instrument.symbol}</h1>
        <div className="muted">
          {instrument.symbol} <span className="tag">{marketName(instrument.market)}</span>
        </div>
        {itemOpen ? null : quote ? (
          <div className="price-block">
            <div className="price">{formatPrice(quote.price, quote.currency)}</div>
            <ChangePill percent={quote.changePercent} change={quote.change} showAbsolute />
            <div className="quote-meta">
              <FreshnessBadge quote={quote} />
              <span className="muted">{t('detail.asOf', { time: formatAsOf(quote.asOf, quote.market) })}</span>
            </div>
            <div className="range-grid">
              <div>
                <span className="muted">{t('detail.dayLow')}</span>
                <b>{formatNumber(quote.dayLow)}</b>
              </div>
              <div>
                <span className="muted">{t('detail.dayHigh')}</span>
                <b>{formatNumber(quote.dayHigh)}</b>
              </div>
              <div>
                <span className="muted">{t('detail.prevClose')}</span>
                <b>{formatNumber(quote.previousClose)}</b>
              </div>
              <div>
                <span className="muted">{t('detail.volume')}</span>
                <b>{formatVolume(quote.volume)}</b>
              </div>
            </div>
          </div>
        ) : result?.error ? (
          <ErrorNote message={result.error.code === 'NOT_FOUND' ? t('error.NOT_FOUND') : undefined} error={result.error.code === 'NOT_FOUND' ? undefined : new Error(result.error.message)} onRetry={() => quotes.refetch()} />
        ) : quotes.isError ? (
          <ErrorNote error={quotes.error} onRetry={() => quotes.refetch()} />
        ) : (
          <Spinner />
        )}
      </header>

      {!itemOpen && <Segmented options={tabs} value={tab} label={t('detail.tabsAria')} onChange={(v) => setParams({ tab: v }, { replace: true })} />}

      {tab === 'overview' && <OverviewTab ticker={ticker} market={instrument.market} currency={quote?.currency} name={name} />}
      {tab === 'news' && (
        <NewsTab
          key={lang}
          ticker={ticker}
          name={name ? newsSearchName(name) : undefined}
          isBist={instrument.market === 'BIST'}
          selectedId={params.get('item') ?? undefined}
          // Öffnen legt einen Verlaufseintrag an, damit die Zurück-Geste der iPhone-Bedienung zur Liste führt
          onOpen={(id) => setParams({ tab: 'news', item: id }, { state: { fromList: true } })}
          onClose={() => (location.state && (location.state as { fromList?: boolean }).fromList ? navigate(-1) : setParams({ tab: 'news' }, { replace: true }))}
        />
      )}
      {tab === 'alarme' && (
        <section className="empty">
          <p className="empty-title">{t('alerts.title')}</p>
          <p className="muted">{t('alerts.text')}</p>
        </section>
      )}
    </main>
  );
}

function OverviewTab({ ticker, market, currency, name }: { ticker: string; market: Market; currency?: string; name?: string }) {
  const { t } = useT();
  const analysis = useAnalysis(ticker, name);
  const history = useHistory(ticker);
  // Wechselkurse (TRY je USD/EUR) nur für BIST-Aktien: Vergleich der Entwicklung in Lira und Fremdwährung
  const isBist = market === 'BIST';
  const fxUsd = useHistory(FX_SYMBOL.USD, isBist);
  const fxEur = useHistory(FX_SYMBOL.EUR, isBist);
  const tz = marketTimezone(market);

  const snapshot = useMemo(() => {
    if (!history.data) return undefined;
    try {
      const dropped = history.data.droppedBars;
      return {
        value: computeTechnicalSnapshot(history.data.candles, {
          extraWarnings: [...(dropped ? [coreMsg('sourceDropped', { count: dropped })] : []), ...(history.data.approximate ? [coreMsg('approximateData')] : [])],
        }),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [history.data]);

  const fxPerformance = useMemo<FxPerformance[]>(() => {
    if (!isBist || !history.data) return [];
    return [
      fxUsd.data ? computeFxPerformance(history.data.candles, fxUsd.data.candles, 'USD', tz) : null,
      fxEur.data ? computeFxPerformance(history.data.candles, fxEur.data.candles, 'EUR', tz) : null,
    ].filter((p): p is FxPerformance => p !== null && p.periods.length > 0);
  }, [isBist, history.data, fxUsd.data, fxEur.data, tz]);

  return (
    <div>
      <h2 className="section-title">{t('verdict.title')}</h2>
      <VerdictCard query={analysis} ticker={ticker} name={name} />

      <SimpleChart ticker={ticker} market={market} currencyLabel={currency} />

      {snapshot?.value && <Glance snapshot={snapshot.value} currency={currency} />}
      {history.isPending && <Spinner label={t('glance.loading')} />}

      {isBist && <FxEffect fx={fxPerformance} />}

      <Disclaimer />

      <Collapsible title={t('adv.title')} subtitle={t('adv.subtitle')} storageKey={DETAILS_KEY}>
        <CandleSection ticker={ticker} market={market} />
        <AdvancedAnalysis envelope={analysis.data} ticker={ticker} name={name} />
        <h3 className="sub-title">{t('tech.title')}</h3>
        {history.isPending ? (
          <Spinner label={t('tech.loading')} />
        ) : history.isError ? (
          <ErrorNote error={history.error} onRetry={() => history.refetch()} />
        ) : snapshot?.error ? (
          <ErrorNote message={snapshot.error} />
        ) : snapshot?.value ? (
          <TechPanel snapshot={snapshot.value} />
        ) : null}
        <Glossary />
      </Collapsible>
    </div>
  );
}

function NewsTab({ ticker, name, isBist, selectedId, onOpen, onClose }: { ticker: string; name?: string; isBist: boolean; selectedId?: string; onOpen: (id: string) => void; onClose: () => void }) {
  const { t } = useT();
  const news = useNews(ticker, name);
  const hasItems = news.isSuccess && news.data.items.length > 0;
  // Die Einordnung startet erst, wenn Meldungen da sind, und läuft getrennt: die Liste erscheint sofort
  const rating = useNewsAnalysis(ticker, name, hasItems);

  // Eine Meldung ist geöffnet: Erklärung und Einschätzung statt der Liste
  if (selectedId) {
    const item = news.data?.items.find((n) => n.id === selectedId);
    return <NewsDetail ticker={ticker} name={name} item={item} listRating={rating.data?.analysis.byId[selectedId]} listLoading={news.isPending} onBack={onClose} />;
  }

  return (
    <div>
      <Disclaimer />
      {news.isPending ? (
        <Spinner label={t('news.loading')} />
      ) : news.isError ? (
        <ErrorNote error={news.error} onRetry={() => news.refetch()} />
      ) : (
        <>
          {hasItems &&
            (rating.isPending ? (
              <Spinner label={t('news.rating')} />
            ) : rating.isError ? (
              <AiUnavailable error={rating.error} onRetry={() => rating.refetch()} />
            ) : (
              <NewsSummary envelope={rating.data} ticker={ticker} name={name} />
            ))}
          <h2 className="section-title">{t('news.listTitle')}</h2>
          <p className="row-hint">{t('news.tapHint')} {rating.data ? t('news.sortHint') : ''}</p>
          <NewsList data={news.data} analysis={rating.data?.analysis} isBist={isBist} onOpen={onOpen} />
          <p className="row-hint pad">{t('news.footnote')}</p>
        </>
      )}
    </div>
  );
}
