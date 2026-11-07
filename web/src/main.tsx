import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { AppConfig, User } from '@neugier/shared';
import { api } from './api';
import { App } from './App';
import { Login } from './pages/Login';
import { StoreProvider } from './store';
import './styles.css';

function Root() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<AppConfig>('/config').then(setConfig);
    api<User | null>('/me').then(setUser);
  }, []);

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
