import { useState } from 'react';
import { Disclaimer } from '../components/ui';
import { api, ApiError, type HealthResponse } from '../lib/api';
import { appStorage, TOKEN_KEY } from '../lib/storage';
import { useWatchlist, watchlistStore } from '../lib/watchlist';

type TestResult = { ok: true; text: string } | { ok: false; text: string } | null;

export function SettingsScreen() {
  const [token, setToken] = useState(() => appStorage.getItem(TOKEN_KEY) ?? '');
  const [test, setTest] = useState<TestResult>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<HealthResponse['ai'] | null>(null);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const watch = useWatchlist();

  const saveToken = () => {
    const t = token.trim();
    try {
      if (t) appStorage.setItem(TOKEN_KEY, t);
      else appStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignorieren */
    }
    setToken(t);
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
      setTest({ ok: true, text: `Verbindung OK${health.authRequired ? ' (Token akzeptiert)' : ' (kein Token nötig)'}${q ? `, Beispielkurs AAPL: ${q.price}` : ''}` });
    } catch (e) {
      setTest({ ok: false, text: e instanceof ApiError ? `${e.message}${e.status === 401 ? '. Token prüfen.' : ''}` : 'Verbindung fehlgeschlagen' });
    } finally {
      setBusy(false);
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(watchlistStore.exportJson());
      setImportMsg('Watchlist in die Zwischenablage kopiert.');
    } catch {
      setImportText(watchlistStore.exportJson());
      setImportMsg('Kopieren nicht möglich: der Text steht unten und kann von dort markiert werden.');
    }
  };

  const runImport = () => {
    try {
      const n = watchlistStore.replaceAll(JSON.parse(importText));
      setImportMsg(`${n} Aktie${n === 1 ? '' : 'n'} importiert.`);
      setImportText('');
    } catch {
      setImportMsg('Der Text ist kein gültiger Export. Es wurde nichts geändert.');
    }
  };

  return (
    <main className="screen">
      <header className="large-header">
        <h1>Einstellungen</h1>
      </header>

      <section className="group">
        <h3>Zugriff</h3>
        <div className="pad">
          <label htmlFor="token" className="row-hint">
            Zugriffstoken (schützt die Daten-API, wird nur auf diesem Gerät gespeichert)
          </label>
          <input id="token" className="search-input" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Leer lassen, wenn keins gesetzt ist" />
          <div className="stack">
            <button type="button" className="btn" onClick={runTest} disabled={busy}>
              {busy ? 'Teste …' : 'Speichern und Verbindung testen'}
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
          <h3>KI-Auswertung</h3>
          <div className="pad">
            {ai.configured ? (
              <p>
                Aktiv: <strong>{ai.providers.join(' → ')}</strong>
                {ai.providers.includes('demo') && <span className="tone-down"> (Demo-Modus, keine echte KI)</span>}
              </p>
            ) : (
              <p className="tone-down">
                Nicht eingerichtet. Es fehlt ein KI-Key (<code>GEMINI_API_KEY</code> oder <code>GROQ_API_KEY</code>) auf dem Server.
              </p>
            )}
            <p className="row-hint">
              Zwischenspeicher: {ai.storage === 'supabase' ? 'Supabase (dauerhaft)' : 'nur Arbeitsspeicher des Servers'}.
              {ai.configured && ai.storage === 'memory' && ' Ohne Supabase gehen Auswertungen bei Kaltstarts verloren und verbrauchen das Gratis-Kontingent schneller.'}
            </p>
          </div>
        </section>
      )}

      <section className="group">
        <h3>Watchlist sichern</h3>
        <div className="pad">
          <p className="row-hint">
            Die Watchlist liegt in diesem Browser bzw. dieser installierten App ({watch.length} Aktie{watch.length === 1 ? '' : 'n'}). Die installierte iPhone-App hat einen
            eigenen Speicher, exportiere die Liste also aus Safari und importiere sie in der App. Später wird die Liste auf dem Server gespeichert.
          </p>
          <div className="stack">
            <button type="button" className="btn btn-secondary" onClick={copyExport} disabled={watch.length === 0}>
              Exportieren (kopieren)
            </button>
          </div>
          <textarea className="search-input mono" rows={4} placeholder="Export hier einfügen und importieren" value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="Import-Text" />
          <div className="stack">
            <button type="button" className="btn btn-secondary" onClick={runImport} disabled={!importText.trim()}>
              Importieren (ersetzt die Liste)
            </button>
          </div>
          {importMsg && <p role="status">{importMsg}</p>}
        </div>
      </section>

      <section className="group">
        <h3>Über die Daten</h3>
        <div className="pad">
          <ul className="plain">
            <li>Kurse und Kerzen: Yahoo Finance (inoffiziell), bei Ausfall İş Yatırım (BIST, nur Tagesschluss), US-Live-Kurse optional über Finnhub.</li>
            <li>BIST- und XETRA-Kurse sind ca. 15 Minuten verzögert. Für BIST gibt es kostenlos keine Echtzeitquelle.</li>
            <li>News: KAP (BIST-Pflichtmeldungen) und Google News.</li>
            <li>Kennzahlen der technischen Analyse werden im Code berechnet. Die KI (Gemini, Ausweichanbieter Groq) schreibt nur den Text dazu und darf keine Zahlen erfinden: Kurse wählt sie aus berechneten Kandidaten, andere Zahlen werden gegen die Eingabedaten geprüft.</li>
          </ul>
        </div>
      </section>

      <Disclaimer />
      <p className="row-hint pad">Version 0.4 · Phase 4</p>
    </main>
  );
}
