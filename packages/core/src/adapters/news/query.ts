import type { NewsItem } from '../../types';
import type { NewsQuery } from './types';

export function applyQuery(items: NewsItem[], query: NewsQuery): NewsItem[] {
  const filtered = query.since === undefined ? items : items.filter((i) => i.publishedAt >= query.since!);
  return query.limit === undefined ? filtered : limitWithOfficialFirst(filtered, query.limit);
}

/**
 * Kürzt auf `limit` Meldungen, aber offizielle KAP-Meldungen haben Vorrang: Sie belegen bis zur Hälfte der Plätze,
 * auch wenn die Presse neuer ist. Sonst würde bei vielen Pressemeldungen die (seltenere) Pflichtmeldung herausfallen.
 * Die Reihenfolge (neueste zuerst) bleibt erhalten.
 */
function limitWithOfficialFirst(items: NewsItem[], limit: number): NewsItem[] {
  if (items.length <= limit) return items;
  const kapSlots = Math.ceil(limit / 2);
  const keepIds = new Set(items.filter((i) => i.kind === 'kap').slice(0, kapSlots).map((i) => i.id));
  const rest = limit - keepIds.size;
  let taken = 0;
  for (const item of items) {
    if (taken >= rest) break;
    if (!keepIds.has(item.id)) {
      keepIds.add(item.id);
      taken++;
    }
  }
  return items.filter((i) => keepIds.has(i.id));
}
