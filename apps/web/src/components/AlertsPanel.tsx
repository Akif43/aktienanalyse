import { ALERT_RULE_TYPES, THRESHOLD_RULE_TYPES, type AlertRule, type AlertRuleType } from '@aktien/core';
import { useEffect, useState } from 'react';
import { useAlerts, useSaveAlerts } from '../lib/hooks';
import { useT, type DictKey } from '../lib/i18n';
import { Chip, ErrorNote, Spinner } from './ui';

interface RowState {
  enabled: boolean;
  /** Nur bei Schwellenwert-Typen genutzt, als Text (Komma oder Punkt erlaubt). */
  threshold: string;
}

type Rows = Record<AlertRuleType, RowState>;

function emptyRows(): Rows {
  return Object.fromEntries(ALERT_RULE_TYPES.map((type) => [type, { enabled: false, threshold: '' }])) as Rows;
}

function fromServer(rules: readonly AlertRule[]): Rows {
  const rows = emptyRows();
  for (const r of rules) rows[r.type] = { enabled: r.enabled, threshold: r.threshold !== undefined ? String(r.threshold) : '' };
  return rows;
}

const needsThreshold = (type: AlertRuleType) => (THRESHOLD_RULE_TYPES as readonly string[]).includes(type);

/** `null` für leere oder ungültige Eingaben, statt `Number('')` stillschweigend als 0 durchgehen zu lassen. */
function parseThreshold(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Alarmregeln je Aktie: fünf ein-/ausschaltbare Regeltypen, drei davon mit Zahlenfeld. Wird serverseitig
 * (Supabase, über /api/alerts) gespeichert, nicht im Browser, damit `scripts/monitor.ts` sie lesen kann.
 */
export function AlertsPanel({ ticker, currency }: { ticker: string; currency?: string }) {
  const { t } = useT();
  const { data, isPending, isError, error, refetch } = useAlerts(ticker);
  const save = useSaveAlerts(ticker);
  const [rows, setRows] = useState<Rows>(emptyRows);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setRows(fromServer(data.rules));
  }, [data]);

  const toggle = (type: AlertRuleType) => {
    setSaved(false);
    setRows((r) => ({ ...r, [type]: { ...r[type], enabled: !r[type].enabled } }));
  };
  const setThreshold = (type: AlertRuleType, value: string) => {
    setSaved(false);
    setRows((r) => ({ ...r, [type]: { ...r[type], threshold: value } }));
  };

  const invalidTypes = ALERT_RULE_TYPES.filter((type) => rows[type].enabled && needsThreshold(type) && parseThreshold(rows[type].threshold) === null);
  const canSave = invalidTypes.length === 0;

  const handleSave = () => {
    if (!canSave) return;
    const rules: AlertRule[] = ALERT_RULE_TYPES.map((type) => {
      const threshold = needsThreshold(type) ? parseThreshold(rows[type].threshold) : null;
      return { id: `${ticker}:${type}`, ticker, type, enabled: rows[type].enabled, ...(threshold !== null ? { threshold } : {}) };
    });
    save.mutate(rules, { onSuccess: () => setSaved(true) });
  };

  if (isPending) return <Spinner label={t('common.loading')} />;
  if (isError) return <ErrorNote error={error} onRetry={() => refetch()} />;

  return (
    <section className="group">
      <p className="row-hint pad">{t('alerts.intro')}</p>
      {ALERT_RULE_TYPES.map((type) => (
        <div className="row" key={type}>
          <div className="row-label">{t(`alerts.${type}` as DictKey)}</div>
          <div className="row-value alerts-row-value">
            {needsThreshold(type) && rows[type].enabled && (
              <input
                className="search-input alerts-threshold"
                inputMode="decimal"
                type="text"
                value={rows[type].threshold}
                onChange={(e) => setThreshold(type, e.target.value)}
                placeholder={type === 'dailyMove' ? '%' : currency ?? ''}
                aria-label={t(`alerts.${type}` as DictKey)}
              />
            )}
            <Chip active={rows[type].enabled} onClick={() => toggle(type)}>
              {rows[type].enabled ? t('alerts.on') : t('alerts.off')}
            </Chip>
          </div>
        </div>
      ))}
      {!canSave && <p className="row-hint pad">{t('alerts.thresholdMissing')}</p>}
      <div className="stack">
        <button type="button" className="btn" onClick={handleSave} disabled={!canSave || save.isPending}>
          {save.isPending ? t('common.loading') : saved ? t('alerts.saved') : t('alerts.save')}
        </button>
      </div>
      {save.isError && <ErrorNote error={save.error} />}
      <p className="row-hint pad">{t('alerts.disclaimer')}</p>
    </section>
  );
}
