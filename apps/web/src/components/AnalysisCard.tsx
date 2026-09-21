import type { Candidate, TechnicalAnalysis } from '@aktien/core';
import type { ReactNode } from 'react';
import { ApiError, type TechnicalEnvelope } from '../lib/api';
import { formatNumber, formatPercent, formatRelative } from '../lib/format';
import { useRefreshAnalysis } from '../lib/hooks';
import { Disclaimer, ErrorNote } from './ui';

const VERDICT: Record<TechnicalAnalysis['verdict'], { label: string; cls: string }> = {
  bullish: { label: 'Bullish', cls: 'verdict-up' },
  neutral: { label: 'Neutral', cls: 'verdict-flat' },
  bearish: { label: 'Bearish', cls: 'verdict-down' },
};

function range(c: Candidate): string {
  return c.low === c.high ? formatNumber(c.low) : `${formatNumber(c.low)} – ${formatNumber(c.high)}`;
}

function PlanRow({ label, candidate, comment, empty }: { label: string; candidate: Candidate | null; comment: string; empty: string }) {
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {comment && <div className="row-hint">{comment}</div>}
      </div>
      <div className="row-value">
        {candidate ? (
          <>
            {range(candidate)}
            <div className="row-hint">
              {candidate.label} · {formatPercent(candidate.distancePercent)} zum Kurs
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
  return (
    <section className="group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <div className="row-hint pad">Keine Angabe (Aussagen ohne belegte Zahlen wurden entfernt).</div>
      ) : (
        <ul className={`bullets bullets-${tone}`}>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Kennzeichnung von Herkunft und Aktualität einer KI-Auswertung samt Aktualisieren-Schaltfläche. */
export function AnalysisMetaLine({ meta, onRefresh, refreshing }: { meta: TechnicalEnvelope['meta']; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="meta-line">
      <div className="row-hint">
        Erstellt {formatRelative(meta.generatedAt)} · {meta.demo ? 'Demo' : `${meta.provider} (${meta.model})`}
        {meta.cached ? ' · aus dem Speicher' : ''}
        {meta.guardRemoved > 0 ? ` · ${meta.guardRemoved} Aussage(n) mit nicht belegten Zahlen entfernt` : ''}
      </div>
      {meta.note && <div className={`row-hint ${meta.stale ? 'tone-down' : ''}`}>{meta.note}</div>}
      <button type="button" className="btn btn-small btn-secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Berechne …' : 'Neu auswerten'}
      </button>
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="warn-note" role="note">
      <strong>Demo-Modus:</strong> Platzhaltertexte ohne echte KI. Es ist noch kein KI-Key eingerichtet.
    </div>
  );
}

export function AnalysisCard({ query, ticker, name }: { query: { data?: TechnicalEnvelope; error: unknown; isPending: boolean; isError: boolean; refetch: () => void }; ticker: string; name?: string }) {
  const refresh = useRefreshAnalysis('analysis', ticker, name);

  if (query.isPending) {
    return (
      <div className="center-note" role="status">
        <span className="spinner" aria-hidden /> KI-Einschätzung wird erstellt …
      </div>
    );
  }
  if (query.isError || !query.data) return <AiUnavailable error={query.error} onRetry={query.refetch} />;

  const { analysis: a, meta } = query.data;
  const v = VERDICT[a.verdict];
  return (
    <div>
      {meta.demo && <DemoBanner />}
      <section className="ai-head">
        <span className={`verdict ${v.cls}`}>{v.label}</span>
        <span className="muted">Sicherheit der Einschätzung: {a.confidence}</span>
      </section>
      <p className="ai-summary">{a.summary}</p>

      <section className="group">
        <h3>Möglicher Handelsplan (technisch)</h3>
        <PlanRow label="Einstiegszone" candidate={a.entry.candidate} comment={a.entry.comment} empty="kein Einstieg sinnvoll" />
        <PlanRow label="Stop-Loss" candidate={a.stopLoss.candidate} comment={a.stopLoss.comment} empty="nicht festgelegt" />
        {a.targets.length === 0 ? (
          <div className="row">
            <div className="row-label">Kursziele</div>
            <div className="row-value muted">keine</div>
          </div>
        ) : (
          a.targets.map((t, i) => <PlanRow key={t.candidate.id} label={`Kursziel ${i + 1}`} candidate={t.candidate} comment={t.comment} empty="" />)
        )}
        <div className="row">
          <div className="row-label">
            Chance-Risiko-Verhältnis
            <div className="row-hint">Rein rechnerisch aus Einstieg, Stop und erstem Ziel, keine Prognose.</div>
          </div>
          <div className="row-value nowrap">{a.riskReward === null ? <span className="muted">nicht berechenbar</span> : `${formatNumber(a.riskReward, 2)} : 1`}</div>
        </div>
        <div className="row">
          <div className="row-label">
            Zeithorizont
            <div className="row-hint">{a.horizonComment}</div>
          </div>
          <div className="row-value">{a.horizon}</div>
        </div>
      </section>

      <Bullets title="Argumente für einen Einstieg" items={a.argumentsFor} tone="up" />
      <Bullets title="Argumente dagegen" items={a.argumentsAgainst} tone="down" />
      <Bullets title="Risiken" items={a.risks} tone="warn" />

      {a.notes.length > 0 && (
        <div className="warn-note" role="note">
          <strong>Hinweise zur Auswertung:</strong>
          <ul>
            {a.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <AnalysisMetaLine meta={meta} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
      {refresh.isError && <ErrorNote error={refresh.error} />}
      <Disclaimer />
    </div>
  );
}

/** Fehlerdarstellung der KI-Auswertung: fehlender Key wird als Einrichtungshinweis erklärt, der Rest der Seite bleibt nutzbar. */
export function AiUnavailable({ error, onRetry }: { error: unknown; onRetry?: () => void }): ReactNode {
  if (error instanceof ApiError && error.code === 'AI_NOT_CONFIGURED') {
    return (
      <div className="info-note" role="note">
        <strong>KI-Auswertung noch nicht eingerichtet.</strong> Die technischen Kennzahlen unten funktionieren trotzdem. Für den KI-Text trägst du auf dem Server einen kostenlosen
        Gemini-Key als <code>GEMINI_API_KEY</code> ein (Anleitung in der README).
      </div>
    );
  }
  return <ErrorNote error={error} onRetry={onRetry} />;
}
