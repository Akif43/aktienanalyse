import type { GenerateRequest, GenerateResult, LLMProvider } from './types';

export const DEMO_PROVIDER_ID = 'demo';

const fmt = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '–' : v.toFixed(digits).replace('.', ','));

function extractPayload(prompt: string): any {
  const m = /```json\s*([\s\S]*?)\s*```/.exec(prompt);
  return m ? JSON.parse(m[1]!) : {};
}

/**
 * Demo-Anbieter ohne echte KI: baut aus den Eingabedaten feste Platzhaltertexte. Nur zum Ausprobieren der
 * Oberfläche ohne API-Key (AI_PROVIDER=demo). Die Ergebnisse sind in der App deutlich als Demo gekennzeichnet.
 */
export class DemoProvider implements LLMProvider {
  readonly id = DEMO_PROVIDER_ID;
  readonly model = 'platzhalter';

  async generateJSON(req: GenerateRequest): Promise<GenerateResult> {
    const payload = extractPayload(req.prompt);
    const data = req.task === 'news' ? this.news(payload) : this.technical(payload);
    return { data, raw: JSON.stringify(data), provider: this.id, model: this.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private technical(p: any) {
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
      summary: `Demo-Text ohne KI: Die Trendstruktur ist ${state}, der RSI liegt bei ${fmt(s.rsi14?.value)}.`,
      argumentsFor: [`Der Kurs liegt ${fmt(s.sma?.['200']?.priceDistancePercent)} % zum SMA 200.`],
      argumentsAgainst: [`Der MACD steht ${s.macd?.state?.position ?? 'unbekannt'}.`],
      risks: [`Die durchschnittliche Tagesspanne (ATR) beträgt ${fmt(s.atr14?.percentOfPrice)} % vom Kurs.`],
      entry: { candidateId: verdict === 'bearish' ? null : (e?.id ?? null), comment: 'Demo: automatisch gewählter Kandidat, keine echte Bewertung.' },
      stopLoss: { candidateId: verdict === 'bearish' ? null : (sl?.id ?? null), comment: 'Demo: automatisch gewählter Kandidat.' },
      targets: verdict === 'bearish' ? [] : t.map((x: any) => ({ candidateId: x.id, comment: 'Demo: automatisch gewählter Kandidat.' })),
      horizon: 'mittelfristig',
      horizonComment: 'Demo: Platzhalter.',
    };
  }

  private news(p: any) {
    const items = (p.items ?? []).map((n: any) => ({
      id: n.id,
      sentiment: 'neutral',
      relevance: n.kind === 'kap' ? 3 : 2,
      titleDe: n.titel,
      reason: 'Demo: keine echte Einordnung.',
    }));
    return {
      items,
      overall: { summary: 'Demo-Text ohne KI: Die Meldungen wurden nicht inhaltlich bewertet.', argumentsFor: [], argumentsAgainst: [] },
    };
  }
}
