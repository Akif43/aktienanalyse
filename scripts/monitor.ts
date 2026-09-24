/**
 * Alarm-Überwachung: liest gespeicherte Regeln aus Supabase, prüft sie gegen aktuelle Kurse/Kerzen/
 * News und schickt bei Treffern eine ntfy-Benachrichtigung. Läuft alle 5 Minuten über GitHub Actions
 * (.github/workflows/monitor.yml), lässt sich aber auch lokal mit einer .env starten:
 *   npm run monitor
 *
 * Einzelne Adapterfehler (ein Ticker nicht erreichbar, News-Quelle blockiert) werden übersprungen statt
 * den ganzen Lauf abzubrechen — nur eine kaputte Grundkonfiguration (Supabase/ntfy) führt zu Exit 1.
 */
import { existsSync } from 'node:fs';
import {
  createMarketData,
  createNewsService,
  describeAlert,
  evaluateRule,
  MARKET_TZ,
  NtfyNotifier,
  parseInstrument,
  range52w,
  SupabaseKv,
  type AlertRule,
  type AlertRuleState,
} from '@aktien/core';

if (existsSync('.env')) process.loadEnvFile('.env');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, NTFY_TOPIC, NTFY_URL, FINNHUB_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_KEY fehlen — ohne sie können Regeln nicht gelesen und Zustand nicht gespeichert werden.');
  process.exit(1);
}
if (!NTFY_TOPIC) {
  console.error('NTFY_TOPIC fehlt — ohne Topic kann keine Benachrichtigung verschickt werden.');
  process.exit(1);
}

const kv = new SupabaseKv({ url: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY });
const notifier = new NtfyNotifier({ topic: NTFY_TOPIC, url: NTFY_URL || undefined });
const market = createMarketData({ finnhubApiKey: FINNHUB_API_KEY || undefined });
const news = createNewsService({ finnhubApiKey: FINNHUB_API_KEY || undefined });

const APP_URL = process.env.APP_URL || undefined;

async function main(): Promise<void> {
  const rules = ((await kv.get<AlertRule[]>('alerts:rules'))?.value ?? []).filter((r) => r.enabled);
  if (rules.length === 0) {
    console.log('Keine aktiven Regeln, nichts zu tun.');
    return;
  }

  const state = (await kv.get<Record<string, AlertRuleState>>('alerts:state'))?.value ?? {};
  const byTicker = new Map<string, AlertRule[]>();
  for (const rule of rules) byTicker.set(rule.ticker, [...(byTicker.get(rule.ticker) ?? []), rule]);

  let fired = 0;
  let skipped = 0;

  for (const [ticker, tickerRules] of byTicker) {
    let instrument;
    try {
      instrument = parseInstrument(ticker);
    } catch (err) {
      console.warn(`${ticker}: ungültiges Kürzel, übersprungen (${(err as Error).message})`);
      skipped++;
      continue;
    }

    let quote;
    try {
      quote = await market.getQuote(instrument);
    } catch (err) {
      console.warn(`${ticker}: Kurs nicht abrufbar, übersprungen (${(err as Error).message})`);
      skipped++;
      continue;
    }

    const needsRange52w = tickerRules.some((r) => r.type === 'range52w');
    const needsNews = tickerRules.some((r) => r.type === 'news');
    const tz = MARKET_TZ[instrument.market];

    const range = needsRange52w
      ? await market
          .getDailyHistory(instrument)
          .then((h) => range52w(h.candles) ?? undefined)
          .catch((err) => {
            console.warn(`${ticker}: 52-Wochen-Historie nicht abrufbar (${(err as Error).message})`);
            return undefined;
          })
      : undefined;

    const newsItems = needsNews
      ? await news
          .getNews(instrument)
          .then((r) => r.items)
          .catch((err) => {
            console.warn(`${ticker}: News nicht abrufbar (${(err as Error).message})`);
            return undefined;
          })
      : undefined;

    for (const rule of tickerRules) {
      const result = evaluateRule(rule, state[rule.id], { instrument, quote, range52w: range, news: newsItems }, tz);
      state[rule.id] = result.nextState;
      if (!result.fire) continue;
      const msg = describeAlert(rule, { instrument, quote, range52w: range, news: newsItems }, result.triggeringNews);
      try {
        await notifier.send({ ...msg, url: APP_URL ? `${APP_URL}/s/${ticker}` : undefined });
        console.log(`Gefeuert: ${msg.title}`);
        fired++;
      } catch (err) {
        console.warn(`ntfy-Versand fehlgeschlagen (${(err as Error).message})`);
      }
    }
  }

  await kv.set('alerts:state', state);
  console.log(`Fertig: ${fired} Alarm(e) verschickt, ${skipped} Ticker übersprungen.`);
}

main().catch((err) => {
  console.error('Monitor-Lauf fehlgeschlagen:', err);
  process.exit(1);
});
