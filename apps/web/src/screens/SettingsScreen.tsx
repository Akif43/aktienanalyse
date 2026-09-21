import { useState } from 'react';
import { Disclaimer, Segmented } from '../components/ui';
import { api, ApiError, type HealthResponse } from '../lib/api';
import { LANG_OPTIONS, setLang, useT } from '../lib/i18n';
import { appStorage, TOKEN_KEY } from '../lib/storage';
import { useWatchlist, watchlistStore } from '../lib/watchlist';

type TestResult = { ok: boolean; text: string } | null;

export function SettingsScreen() {
  const { t, lang } = useT();
  const [token, setToken] = useState(() => appStorage.getItem(TOKEN_KEY) ?? '');
  const [test, setTest] = useState<TestResult>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<HealthResponse['ai'] | null>(null);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const watch = useWatchlist();
  const countText = watch.length === 1 ? t('settings.count.one') : t('settings.count.many', { n: watch.length });

  const saveToken = () => {
    const value = token.trim();
    try {
      if (value) appStorage.setItem(TOKEN_KEY, value);
      else appStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignorieren */
    }
    setToken(value);
  };

  const runTest = async () => {
    saveToken();
    setBusy(true);
    setTest(null);
    try {
      const health = await api.health();
      setAi(health.ai ?? null);
      const { results } = await api.quotes(['AAPL']);
      const q = results[0]?.quote;
      setTest({ ok: true, text: `${t('settings.connectionOk')}${health.authRequired ? t('settings.tokenAccepted') : t('settings.noTokenNeeded')}${q ? t('settings.exampleQuote', { price: q.price }) : ''}` });
    } catch (e) {
      setTest({ ok: false, text: `${t('settings.connectionFailed')}${e instanceof ApiError && e.status === 401 ? `.${t('settings.checkToken')}` : ''}` });
    } finally {
      setBusy(false);
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(watchlistStore.exportJson());
      setImportMsg(t('settings.copied'));
    } catch {
      setImportText(watchlistStore.exportJson());
      setImportMsg(t('settings.copyFailed'));
    }
  };

  const runImport = () => {
    try {
      const n = watchlistStore.replaceAll(JSON.parse(importText));
      setImportMsg(t('settings.imported', { n: n === 1 ? t('settings.count.one') : t('settings.count.many', { n }) }));
      setImportText('');
    } catch {
      setImportMsg(t('settings.importFailed'));
    }
  };

  return (
    <main className="screen">
      <header className="large-header">
        <h1>{t('settings.title')}</h1>
      </header>

      <section className="group">
        <h3>{t('settings.language')}</h3>
        <div className="pad">
          <Segmented options={LANG_OPTIONS} value={lang} label={t('settings.language')} onChange={setLang} />
          <p className="row-hint">{t('settings.languageHint')}</p>
        </div>
      </section>

      <section className="group">
        <h3>{t('settings.access')}</h3>
        <div className="pad">
          <label htmlFor="token" className="row-hint">
            {t('settings.tokenLabel')}
          </label>
          <input id="token" className="search-input" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('settings.tokenPlaceholder')} />
          <div className="stack">
            <button type="button" className="btn" onClick={runTest} disabled={busy}>
              {busy ? t('settings.testing') : t('settings.saveTest')}
            </button>
          </div>
          {test && (
            <p className={test.ok ? 'tone-up' : 'tone-down'} role="status">
              {test.text}
            </p>
          )}
        </div>
      </section>

      {ai && (
        <section className="group">
          <h3>{t('settings.aiTitle')}</h3>
          <div className="pad">
            {ai.configured ? (
              <p>
                {t('settings.aiActive', { providers: ai.providers.join(' → ') })}
                {ai.providers.includes('demo') && <span className="tone-down"> {t('settings.aiDemo')}</span>}
              </p>
            ) : (
              <p className="tone-down">{t('settings.aiMissing')}</p>
            )}
            <p className="row-hint">
              {ai.storage === 'supabase' ? t('settings.aiStorageSupabase') : t('settings.aiStorageMemory')}
              {ai.configured && ai.storage === 'memory' && t('settings.aiStorageWarn')}
            </p>
          </div>
        </section>
      )}

      <section className="group">
        <h3>{t('settings.backupTitle')}</h3>
        <div className="pad">
          <p className="row-hint">{t('settings.backupText', { count: countText })}</p>
          <div className="stack">
            <button type="button" className="btn btn-secondary" onClick={copyExport} disabled={watch.length === 0}>
              {t('settings.exportBtn')}
            </button>
          </div>
          <textarea className="search-input mono" rows={4} placeholder={t('settings.importPlaceholder')} value={importText} onChange={(e) => setImportText(e.target.value)} aria-label={t('settings.importAria')} />
          <div className="stack">
            <button type="button" className="btn btn-secondary" onClick={runImport} disabled={!importText.trim()}>
              {t('settings.importBtn')}
            </button>
          </div>
          {importMsg && <p role="status">{importMsg}</p>}
        </div>
      </section>

      <section className="group">
        <h3>{t('settings.aboutTitle')}</h3>
        <div className="pad">
          <ul className="plain">
            <li>{t('settings.about1')}</li>
            <li>{t('settings.about2')}</li>
            <li>{t('settings.about3')}</li>
            <li>{t('settings.about4')}</li>
          </ul>
        </div>
      </section>

      <Disclaimer />
      <p className="row-hint pad">{t('settings.version')}</p>
    </main>
  );
}
