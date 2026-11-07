import { useEffect, useRef, useState } from 'react';
import type { AppConfig, User } from '@neugier/shared';
import { api } from '../api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export function Login({ config, onLogin }: { config: AppConfig; onLogin: (u: User) => void }) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!config.googleClientId) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google!.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (r) =>
          api<User>('/auth/google', { body: { credential: r.credential } })
            .then(onLogin)
            .catch((e) => setError(e.message)),
      });
      window.google!.accounts.id.renderButton(btnRef.current!, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'de',
        shape: 'pill',
      });
    };
    document.head.appendChild(s);
  }, [config.googleClientId, onLogin]);

  const devLogin = (e: React.FormEvent) => {
    e.preventDefault();
    api<User>('/auth/dev', { body: { email, name } })
      .then(onLogin)
      .catch((err) => setError(err.message));
  };

  return (
    <div className="center">
      <div className="card narrow login">
        <img src="/icon.svg" alt="" width={64} height={64} />
        <h1>NEUGIER</h1>
        <p className="muted">Neues entdecken. Unterwegs gemeinsam Ideen erleben. Reisen.</p>
        {config.googleClientId && <div ref={btnRef} className="gbtn" />}
        {config.devLogin && (
          <form onSubmit={devLogin} className="stack">
            <p className="muted small">Entwicklungs-Login (ohne Google)</p>
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary">Anmelden</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
