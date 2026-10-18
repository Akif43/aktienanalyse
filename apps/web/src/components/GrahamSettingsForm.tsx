import { DEFAULT_GRAHAM_SETTINGS, type GrahamSettings } from '@aktien/core';
import { useState } from 'react';
import { grahamSettingsStore, useGrahamSettings } from '../lib/graham-store';
import { useT, type DictKey } from '../lib/i18n';

const FIELDS: { key: keyof GrahamSettings; label: DictKey }[] = [
  { key: 'riskFreeRate', label: 'graham.settings.riskFree' },
  { key: 'equityRiskPremium', label: 'graham.settings.erp' },
  { key: 'countryRiskBist', label: 'graham.settings.countryBist' },
  { key: 'bondYield', label: 'graham.settings.bondYield' },
  { key: 'safetyMargin', label: 'graham.settings.margin' },
  { key: 'safetyMarginHighDebt', label: 'graham.settings.marginHigh' },
];

const asText = (s: GrahamSettings): Record<keyof GrahamSettings, string> => Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<keyof GrahamSettings, string>;

/** Standardwerte der Graham-Bewertung (Zinsen, Prämien, Sicherheitsmarge), gelten für alle Aktien. */
export function GrahamSettingsForm() {
  const { t } = useT();
  const current = useGrahamSettings();
  const [values, setValues] = useState(() => asText(current));
  const [saved, setSaved] = useState(false);

  const save = () => {
    const next = { ...current };
    for (const f of FIELDS) {
      const n = Number(values[f.key].trim().replace(',', '.'));
      if (values[f.key].trim() !== '' && Number.isFinite(n)) next[f.key] = n;
    }
    grahamSettingsStore.set(next);
    setValues(asText(grahamSettingsStore.getSnapshot()));
    setSaved(true);
  };

  const reset = () => {
    grahamSettingsStore.reset();
    setValues(asText(DEFAULT_GRAHAM_SETTINGS));
    setSaved(false);
  };

  return (
    <section className="group">
      <h3>{t('graham.settings.title')}</h3>
      <div className="lot-form">
        <p className="row-hint">{t('graham.settings.hint')}</p>
        {FIELDS.map((f) => (
          <label className="lot-form-field" key={f.key}>
            <span className="row-hint">{t(f.label)}</span>
            <input
              className="search-input"
              inputMode="decimal"
              type="text"
              value={values[f.key]}
              onChange={(e) => {
                setSaved(false);
                setValues((v) => ({ ...v, [f.key]: e.target.value }));
              }}
            />
          </label>
        ))}
        <div className="stack">
          <button type="button" className="btn" onClick={save}>
            {saved ? t('graham.settings.saved') : t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={reset}>
            {t('graham.settings.reset')}
          </button>
        </div>
      </div>
    </section>
  );
}
