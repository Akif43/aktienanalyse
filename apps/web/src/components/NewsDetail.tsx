import type { NewsItem } from '@aktien/core';
import { useEffect } from 'react';
import { ApiError, type NewsEnvelope } from '../lib/api';
import { formatRelative, safeHref } from '../lib/format';
import { useNewsItem, useRefreshNewsItem } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { AnalysisMetaLine, AiUnavailable, DemoBanner } from './AnalysisCard';
import { Disclaimer, ErrorNote, Spinner } from './ui';

const SENTIMENT_CLASS = { positiv: 'sent-up', neutral: 'sent-flat', negativ: 'sent-down' } as const;

function Points({ title, items, tone }: { title: string; items: string[]; tone: 'up' | 'down' | 'warn' }) {
  if (items.length === 0) return null;
  return (
    <section className="group">
      <h3>{title}</h3>
      <ul className={`bullets bullets-${tone}`}>
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Eine einzelne Meldung in der App: KI-Zusammenfassung und Einschätzung, was sie für die Aktie bedeuten könnte.
 * Das Original bleibt als Link erreichbar, ist aber nicht mehr der Hauptweg.
 */
export function NewsDetail({
  ticker,
  name,
  item,
  listRating,
  listLoading,
  onBack,
}: {
  ticker: string;
  name?: string;
  item: NewsItem | undefined;
  listRating?: NewsEnvelope['analysis']['byId'][string];
  listLoading: boolean;
  onBack: () => void;
}) {
  const { t, dynamic, lang, msg } = useT();
  const query = useNewsItem(ticker, name, item?.id);
  const refresh = useRefreshNewsItem(ticker, name, item?.id ?? '');

  // Beim Öffnen an den Anfang springen (die Liste davor war vermutlich weit heruntergescrollt)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [item?.id]);

  if (!item) {
    return (
      <div>
        <button type="button" className="link-btn" onClick={onBack}>
          {t('item.back')}
        </button>
        {listLoading ? <Spinner label={t('news.loading')} /> : <div className="center-note">{t('item.gone')}</div>}
      </div>
    );
  }

  const a = query.data?.analysis;
  const meta = query.data?.meta;
  const title = (a?.titleLocal ?? listRating?.titleLocal)?.trim();
  const translated = Boolean(title && title !== item.title);
  const sentiment = a?.sentiment ?? listRating?.sentiment;
  const relevance = a?.relevance ?? listRating?.relevance;

  return (
    <div className="news-detail">
      <button type="button" className="link-btn" onClick={onBack}>
        {t('item.back')}
      </button>

      <div className="news-meta">
        {item.kind === 'kap' && (
          <span className="tag tag-kap" title={t('news.kapHint')}>
            KAP
          </span>
        )}
        <span>{item.kind === 'kap' ? (item.category ?? t('news.category')) : item.source}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(item.publishedAt).toISOString()}>{formatRelative(item.publishedAt)}</time>
        {relevance !== undefined && relevance >= 4 && <span className="tag tag-important">{t('news.important')}</span>}
      </div>
      <h2 className="news-detail-title" lang={translated ? lang : item.language}>
        {translated ? title : item.title}
      </h2>
      {translated && (
        <div className="news-original" lang={item.language}>
          {t('news.original')}: {item.title}
        </div>
      )}

      {query.isPending ? (
        <Spinner label={t('item.reading')} />
      ) : query.isError || !a || !meta ? (
        query.error instanceof ApiError && query.error.code === 'NOT_FOUND' ? (
          <div className="center-note">{t('item.gone')}</div>
        ) : query.error instanceof ApiError && query.error.code === 'AI_NOT_CONFIGURED' ? (
          <AiUnavailable error={query.error} />
        ) : (
          <ErrorNote error={query.error} onRetry={() => query.refetch()} />
        )
      ) : (
        <>
          {meta.demo && <DemoBanner />}

          <section className="group">
            <h3>{t('item.summary')}</h3>
            {a.summary ? <p className="ai-summary pad-x">{a.summary}</p> : <div className="row-hint pad">{t('ai.empty')}</div>}
          </section>

          <section className="group impact">
            <h3>{t('item.impact')}</h3>
            {sentiment && (
              <div className="impact-head">
                <span className={`tag ${SENTIMENT_CLASS[sentiment]}`}>{dynamic(`impact.${sentiment}`, sentiment)}</span>
              </div>
            )}
            <div className="row">
              <div className="row-label">{t('item.short')}</div>
              <div className="row-value impact-text">{a.impact.shortTerm || '–'}</div>
            </div>
            <div className="row">
              <div className="row-label">{t('item.long')}</div>
              <div className="row-value impact-text">{a.impact.longTerm || '–'}</div>
            </div>
          </section>

          <Points title={t('item.positives')} items={a.positives} tone="up" />
          <Points title={t('item.negatives')} items={a.negatives} tone="down" />
          <Points title={t('item.watch')} items={a.watch} tone="warn" />

          <p className="basis-note">
            {a.basis === 'fulltext' ? t('item.basisFull') : t('item.basisHeadline')} {t('item.certainty', { level: dynamic(`certainty.${a.certainty}`, a.certainty) })}
          </p>

          {a.notes.length > 0 && (
            <div className="warn-note" role="note">
              <ul>
                {a.notes.map((n) => {
                  const text = msg(n);
                  return <li key={text}>{text}</li>;
                })}
              </ul>
            </div>
          )}
          <p className="verdict-note">{t('item.note')}</p>
          <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} advanced />
          {refresh.isError && <ErrorNote error={refresh.error} />}
        </>
      )}

      <div className="stack">
        <a className="btn btn-secondary" href={safeHref(item.url)} target="_blank" rel="noopener noreferrer">
          {item.kind === 'kap' ? t('item.openKap') : t('item.openOriginal')}
        </a>
      </div>
      <Disclaimer />
    </div>
  );

}
