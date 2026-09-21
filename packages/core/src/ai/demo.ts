import type { Lang } from '../messages';
import type { GenerateRequest, GenerateResult, LLMProvider } from './types';

export const DEMO_PROVIDER_ID = 'demo';

const fmt = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '–' : v.toFixed(digits).replace('.', ','));

const word = (value: string, lang: Lang) => (lang === 'tr' ? (TR_WORDS[value] ?? value) : value);

function extractPayload(prompt: string): any {
  const m = /```json\s*([\s\S]*?)\s*```/.exec(prompt);
  return m ? JSON.parse(m[1]!) : {};
}

/** Deutsche Kennzahl-Werte für die türkischen Demo-Texte. */
const TR_WORDS: Record<string, string> = {
  aufwärts: 'yukarı',
  abwärts: 'aşağı',
  seitwärts: 'yatay',
  unbekannt: 'bilinmiyor',
  'über Signal': 'sinyal çizgisinin üzerinde',
  'unter Signal': 'sinyal çizgisinin altında',
};

const TEXT = {
  de: {
    plainHeadline: 'Demo-Text ohne echte KI',
    plainExplanation: 'Dies ist ein Platzhalter. Ohne KI-Key kann die App die Lage nicht in eigenen Worten erklären.',
    plainPro: 'Platzhalter für einen Punkt, der für die Aktie spricht.',
    plainCon: 'Platzhalter für einen Punkt, der gegen die Aktie spricht.',
    summary: (state: string, rsi: string) => `Demo-Text ohne KI: Die Trendstruktur ist ${state}, der RSI liegt bei ${rsi}.`,
    pro: (dist: string) => `Der Kurs liegt ${dist} % zum SMA 200.`,
    con: (pos: string) => `Der MACD steht ${pos}.`,
    risk: (atr: string) => `Die durchschnittliche Tagesspanne (ATR) beträgt ${atr} % vom Kurs.`,
    entryComment: 'Demo: automatisch gewählter Kandidat, keine echte Bewertung.',
    pickComment: 'Demo: automatisch gewählter Kandidat.',
    horizonComment: 'Demo: Platzhalter.',
    reason: 'Demo: keine echte Einordnung.',
    newsSummary: 'Demo-Text ohne KI: Die Meldungen wurden nicht inhaltlich bewertet.',
    itemSummary: 'Demo-Text: Diese Meldung wurde nicht von einer KI zusammengefasst.',
    itemShort: 'Demo: Die kurzfristige Wirkung wurde nicht bewertet.',
    itemLong: 'Demo: Die langfristige Wirkung wurde nicht bewertet.',
    itemPro: 'Demo: Platzhalter für einen möglichen Vorteil.',
    itemCon: 'Demo: Platzhalter für ein mögliches Risiko.',
    itemWatch: 'Demo: Platzhalter für einen Punkt, auf den man achten kann.',
  },
  tr: {
    plainHeadline: 'Gerçek yapay zekâ olmadan demo metni',
    plainExplanation: 'Bu bir yer tutucudur. Yapay zekâ anahtarı olmadan uygulama durumu kendi cümleleriyle açıklayamaz.',
    plainPro: 'Hisse lehine olan bir maddenin yer tutucusu.',
    plainCon: 'Hisse aleyhine olan bir maddenin yer tutucusu.',
    summary: (state: string, rsi: string) => `Yapay zekâsız demo metni: Trend yapısı ${state}, RSI değeri ${rsi}.`,
    pro: (dist: string) => `Fiyat, 200 günlük ortalamaya göre yüzde ${dist} konumunda.`,
    con: (pos: string) => `MACD ${pos} durumda.`,
    risk: (atr: string) => `Ortalama günlük hareket aralığı (ATR) fiyatın yüzde ${atr} kadarı.`,
    entryComment: 'Demo: otomatik seçilen aday, gerçek bir değerlendirme değil.',
    pickComment: 'Demo: otomatik seçilen aday.',
    horizonComment: 'Demo: yer tutucu.',
    reason: 'Demo: gerçek bir değerlendirme değil.',
    newsSummary: 'Yapay zekâsız demo metni: Haberler içerik olarak değerlendirilmedi.',
    itemSummary: 'Demo metni: Bu haber yapay zekâ ile özetlenmedi.',
    itemShort: 'Demo: Kısa vadeli etki değerlendirilmedi.',
    itemLong: 'Demo: Uzun vadeli etki değerlendirilmedi.',
    itemPro: 'Demo: Olumlu yön için yer tutucu.',
    itemCon: 'Demo: Olumsuz yön için yer tutucu.',
    itemWatch: 'Demo: Takip edilecek nokta için yer tutucu.',
  },
} as const;

