import { useEffect, useState } from 'react';
import { Trash } from 'lucide-react';
import type { Role, User } from '@neugier/shared';
import { ROLE_LABEL } from '@neugier/shared';
import { api } from '../api';
import { useStore } from '../store';

interface Settings {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKeySet: boolean;
}

/** Admin: Rollen vergeben (Zuschauer/Mitarbeiter/Admin) und KI-Einstellungen. */
export function Admin() {
  const { user: me, toast, reload } = useStore();
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');

  const load = () => {
    api<User[]>('/admin/users').then(setUsers);
    api<Settings>('/admin/settings').then(setSettings);
  };
  useEffect(load, []);

  const setRole = async (u: User, role: Role) => {
    await api(`/admin/users/${u.id}`, { method: 'PUT', body: { role } });
    toast(`${u.name}: ${ROLE_LABEL[role]}`);
    load();
  };

  const remove = async (u: User) => {
    if (!confirm(`${u.name} entfernen?`)) return;
    await api(`/admin/users/${u.id}`, { method: 'DELETE' });
    load();
  };

  const saveSettings = async () => {
    await api('/admin/settings', { method: 'PUT', body: { llmBaseUrl: settings!.llmBaseUrl, llmModel: settings!.llmModel, llmApiKey: apiKey || undefined } });
    setApiKey('');
    toast('Gespeichert');
    load();
    reload();
  };

  const pending = users.filter((u) => u.role === 'pending');

  return (
    <div className="page">
      <div className="page-head">
        <h2>Admin</h2>
      </div>

      {pending.length > 0 && (
        <div className="card highlight">
          <h3>Warten auf Freigabe ({pending.length})</h3>
          {pending.map((u) => (
            <div key={u.id} className="row wrap user-row">
              <span className="grow">
                <strong>{u.name}</strong> <span className="small muted">{u.email}</span>
              </span>
              <button className="btn small" onClick={() => setRole(u, 'viewer')}>
                Zuschauer
              </button>
              <button className="btn small primary" onClick={() => setRole(u, 'editor')}>
                Mitarbeiter
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Nutzer</h3>
        <p className="small muted">Zuschauer: lesen + kommentieren. Mitarbeiter: planen & bearbeiten. Admin: zusätzlich Nutzer & Einstellungen.</p>
        {users.map((u) => (
          <div key={u.id} className="row user-row">
            {u.picture ? <img className="avatar" src={u.picture} alt="" /> : <span className="avatar ph">{u.name[0]}</span>}
            <span className="grow">
              <strong>{u.name}</strong>
              <div className="small muted">{u.email}</div>
            </span>
            <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole(u, e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {u.id !== me.id && (
              <button className="icon-btn" onClick={() => remove(u)}>
                <Trash size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      {settings && (
        <div className="card stack">
          <h3>KI-Assistent</h3>
          <p className="small muted">
            OpenAI-kompatible API. Für GitHub Copilot / GitHub Models: Basis-URL <code>https://models.github.ai/inference</code>, Modell z. B.{' '}
            <code>openai/gpt-4.1</code>, API-Key = GitHub Personal Access Token mit Berechtigung „models:read".
          </p>
          <label>
            Basis-URL
            <input value={settings.llmBaseUrl} onChange={(e) => setSettings({ ...settings, llmBaseUrl: e.target.value })} />
          </label>
          <label>
            Modell
            <input value={settings.llmModel} onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })} />
          </label>
          <label>
            API-Key {settings.llmApiKeySet && <span className="badge green">hinterlegt</span>}
            <input type="password" placeholder={settings.llmApiKeySet ? '•••••• (leer lassen = unverändert)' : 'API-Key'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <button className="btn primary" onClick={saveSettings}>
            Speichern
          </button>
        </div>
      )}
    </div>
  );
}
