import { Component, StrictMode, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { AppConfig, User } from '@neugier/shared';
import { api } from './api';
import { App } from './App';
import { Login } from './pages/Login';
import { StoreProvider } from './store';
import { registerServiceWorker } from './serviceWorker';
import './styles.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('NEUGIER konnte nicht angezeigt werden', error, info); }

  render() {
    if (this.state.failed) {
      return (
        <div className="center">
          <div className="card narrow" role="alert">
            <h2>NEUGIER konnte nicht angezeigt werden.</h2>
            <p>Bitte versuche es erneut. Offline gespeicherte Änderungen bleiben erhalten.</p>
            <button className="btn" onClick={() => location.reload()}>Erneut versuchen</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<AppConfig>('/config')
      .then(setConfig)
      .catch(() => setConfig(JSON.parse(localStorage.getItem('neugier.config') ?? 'null')));
    api<User | null>('/me')
      .then(setUser)
      .catch(() => setUser(JSON.parse(localStorage.getItem('neugier.me') ?? 'null')));
  }, []);

  // Für den Offline-Start merken
  useEffect(() => {
    if (config) localStorage.setItem('neugier.config', JSON.stringify(config));
    if (user) localStorage.setItem('neugier.me', JSON.stringify(user));
  }, [config, user]);

  if (!config || user === undefined) return <div className="center muted">Lädt …</div>;
  if (!user) return <Login config={config} onLogin={setUser} />;
  if (user.role === 'pending') {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Hallo {user.name}!</h2>
          <p>Dein Konto wartet auf Freigabe durch einen Admin. Lade die Seite neu, sobald du freigeschaltet wurdest.</p>
          <button className="btn" onClick={() => api('/auth/logout', { method: 'POST' }).then(() => setUser(null))}>
            Abmelden
          </button>
        </div>
      </div>
    );
  }
  return (
    <StoreProvider config={config} user={user}>
      <App onLogout={() => setUser(null)} />
    </StoreProvider>
  );
}

// Service Worker nur im Produktions-Build (im Vite-Dev-Server würde er HMR stören)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', registerServiceWorker);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