/**
 * Demo-Anbieter ohne echte KI: baut aus den Eingabedaten feste Platzhaltertexte. Nur zum Ausprobieren der
 * Oberfläche ohne API-Key (AI_PROVIDER=demo). Die Ergebnisse sind in der App deutlich als Demo gekennzeichnet.
 */
export class DemoProvider implements LLMProvider {
  readonly id = DEMO_PROVIDER_ID;
  readonly model = 'platzhalter';

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    const payload = extractPayload(req.prompt);
    const lang: Lang = payload.ausgabeSprache === 'tr' ? 'tr' : 'de';
    const data = req.task === 'news' ? this.news(payload, lang) : req.task === 'news-item' ? this.newsItem(payload, lang) : this.technical(payload, lang);
    return { data, raw: JSON.stringify(data), provider: this.id, model: this.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private technical(p: any, lang: Lang) {
    const T = TEXT[lang];
    const s = p.snapshot ?? {};
    const state: string = s.trend?.state ?? 'unbekannt';
    const verdict = state === 'aufwärts' ? 'bullish' : state === 'abwärts' ? 'bearish' : 'neutral';
    const c = p.candidates ?? {};
    const e = c.entries?.[1] ?? c.entries?.[0];
    const sl = c.stops?.[1] ?? c.stops?.[0];
    const t = (c.targets ?? []).slice(0, 2);
    return {
      verdict,
      confidence: 'niedrig',
      plain: { headline: T.plainHeadline, explanation: T.plainExplanation, pros: [T.plainPro], cons: [T.plainCon] },
      summary: T.summary(word(state, lang), fmt(s.rsi14?.value)),
      argumentsFor: [T.pro(fmt(s.sma?.['200']?.priceDistancePercent))],
      argumentsAgainst: [T.con(word(s.macd?.state?.position ?? '?', lang))],
      risks: [T.risk(fmt(s.atr14?.percentOfPrice))],
      entry: { candidateId: verdict === 'bearish' ? null : (e?.id ?? null), comment: T.entryComment },
      stopLoss: { candidateId: verdict === 'bearish' ? null : (sl?.id ?? null), comment: T.pickComment },
      targets: verdict === 'bearish' ? [] : t.map((x: any) => ({ candidateId: x.id, comment: T.pickComment })),
      horizon: 'mittelfristig',
      horizonComment: T.horizonComment,
    };
  }

  private newsItem(p: any, lang: Lang) {
    const T = TEXT[lang];
    return {
      titleLocal: p.meldung?.titel ?? '',
      summary: T.itemSummary,
      sentiment: 'neutral',
      relevance: p.meldung?.quelleArt === 'offiziell (KAP)' ? 3 : 2,
      impact: { shortTerm: T.itemShort, longTerm: T.itemLong },
      positives: [T.itemPro],
      negatives: [T.itemCon],
      watch: [T.itemWatch],
      certainty: 'niedrig',
    };
  }

  private news(p: any, lang: Lang) {
    const T = TEXT[lang];
    const items = (p.items ?? []).map((n: any) => ({
      id: n.id,
      sentiment: 'neutral',
      relevance: n.kind === 'kap' ? 3 : 2,
      titleLocal: n.titel,
      reason: T.reason,
    }));
    return { items, overall: { summary: T.newsSummary, argumentsFor: [], argumentsAgainst: [] } };
  }
}
