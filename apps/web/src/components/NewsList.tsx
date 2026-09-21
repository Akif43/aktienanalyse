import type { NewsItem, Sentiment } from '@aktien/core';
import { useState } from 'react';
import type { NewsEnvelope, NewsResponse } from '../lib/api';
import { formatRelative, safeHref } from '../lib/format';
import { useRefreshAnalysis } from '../lib/hooks';
import { AnalysisMetaLine, DemoBanner } from './AnalysisCard';

const SOURCE_NAMES: Record<string, string> = { kap: 'KAP', 'google-news': 'Google News', 'finnhub-news': 'Finnhub' };

const SENTIMENT: Record<Sentiment, { label: string; cls: string }> = {
  positiv: { label: 'Positiv', cls: 'sent-up' },
  neutral: { label: 'Neutral', cls: 'sent-flat' },
  negativ: { label: 'Negativ', cls: 'sent-down' },
};

export function Relevance({ value }: { value: number }) {
  return (
    <span className="relevance" title={`Relevanz ${value} von 5`} aria-label={`Relevanz ${value} von 5`}>
      {'●'.repeat(value)}
      <span className="relevance-off">{'●'.repeat(5 - value)}</span>
    </span>
  );
}

/** Gesamteinordnung der Nachrichtenlage: Zusammenfassung sowie Argumente dafür und dagegen. */
export function NewsSummary({ envelope, ticker, name }: { envelope: NewsEnvelope; ticker: string; name?: string }) {
  const refresh = useRefreshAnalysis('news-analysis', ticker, name);
  const { analysis: a, meta } = envelope;
  const list = (title: string, items: string[], tone: 'up' | 'down') => (
    <section className="group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <div className="row-hint pad">Nichts Belastbares in den Meldungen.</div>
      ) : (
        <ul className={`bullets bullets-${tone}`}>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div>
      {meta.demo && <DemoBanner />}
      <section className="group">
        <h3>Einordnung der Nachrichtenlage</h3>
        <p className="ai-summary pad-x">{a.overall.summary || 'Keine Zusammenfassung verfügbar.'}</p>
      </section>
      {list('Argumente für ein Investment', a.overall.argumentsFor, 'up')}
      {list('Argumente gegen ein Investment', a.overall.argumentsAgainst, 'down')}
      {a.notes.length > 0 && (
        <div className="warn-note" role="note">
          <ul>
            {a.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {meta.provider !== 'none' && <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />}
    </div>
  );
}

/** Meldungen, die die KI als Rauschen bewertet hat (Relevanz 1), sind zunächst eingeklappt. */
const isNoise = (rating: NewsEnvelope['analysis']['byId'][string] | undefined) => rating !== undefined && rating.relevance <= 1;

export function NewsList({ data, analysis }: { data: NewsResponse; analysis?: NewsEnvelope['analysis'] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = data.items.filter((n) => isNoise(analysis?.byId[n.id])).length;
  const visible = showAll ? data.items : data.items.filter((n) => !isNoise(analysis?.byId[n.id]));

  return (
    <div>
      {data.errors.length > 0 && (
        <div className="warn-note" role="note">
          <strong>Nicht alle Quellen erreichbar:</strong> {data.errors.map((e) => `${SOURCE_NAMES[e.adapter] ?? e.adapter} (${e.code})`).join(', ')}. Die Liste ist evtl. unvollständig.
        </div>
      )}
      {data.items.length === 0 ? (
        <div className="center-note">Keine aktuellen Meldungen gefunden.</div>
      ) : (
        <>
          {visible.length === 0 ? (
            <div className="center-note">Alle Meldungen wurden als wenig relevant eingestuft.</div>
          ) : (
            <ul className="list news">
              {visible.map((n) => (
                <NewsRow key={n.id} item={n} rating={analysis?.byId[n.id]} />
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <div className="stack">
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Weniger relevante Meldungen ausblenden' : `${hidden} weniger relevante Meldung${hidden === 1 ? '' : 'en'} einblenden`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewsRow({ item, rating }: { item: NewsItem; rating?: NewsEnvelope['analysis']['byId'][string] }) {
  const s = rating ? SENTIMENT[rating.sentiment] : null;
  const showTranslation = rating && item.language !== 'de' && rating.titleDe && rating.titleDe !== item.title;
  return (
    <li className={rating && rating.relevance >= 4 ? 'news-important' : ''}>
      <a className="news-row" href={safeHref(item.url)} target="_blank" rel="noopener noreferrer">
        <div className="news-meta">
          {item.kind === 'kap' && <span className="tag tag-kap">KAP</span>}
          <span>{item.kind === 'kap' ? (item.category ?? 'Meldung') : item.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(item.publishedAt).toISOString()}>{formatRelative(item.publishedAt)}</time>
          {item.language === 'tr' && <span className="tag">TR</span>}
          {s && <span className={`tag ${s.cls}`}>{s.label}</span>}
          {rating && <Relevance value={rating.relevance} />}
        </div>
        <div className="news-title" lang={item.language}>
          {item.title}
        </div>
        {showTranslation && <div className="news-de">{rating.titleDe}</div>}
        {rating?.reason && <div className="news-reason">{rating.reason}</div>}
      </a>
    </li>
  );
}
