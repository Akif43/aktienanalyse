import { computeFxPerformance, computeTechnicalSnapshot, convertCandles, parseInstrument, type FxPerformance, type Timeframe } from '@aktien/core';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Chart, type ChartOverlays, type LegendValue } from '../components/Chart';
import { AiUnavailable, AnalysisCard } from '../components/AnalysisCard';
import { NewsList, NewsSummary } from '../components/NewsList';
import { TechPanel } from '../components/TechPanel';
import { ChangePill, Chip, Disclaimer, ErrorNote, FreshnessBadge, Segmented, Spinner } from '../components/ui';
import { buildChartData, visibleFrom } from '../lib/chart-data';
import { formatAsOf, formatNumber, formatPrice, formatVolume, marketName, marketTimezone, newsSearchName } from '../lib/format';
import { useAnalysis, useChartSeries, useHistory, useNews, useNewsAnalysis, useQuotes, usesDailyHistory } from '../lib/hooks';
import { useWatchlist, watchlistStore } from '../lib/watchlist';

type Tab = 'chart' | 'news' | 'alarme';
const TABS = [
  { value: 'chart', label: 'Chart & Technik' },
  { value: 'news', label: 'News & Einordnung' },
  { value: 'alarme', label: 'Alarme' },
] as const;
const TIMEFRAMES: readonly { value: Timeframe; label: string }[] = [
  { value: '1T', label: '1T' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: '1J', label: '1J' },
  { value: '5J', label: '5J' },
];

export function DetailScreen() {
  const { ticker: raw = '' } = useParams();
  const ticker = decodeURIComponent(raw).toUpperCase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'chart') as Tab;

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
        <ErrorNote error={new Error(`Ungültiges Kürzel: „${ticker}“`)} />
        <Link to="/" className="btn">
          Zur Watchlist
        </Link>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="nav-bar">
        <button type="button" className="link-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          ‹ Zurück
        </button>
        <button
          type="button"
          className="link-btn"
          aria-pressed={Boolean(item)}
          onClick={() => (item ? watchlistStore.remove(ticker) : watchlistStore.add(ticker, name))}
        >
          {item ? '★ In Watchlist' : '☆ Hinzufügen'}
        </button>
      </div>

      <header className="detail-head">
        <h1>
          {instrument.symbol} <span className="tag">{marketName(instrument.market)}</span>
        </h1>
        <div className="muted">{name ?? ' '}</div>
        {quote ? (
          <div className="price-block">
            <div className="price">{formatPrice(quote.price, quote.currency)}</div>
            <ChangePill percent={quote.changePercent} change={quote.change} showAbsolute />
            <div className="quote-meta">
              <FreshnessBadge quote={quote} />
              <span className="muted">Stand {formatAsOf(quote.asOf, quote.market)} (Börsenzeit)</span>
            </div>
            <div className="range-grid">
              <div>
                <span className="muted">Tagestief</span>
                <b>{formatNumber(quote.dayLow)}</b>
              </div>
              <div>
                <span className="muted">Tageshoch</span>
                <b>{formatNumber(quote.dayHigh)}</b>
              </div>
              <div>
                <span className="muted">Vortag</span>
                <b>{formatNumber(quote.previousClose)}</b>
              </div>
              <div>
                <span className="muted">Volumen</span>
                <b>{formatVolume(quote.volume)}</b>
              </div>
            </div>
          </div>
        ) : result?.error ? (
          <ErrorNote error={new Error(result.error.code === 'NOT_FOUND' ? 'Diese Aktie kennt die Datenquelle nicht.' : result.error.message)} onRetry={() => quotes.refetch()} />
        ) : quotes.isError ? (
          <ErrorNote error={quotes.error} onRetry={() => quotes.refetch()} />
        ) : (
          <Spinner />
        )}
      </header>

      <Segmented options={TABS} value={tab} label="Ansicht" onChange={(t) => setParams({ tab: t }, { replace: true })} />

      {tab === 'chart' && <ChartTab ticker={ticker} market={instrument.market} currencyLabel={quote?.currency} name={name} />}
      {tab === 'news' && <NewsTab ticker={ticker} name={name ? newsSearchName(name) : undefined} />}
      {tab === 'alarme' && (
        <section className="empty">
          <p className="empty-title">Alarme kommen bald</p>
          <p className="muted">
            Geplant: Preisalarm (über/unter), neues Tagestief, 52-Wochen-Hoch/-Tief, große Tagesbewegung und wichtige KAP-Meldungen, jeweils
            pro Aktie ein- und ausschaltbar und nur zu Börsenzeiten.
          </p>
        </section>
      )}
    </main>
  );
}

