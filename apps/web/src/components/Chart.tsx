import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { CandlePoint, ChartData } from '../lib/chart-data';

export interface ChartOverlays {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  bollinger: boolean;
}

export interface LegendValue extends CandlePoint {
  volume?: number;
}

interface Props {
  data: ChartData;
  intraday: boolean;
  overlays: ChartOverlays;
  showVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
  onLegend: (value: LegendValue | null) => void;
}

/** Deutsche Zahlenformatierung für die Preisachsen (Lightweight Charts nutzt sonst den Punkt als Dezimaltrenner). */
const deFormat = (digits: number) => {
  const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return { type: 'custom' as const, minMove: 1 / 10 ** digits, formatter: (v: number) => nf.format(v) };
};

const MAIN_HEIGHT = 300;
const SUB_HEIGHT = 110;
const TIME_AXIS_HEIGHT = 28;

/** Aktuelles Farbschema (hell/dunkel) als Signal, damit der Chart bei einem Wechsel neu aufgebaut wird. */
function useColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setScheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return scheme;
}

export function Chart({ data, intraday, overlays, showVolume, showRsi, showMacd, onLegend }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const legendRef = useRef(onLegend);
  legendRef.current = onLegend;

  const subPanes = (showRsi && data.indicators ? 1 : 0) + (showMacd && data.indicators ? 1 : 0);
  const height = MAIN_HEIGHT + subPanes * SUB_HEIGHT;

  useEffect(() => {
    const el = ref.current;
    if (!el || data.candles.length === 0) return;

    const css = getComputedStyle(document.documentElement);
    const c = (name: string) => css.getPropertyValue(name).trim();
    const up = c('--up');
    const down = c('--down');

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c('--muted'), fontSize: 11, panes: { separatorColor: c('--sep') } },
      grid: { vertLines: { color: c('--grid') }, horzLines: { color: c('--grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: intraday, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'de-DE' },
      handleScale: { axisPressedMouseMove: true },
    });

    const lastClose = data.candles.at(-1)!.close;
    const precision = lastClose < 1 ? 4 : 2;
    const priceFormat = deFormat(precision);

    const candles = chart.addSeries(
      CandlestickSeries,
      { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat },
      0,
    );
    candles.setData(data.candles as never);

    let volume: ISeriesApi<'Histogram'> | undefined;
    if (showVolume) {
      volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false }, 0);
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(data.volume.map((v) => ({ time: v.time, value: v.value, color: v.up ? `${up}66` : `${down}66` })) as never);
    }

    const ind = data.indicators;
    const line = (points: { time: unknown; value: number }[], color: string, pane = 0, width: 1 | 2 = 1, style: LineStyle = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(points as never);
      return s;
    };
    if (ind) {
      if (overlays.sma20) line(ind.sma20, c('--c-sma20'));
      if (overlays.sma50) line(ind.sma50, c('--c-sma50'));
      if (overlays.sma200) line(ind.sma200, c('--c-sma200'), 0, 2);
      if (overlays.bollinger) {
        line(ind.bbUpper, c('--c-bb'), 0, 1, LineStyle.Dashed);
        line(ind.bbMiddle, c('--c-bb'), 0, 1, LineStyle.Dotted);
        line(ind.bbLower, c('--c-bb'), 0, 1, LineStyle.Dashed);
      }

      let pane = 1;
      if (showRsi) {
        const r = line(ind.rsi, c('--accent'), pane, 2);
        r.applyOptions({ priceFormat: deFormat(0), lastValueVisible: true });
        for (const level of [30, 70]) r.createPriceLine({ price: level, color: c('--muted'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        pane++;
      }
      if (showMacd) {
        const hist = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
        hist.setData(ind.macdHist.map((h) => ({ time: h.time, value: h.value, color: h.up ? `${up}99` : `${down}99` })) as never);
        line(ind.macd, c('--accent'), pane).applyOptions({ priceFormat: deFormat(2) });
        line(ind.macdSignal, c('--c-sma20'), pane);
      }
    }
    // Unterfenster erst nach dem ersten Layout-Durchlauf auf feste Höhe setzen, sonst verteilt Lightweight Charts neu
    // Alle Fenster explizit dimensionieren (auch das Hauptfenster), sonst schrumpft das erste Unterfenster
    const sizePanes = () => chart.panes().forEach((p, i) => p.setHeight(i === 0 ? MAIN_HEIGHT - TIME_AXIS_HEIGHT : SUB_HEIGHT));
    const frame = requestAnimationFrame(sizePanes);

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(candles) as CandlePoint | undefined;
      if (!param.time || !bar) return legendRef.current(null);
      const vol = volume ? (param.seriesData.get(volume) as { value?: number } | undefined)?.value : undefined;
      legendRef.current({ ...bar, volume: vol });
    });

    chart.timeScale().fitContent();
    return () => {
      cancelAnimationFrame(frame);
      legendRef.current(null);
      chart.remove();
    };
  }, [data, intraday, overlays.sma20, overlays.sma50, overlays.sma200, overlays.bollinger, showVolume, showRsi, showMacd, scheme]);

  return <div ref={ref} className="chart" style={{ height }} role="img" aria-label="Kerzenchart" />;
}
