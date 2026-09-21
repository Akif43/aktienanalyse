import type { Candidate, TechnicalAnalysis } from '@aktien/core';
import type { ReactNode } from 'react';
import { ApiError, type TechnicalEnvelope } from '../lib/api';
import { formatNumber, formatPercent, formatRelative } from '../lib/format';
import { useRefreshAnalysis } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { ErrorNote } from './ui';

type Verdict = TechnicalAnalysis['verdict'];
const LIGHT_ORDER: readonly Verdict[] = ['bearish', 'neutral', 'bullish'];
const VERDICT_CLASS: Record<Verdict, string> = { bullish: 'verdict-up', neutral: 'verdict-flat', bearish: 'verdict-down' };

/** Ampel: die drei Lampen zeigen auf einen Blick, in welche Richtung die Einschätzung geht. */
export function TrafficLight({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`traffic ${VERDICT_CLASS[verdict]}`} aria-hidden>
      {LIGHT_ORDER.map((v) => (
        <span key={v} className={`lamp lamp-${v} ${v === verdict ? 'lamp-on' : ''}`} />
      ))}
    </span>
  );
}

function range(c: Candidate): string {
  return c.low === c.high ? formatNumber(c.low) : `${formatNumber(c.low)} – ${formatNumber(c.high)}`;
}

