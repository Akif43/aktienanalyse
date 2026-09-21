import type { NewsItem } from '../../types';
import type { NewsQuery } from './types';

export function applyQuery(items: NewsItem[], query: NewsQuery): NewsItem[] {
  const filtered = query.since === undefined ? items : items.filter((i) => i.publishedAt >= query.since!);
  return query.limit === undefined ? filtered : filtered.slice(0, query.limit);
}
