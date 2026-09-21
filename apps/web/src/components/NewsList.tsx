import type { NewsItem, Sentiment } from '@aktien/core';
import { useState } from 'react';
import type { NewsEnvelope, NewsResponse } from '../lib/api';
import { formatRelative } from '../lib/format';
import { useRefreshAnalysis } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { AnalysisMetaLine, DemoBanner } from './AnalysisCard';

const SOURCE_NAMES: Record<string, string> = { kap: 'KAP', 'google-news': 'Google News', 'finnhub-news': 'Finnhub' };

const SENTIMENT_CLASS: Record<Sentiment, string> = { positiv: 'sent-up', neutral: 'sent-flat', negativ: 'sent-down' };
type Rating = NewsEnvelope['analysis']['byId'][string];

/** Gesamteinordnung der Nachrichtenlage in einfachen Worten: Zusammenfassung sowie Positives und Negatives. */
export function NewsSummary({ envelope, ticker, name }: { envelope: NewsEnvelope; ticker: string; name?: string }) {
  const { t, msg } = useT();
  const refresh = useRefreshAnalysis('news-analysis', ticker, name);
  const { analysis: a, meta } = envelope;
  const list = (title: string, items: string[], tone: 'up' | 'down') => (
    <section className="group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <div className="row-hint pad">{t('news.nothing')}</div>
      ) : (
        <ul className={`bullets bullets-${tone}`}>
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div>
      {meta.demo && <DemoBanner />}
      <section className="group">
        <h3>{t('news.summaryTitle')}</h3>
        <p className="ai-summary pad-x">{a.overall.summary || t('news.noSummary')}</p>
      </section>
      {list(t('news.positive'), a.overall.argumentsFor, 'up')}
      {list(t('news.negative'), a.overall.argumentsAgainst, 'down')}
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
      {meta.provider !== 'none' && <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />}
    </div>
  );
}

/** Meldungen, die die KI als Rauschen bewertet hat (Wichtigkeit 1), sind zunächst eingeklappt. */
const isNoise = (rating: Rating | undefined) => rating !== undefined && rating.relevance <= 1;

export function NewsList({ data, analysis, isBist = false, onOpen }: { data: NewsResponse; analysis?: NewsEnvelope['analysis']; isBist?: boolean; onOpen: (id: string) => void }) {
  const { t } = useT();
  const [showAll, setShowAll] = useState(false);
  const hidden = data.items.filter((n) => isNoise(analysis?.byId[n.id])).length;
  const visible = showAll ? data.items : data.items.filter((n) => !isNoise(analysis?.byId[n.id]));
  // Offizielle KAP-Meldungen stehen immer vor den Medien, jeweils die neuesten zuerst
  const official = visible.filter((n) => n.kind === 'kap');
  const press = visible.filter((n) => n.kind !== 'kap');
  const grouped = isBist || official.length > 0;
  // Ist die KAP-Quelle ausgefallen, sagt die Liste nicht "keine Meldungen", sondern zeigt nur den Quellenhinweis oben
  const kapFailed = data.errors.some((e) => e.adapter === 'kap');
  const list = (items: NewsItem[]) => (
    <ul className="list news">
      {items.map((n) => (
        <NewsRow key={n.id} item={n} rating={analysis?.byId[n.id]} onOpen={onOpen} />
      ))}
    </ul>
  );

  return (
    <div>
      {data.errors.length > 0 && (
        <div className="warn-note" role="note">
          {t('news.sourcesFailed', { sources: data.errors.map((e) => `${SOURCE_NAMES[e.adapter] ?? e.adapter} (${e.code})`).join(', ') })}
        </div>
      )}
      {data.items.length === 0 ? (
        <div className="center-note">{t('news.noItems')}</div>
      ) : (
        <>
          {visible.length === 0 ? (
            <div className="center-note">{t('news.allNoise')}</div>
          ) : (
            grouped ? (
              <>
                <h3 className="sub-title news-group">{t('news.kapTitle')}</h3>
                <p className="row-hint">{t('news.kapText')}</p>
                {official.length > 0 ? list(official) : !kapFailed && <div className="center-note">{t('news.noKap')}</div>}
                {press.length > 0 && (
                  <>
                    <h3 className="sub-title news-group">{t('news.pressTitle')}</h3>
                    <p className="row-hint">{t('news.pressText')}</p>
                    {list(press)}
                  </>
                )}
              </>
            ) : (
              list(visible)
            )
          )}
          {hidden > 0 && (
            <div className="stack">
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t('news.showLess') : hidden === 1 ? t('news.showMore1') : t('news.showMore', { n: hidden })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewsRow({ item, rating, onOpen }: { item: NewsItem; rating?: Rating; onOpen: (id: string) => void }) {
  const { t, lang } = useT();
  const sentimentClass = rating ? SENTIMENT_CLASS[rating.sentiment] : null;
  // Haupttitel in der gewählten Sprache (von der KI übersetzt), das Original steht klein darunter
  const local = rating?.titleLocal?.trim();
  const translated = Boolean(local && local !== item.title);
  return (
    <li className={rating && rating.relevance >= 4 ? 'news-important' : ''}>
      <button type="button" className="news-row" onClick={() => onOpen(item.id)}>
        <div className="news-meta">
          {item.kind === 'kap' && (
            <span className="tag tag-kap" title={t('news.kapHint')}>
              KAP
            </span>
          )}
          <span>{item.kind === 'kap' ? (item.category ?? t('news.category')) : item.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(item.publishedAt).toISOString()}>{formatRelative(item.publishedAt)}</time>
          {rating && sentimentClass && <span className={`tag ${sentimentClass}`}>{t(`sent.${rating.sentiment}` as const)}</span>}
          {rating && rating.relevance >= 4 && <span className="tag tag-important">{t('news.important')}</span>}
        </div>
        <div className="news-title" lang={translated ? lang : item.language}>
          {translated ? local : item.title}
        </div>
        {rating?.reason && <div className="news-reason">{rating.reason}</div>}
        {translated && (
          <div className="news-original" lang={item.language}>
            {t('news.original')}: {item.title}
          </div>
        )}
      </button>
    </li>
  );
}