type ChartCurrency = 'TRY' | 'USD' | 'EUR';
const CURRENCIES: readonly { value: ChartCurrency; label: string }[] = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];
const FX_SYMBOL = { USD: 'USDTRY=X', EUR: 'EURTRY=X' } as const;

function ChartTab({ ticker, market, currencyLabel, name }: { ticker: string; market: 'BIST' | 'US' | 'XETRA'; currencyLabel?: string; name?: string }) {
  const [tf, setTf] = useState<Timeframe>('6M');
  const [overlays, setOverlays] = useState<ChartOverlays>({ sma20: true, sma50: true, sma200: true, bollinger: false });
  const [volume, setVolume] = useState(true);
  const [rsi, setRsi] = useState(false);
  const [macd, setMacd] = useState(false);
  const [legend, setLegend] = useState<LegendValue | null>(null);
  const [currency, setCurrency] = useState<ChartCurrency>('TRY');

  const series = useChartSeries(ticker, tf);
  const history = useHistory(ticker);
  // Wechselkurse (TRY je USD/EUR) nur für BIST-Aktien: Umschalter im Chart und Vergleich der realen Entwicklung
  const isBist = market === 'BIST';
  const fxUsd = useHistory(FX_SYMBOL.USD, isBist);
  const fxEur = useHistory(FX_SYMBOL.EUR, isBist);
  const fxForChart = currency === 'USD' ? fxUsd : currency === 'EUR' ? fxEur : undefined;
  const daily = usesDailyHistory(tf);
  const intraday = tf === '1T' || tf === '1W' || tf === '1M';
  const tz = marketTimezone(market);

  const data = useMemo(() => {
    if (!series.data) return undefined;
    if (currency !== 'TRY' && !fxForChart?.data) return undefined;
    // Umrechnung mit dem Tageskurs des jeweiligen Tages; bei Intraday-Kerzen ist das eine Näherung
    const candles = currency !== 'TRY' && fxForChart?.data ? convertCandles(series.data.candles, fxForChart.data.candles, tz) : series.data.candles;
    return buildChartData(candles, { tz, daily: !intraday, withIndicators: daily, fromUnix: daily ? visibleFrom(candles, tf) : undefined });
  }, [series.data, fxForChart?.data, currency, tz, intraday, daily, tf]);

  const fxPerformance = useMemo<FxPerformance[]>(() => {
    if (!isBist || !history.data) return [];
    return [
      fxUsd.data ? computeFxPerformance(history.data.candles, fxUsd.data.candles, 'USD', tz) : null,
      fxEur.data ? computeFxPerformance(history.data.candles, fxEur.data.candles, 'EUR', tz) : null,
    ].filter((p): p is FxPerformance => p !== null && p.periods.length > 0);
  }, [isBist, history.data, fxUsd.data, fxEur.data, tz]);

  const analysis = useAnalysis(ticker, name);

  const snapshot = useMemo(() => {
    if (!history.data) return undefined;
    try {
      const dropped = history.data.droppedBars;
      return {
        value: computeTechnicalSnapshot(history.data.candles, {
          extraWarnings: [
            ...(dropped ? [`Die Datenquelle lieferte ${dropped} unvollständige Kerzen, sie wurden übersprungen.`] : []),
            ...(history.data.approximate ? ['Tagesdaten der Ausweichquelle: Eröffnungskurs und Volumen sind angenähert.'] : []),
          ],
        }),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [history.data]);

  const toggle = (key: keyof ChartOverlays) => setOverlays((o) => ({ ...o, [key]: !o[key] }));
  const last = data?.candles.at(-1);
  const shown = legend ?? (last ? { ...last, volume: data?.volume.at(-1)?.value } : null);

  return (
    <div>
      <Segmented options={TIMEFRAMES} value={tf} label="Zeitraum" onChange={setTf} />
      {isBist && (
        <div className="currency-switch">
          <span className="muted">Währung:</span>
          <Segmented options={CURRENCIES} value={currency} label="Währung" onChange={setCurrency} />
        </div>
      )}

      {shown && (
        <div className="legend" aria-live="off">
          <span>O {formatNumber(shown.open)}</span>
          <span>H {formatNumber(shown.high)}</span>
          <span>T {formatNumber(shown.low)}</span>
          <span>S {formatNumber(shown.close)}</span>
          {shown.volume !== undefined && <span>Vol {formatVolume(shown.volume)}</span>}
          {currencyLabel && <span className="muted">{currency === 'TRY' ? currencyLabel : currency}</span>}
        </div>
      )}

      <div className="chart-wrap">
        {currency !== 'TRY' && fxForChart?.isError ? (
          <ErrorNote error={fxForChart.error} onRetry={() => fxForChart.refetch()} />
        ) : series.isPending || (currency !== 'TRY' && fxForChart?.isPending) ? (
          <Spinner label="Lade Kurse …" />
        ) : series.isError && !series.data ? (
          <ErrorNote error={series.error} onRetry={() => series.refetch()} />
        ) : data && data.candles.length > 0 ? (
          <Chart data={data} intraday={intraday} overlays={overlays} showVolume={volume} showRsi={rsi} showMacd={macd} onLegend={setLegend} />
        ) : (
          <div className="center-note">Keine Kursdaten für diesen Zeitraum (Börse geschlossen oder Feiertag).</div>
        )}
      </div>
      {series.data && (
        <p className="row-hint pad">
          Quelle: {series.data.source}
          {series.data.approximate ? ' (angenähert)' : ''} · Kerzen: {series.data.interval}
          {series.data.droppedBars > 0 ? ` · ${series.data.droppedBars} unvollständige Kerzen übersprungen` : ''}
        </p>
      )}

      <div className="chips" aria-label="Indikatoren">
        <Chip active={overlays.sma20 && daily} disabled={!daily} onClick={() => toggle('sma20')} color="var(--c-sma20)">
          SMA 20
        </Chip>
        <Chip active={overlays.sma50 && daily} disabled={!daily} onClick={() => toggle('sma50')} color="var(--c-sma50)">
          SMA 50
        </Chip>
        <Chip active={overlays.sma200 && daily} disabled={!daily} onClick={() => toggle('sma200')} color="var(--c-sma200)">
          SMA 200
        </Chip>
        <Chip active={overlays.bollinger && daily} disabled={!daily} onClick={() => toggle('bollinger')} color="var(--c-bb)">
          Bollinger
        </Chip>
        <Chip active={rsi && daily} disabled={!daily} onClick={() => setRsi((v) => !v)}>
          RSI
        </Chip>
        <Chip active={macd && daily} disabled={!daily} onClick={() => setMacd((v) => !v)}>
          MACD
        </Chip>
        <Chip active={volume} onClick={() => setVolume((v) => !v)}>
          Volumen
        </Chip>
      </div>
      {!daily && <p className="row-hint pad">Indikatoren werden auf Tageskerzen berechnet: wähle 6M oder 1J.</p>}
      {currency !== 'TRY' && <p className="row-hint pad">Umrechnung mit dem Tageskurs {currency}/TRY. Die Kennzahlen unten beziehen sich weiterhin auf TRY.</p>}

      <h2 className="section-title">KI-Einschätzung</h2>
      <AnalysisCard query={analysis} ticker={ticker} name={name} />

      <h2 className="section-title">Kennzahlen</h2>
      <Disclaimer />
      {history.isPending ? (
        <Spinner label="Berechne Kennzahlen …" />
      ) : history.isError ? (
        <ErrorNote error={history.error} onRetry={() => history.refetch()} />
      ) : snapshot && 'error' in snapshot ? (
        <ErrorNote error={new Error(snapshot.error)} />
      ) : snapshot ? (
        <TechPanel snapshot={snapshot.value} market={market} fx={fxPerformance} />
      ) : null}
    </div>
  );
}

function NewsTab({ ticker, name }: { ticker: string; name?: string }) {
  const news = useNews(ticker, name);
  const hasItems = news.isSuccess && news.data.items.length > 0;
  // Die Einordnung startet erst, wenn Meldungen da sind, und läuft getrennt: die Liste erscheint sofort
  const rating = useNewsAnalysis(ticker, name, hasItems);
  return (
    <div>
      <Disclaimer />
      {news.isPending ? (
        <Spinner label="Lade Meldungen …" />
      ) : news.isError ? (
        <ErrorNote error={news.error} onRetry={() => news.refetch()} />
      ) : (
        <>
          {hasItems &&
            (rating.isPending ? (
              <Spinner label="KI ordnet die Meldungen ein …" />
            ) : rating.isError ? (
              <AiUnavailable error={rating.error} onRetry={() => rating.refetch()} />
            ) : (
              <NewsSummary envelope={rating.data} ticker={ticker} name={name} />
            ))}
          <h2 className="section-title">Meldungen</h2>
          <NewsList data={news.data} analysis={rating.data?.analysis} />
          <p className="row-hint pad">Türkische Meldungen erscheinen im Original, die deutsche Kurzfassung steht darunter (sobald die KI-Einordnung vorliegt).</p>
        </>
      )}
    </div>
  );
}
