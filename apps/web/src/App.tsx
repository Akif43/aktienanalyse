import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { TabBar } from './components/ui';
import { AUTHORIZED_EVENT, UNAUTHORIZED_EVENT } from './lib/api';
import { DetailScreen } from './screens/DetailScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WatchlistScreen } from './screens/WatchlistScreen';

/** Fängt unerwartete Darstellungsfehler ab, damit nie ein leerer weißer Bildschirm bleibt. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI-Fehler', error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen">
        <div className="error-note" role="alert">
          <strong>Unerwarteter Fehler in der App.</strong>
          <div className="muted">{this.state.error.message}</div>
          <button type="button" className="btn btn-small" onClick={() => location.reload()}>
            App neu laden
          </button>
        </div>
      </main>
    );
  }
}

function UnauthorizedBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(true);
    const off = () => setShow(false);
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    window.addEventListener(AUTHORIZED_EVENT, off);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, on);
      window.removeEventListener(AUTHORIZED_EVENT, off);
    };
  }, []);
  if (!show) return null;
  return (
    <div className="banner" role="alert">
      Zugriffstoken fehlt oder ist falsch. <Link to="/einstellungen">Einstellungen öffnen</Link>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <UnauthorizedBanner />
      <Routes>
        <Route path="/" element={<WatchlistScreen />} />
        <Route path="/s/:ticker" element={<DetailScreen />} />
        <Route path="/suche" element={<SearchScreen />} />
        <Route path="/einstellungen" element={<SettingsScreen />} />
        <Route
          path="*"
          element={
            <main className="screen">
              <div className="center-note">Seite nicht gefunden.</div>
              <Link to="/" className="btn">
                Zur Watchlist
              </Link>
            </main>
          }
        />
      </Routes>
      <TabBar />
    </ErrorBoundary>
  );
}