function PlainList({ title, items, tone }: { title: string; items: string[]; tone: 'up' | 'down' | 'warn' }) {
  if (items.length === 0) return null;
  return (
    <section className="plain-list">
      <h4>{title}</h4>
      <ul className={`bullets bullets-${tone}`}>
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

/** Herkunft und Aktualität einer Auswertung samt Aktualisieren-Schaltfläche. Technische Angaben nur auf Wunsch (advanced). */
export function AnalysisMetaLine({ meta, onRefresh, refreshing, advanced = false }: { meta: TechnicalEnvelope['meta']; onRefresh: () => void; refreshing: boolean; advanced?: boolean }) {
  const { t, msg } = useT();
  return (
    <div className="meta-line">
      <div className="row-hint">
        {t('ai.created', { when: formatRelative(meta.generatedAt) })}
        {meta.demo ? ` · ${t('ai.demo')}` : ''}
        {advanced && !meta.demo ? ` · ${t('ai.technical', { provider: meta.provider, model: meta.model })}` : ''}
        {advanced && meta.cached ? ` · ${t('ai.cached')}` : ''}
        {advanced && meta.guardRemoved > 0 ? ` · ${t('ai.removed', { count: meta.guardRemoved })}` : ''}
      </div>
      {meta.note && <div className={`row-hint ${meta.stale ? 'tone-down' : ''}`}>{msg(meta.note)}</div>}
      <button type="button" className="btn btn-small btn-secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? t('ai.refreshing') : t('ai.refresh')}
      </button>
    </div>
  );
}

export function DemoBanner() {
  const { t } = useT();
  return (
    <div className="warn-note" role="note">
      {t('ai.demoBanner')}
    </div>
  );
}

type AnalysisQuery = { data?: TechnicalEnvelope; error: unknown; isPending: boolean; isError: boolean; refetch: () => void };

/** Kurzfazit für Laien: Ampel, ein Satz, eine kurze Erklärung, Pro und Contra. */
export function VerdictCard({ query, ticker, name }: { query: AnalysisQuery; ticker: string; name?: string }) {
  const { t, dynamic, msg } = useT();
  const refresh = useRefreshAnalysis('analysis', ticker, name);

  if (query.isPending) {
    return (
      <div className="center-note" role="status">
        <span className="spinner" aria-hidden /> {t('ai.creating')}
      </div>
    );
  }
  if (query.isError || !query.data) return <AiUnavailable error={query.error} onRetry={query.refetch} />;

  const { analysis: a, meta } = query.data;
  const plain = a.plain;
  return (
    <div className="verdict-card">
      {meta.demo && <DemoBanner />}
      <div className="verdict-head">
        <TrafficLight verdict={a.verdict} />
        <div>
          <div className={`verdict-label ${VERDICT_CLASS[a.verdict]}`}>{t(`verdict.${a.verdict}` as const)}</div>
          <div className="muted small">{t('verdict.sure', { level: dynamic(`confidence.${a.confidence}`, a.confidence) })}</div>
        </div>
      </div>
      {plain?.headline && <p className="verdict-headline">{plain.headline}</p>}
      {plain?.explanation ? <p className="ai-summary">{plain.explanation}</p> : !plain && <p className="ai-summary">{a.summary}</p>}
      {plain && (
        <div className="pros-cons">
          <PlainList title={t('verdict.pros')} items={plain.pros} tone="up" />
          <PlainList title={t('verdict.cons')} items={plain.cons} tone="down" />
        </div>
      )}
      {a.notes.length > 0 && (
        <div className="warn-note" role="note">
          <strong>{t('ai.notes')}:</strong>
          <ul>
            {a.notes.map((n) => {
              const text = msg(n);
              return <li key={text}>{text}</li>;
            })}
          </ul>
        </div>
      )}
      <p className="verdict-note">{t('verdict.note')}</p>
      <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
      {refresh.isError && <ErrorNote error={refresh.error} />}
    </div>
  );
}

function PlanRow({ label, hint, candidate, comment, empty }: { label: string; hint?: string; candidate: Candidate | null; comment: string; empty: string }) {
  const { t, dynamic } = useT();
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {hint && <div className="row-hint">{hint}</div>}
        {comment && <div className="row-hint">{comment}</div>}
      </div>
      <div className="row-value">
        {candidate ? (
          <>
            {range(candidate)}
            <div className="row-hint">
              {dynamic(`cand.${candidate.code}`, candidate.label, { zone: candidate.zoneId ?? '' })}
              {' · '}
              {t('plan.vsPrice', { pct: formatPercent(candidate.distancePercent) })}
            </div>
          </>
        ) : (
          <span className="muted">{empty}</span>
        )}
      </div>
    </div>
  );
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: 'up' | 'down' | 'warn' }) {
  const { t } = useT();
  return (
    <section className="group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <div className="row-hint pad">{t('ai.empty')}</div>
      ) : (
        <ul className={`bullets bullets-${tone}`}>
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Der fachliche Teil der Auswertung (Handelsplan und ausführliche Begründung) für den Bereich "Details für Fortgeschrittene". */
export function AdvancedAnalysis({ envelope, ticker, name }: { envelope?: TechnicalEnvelope; ticker: string; name?: string }) {
  const { t, dynamic } = useT();
  const refresh = useRefreshAnalysis('analysis', ticker, name);
  if (!envelope) return null;
  const { analysis: a, meta } = envelope;
  return (
    <div>
      <section className="group">
        <h3>{t('plan.title')}</h3>
        <p className="row-hint pad">{t('plan.intro')}</p>
        <PlanRow label={t('plan.entry')} hint={t('plan.entryHint')} candidate={a.entry.candidate} comment={a.entry.comment} empty={t('plan.noEntry')} />
        <PlanRow label={t('plan.stop')} hint={t('plan.stopHint')} candidate={a.stopLoss.candidate} comment={a.stopLoss.comment} empty={t('plan.noStop')} />
        {a.targets.length === 0 ? (
          <div className="row">
            <div className="row-label">{t('plan.targets')}</div>
            <div className="row-value muted">{t('common.none')}</div>
          </div>
        ) : (
          a.targets.map((tg, i) => <PlanRow key={tg.candidate.id} label={t('plan.target', { n: i + 1 })} candidate={tg.candidate} comment={tg.comment} empty="" />)
        )}
        <div className="row">
          <div className="row-label">
            {t('plan.riskReward')}
            <div className="row-hint">{t('plan.riskRewardHint')}</div>
          </div>
          <div className="row-value nowrap">{a.riskReward === null ? <span className="muted">{t('plan.notComputable')}</span> : `${formatNumber(a.riskReward, 2)} : 1`}</div>
        </div>
        <div className="row">
          <div className="row-label">
            {t('plan.horizon')}
            <div className="row-hint">{a.horizonComment}</div>
          </div>
          <div className="row-value">{dynamic(`horizon.${a.horizon}`, a.horizon)}</div>
        </div>
      </section>

      {a.summary && (
        <section className="group">
          <h3>{t('adv.analysis')}</h3>
          <p className="ai-summary pad-x">{a.summary}</p>
        </section>
      )}
      <Bullets title={t('adv.forTitle')} items={a.argumentsFor} tone="up" />
      <Bullets title={t('adv.againstTitle')} items={a.argumentsAgainst} tone="down" />
      <Bullets title={t('adv.risksTitle')} items={a.risks} tone="warn" />
      <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} advanced />
    </div>
  );
}

/** Fehlerdarstellung der KI-Auswertung: fehlender Key wird als Einrichtungshinweis erklärt, der Rest der Seite bleibt nutzbar. */
export function AiUnavailable({ error, onRetry }: { error: unknown; onRetry?: () => void }): ReactNode {
  const { t } = useT();
  if (error instanceof ApiError && error.code === 'AI_NOT_CONFIGURED') {
    return (
      <div className="info-note" role="note">
        <strong>{t('ai.notConfiguredTitle')}</strong> {t('ai.notConfiguredText')}
      </div>
    );
  }
  return <ErrorNote error={error} onRetry={onRetry} />;
}
