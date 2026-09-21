import type { Instrument, NewsItem } from '../../types';
import { companyStems, scoreNewsItem } from './score';

const STOP = new Set([
  'bir', 'ile', 'için', 'icin', 'ama', 'gibi', 'daha', 'çok', 'cok', 'olan', 'oldu', 'oluyor', 'ise', 'den', 'dan', 'yeni', 'işte', 'iste', 'ilk', 'son', 'kez', 'nin', 'nın', 'için',
  'the', 'and', 'for', 'with', 'von', 'und', 'der', 'die', 'das', 'mit',
]);

/** Wortstämme eines Titels: türkisches Kleinschreiben, Endungen grob abgeschnitten (erste 5 Buchstaben), ohne Füllwörter. */
export function storyTokens(title: string, skip: ReadonlySet<string> = new Set()): Set<string> {
  const words = title
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  // Der Firmenname steht in fast jedem Titel und sagt nichts über die Geschichte: er zählt nicht mit
  return new Set(words.map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 5))).filter((w) => !skip.has(w)));
}

function similarity(a: Set<string>, b: Set<string>): { jaccard: number; shared: number } {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return { jaccard: union === 0 ? 0 : shared / union, shared };
}

/** Ab diesem Anteil gemeinsamer Wortstämme (und mindestens 3 gemeinsamen) gelten zwei Titel als dieselbe Geschichte. */
export const STORY_SIMILARITY = 0.4;

/**
 * Fasst Pressemeldungen zur selben Geschichte zusammen (z. B. 30 Berichte über denselben Preis). Behalten wird die Meldung mit der
 * höchsten Vorbewertung, bei Gleichstand die neueste; sie trägt in `alsoReported` die Zahl der weiteren Berichte. KAP-Meldungen
 * bleiben unberührt. Die Reihenfolge der übrigen Meldungen bleibt erhalten.
 */
export function groupStories(items: NewsItem[], instrument: Pick<Instrument, 'symbol' | 'name'>, now: number = Date.now()): NewsItem[] {
  const press = items.filter((i) => i.kind !== 'kap');
  // Auf den Tag gerundet, damit die Wahl der Kernmeldung bei jedem Abruf gleich ausfällt (Meldungs-IDs müssen stabil bleiben)
  now = Math.floor(now / 86_400_000) * 86_400_000;
  const score = new Map(press.map((i) => [i.id, scoreNewsItem(i, instrument, now)]));
  const skip = companyStems(instrument);
  const tokens = new Map(press.map((i) => [i.id, storyTokens(i.title, skip)]));

  const clusters: NewsItem[][] = [];
  // Erst die stärksten Meldungen: sie werden zum Kern einer Geschichte, kleinere hängen sich an
  const order = [...press].sort((a, b) => score.get(b.id)! - score.get(a.id)! || b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  for (const item of order) {
    const t = tokens.get(item.id)!;
    const home = clusters.find((c) => {
      const s = similarity(t, tokens.get(c[0]!.id)!);
      return s.jaccard >= STORY_SIMILARITY && s.shared >= 3;
    });
    if (home) home.push(item);
    else clusters.push([item]);
  }

  const keep = new Map<string, number>();
  for (const c of clusters) keep.set(c[0]!.id, c.length - 1);
  return items
    .filter((i) => i.kind === 'kap' || keep.has(i.id))
    .map((i) => (i.kind !== 'kap' && (keep.get(i.id) ?? 0) > 0 ? { ...i, alsoReported: keep.get(i.id) } : i));
}
