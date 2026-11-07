import { useEffect, useState } from 'react';
import { Download, Trash, Upload } from 'lucide-react';
import type { Role, User } from '@neugier/shared';
import { ROLE_LABEL } from '@neugier/shared';
import { api } from '../api';
import { useStore } from '../store';

interface Settings {
  llmProvider: 'copilot' | 'openai';
  llmBaseUrl: string;
  llmModel: string;
  llmApiKeySet: boolean;
  webSearch: 'off' | 'on' | 'tavily' | 'native';
  searchApiKeySet: boolean;
}

/** Admin: Rollen vergeben (Zuschauer/Mitarbeiter/Admin) und KI-Einstellungen. */
export function Admin() {
  const { user: me, toast, reload } = useStore();
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [searchKey, setSearchKey] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

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
    await api('/admin/settings', {
      method: 'PUT',
      body: {
        llmProvider: settings!.llmProvider,
        llmBaseUrl: settings!.llmBaseUrl,
        llmModel: settings!.llmModel,
        llmApiKey: apiKey || undefined,
        webSearch: settings!.webSearch,
        searchApiKey: searchKey || undefined,
      },
    });
    setApiKey('');
    setSearchKey('');
    toast('Gespeichert');
    load();
    reload();
  };

  const pending = users.filter((u) => u.role === 'pending');

  const restoreBackup = async (file: File) => {
    if (!confirm('Die gesamte Datenbank einschließlich Nutzer und Einstellungen wird ersetzt. Vorher sichern und ausstehende Offline-Änderungen aller Geräte synchronisieren. Fortfahren?')) return;
    setBackupBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/admin/backup/restore', { form });
      window.location.reload();
    } catch (error) {
      toast((error as Error).message);
      setBackupBusy(false);
    }
  };

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

      <div className="card stack">
        <h3>Datenbank-Backup</h3>
        <p className="small muted">Enthält auch Nutzer, Sitzungen und API-Schlüssel. Fotos und andere hochgeladene Dateien sind nicht enthalten.</p>
        <div className="row wrap">
          <a className="btn" href="/api/admin/backup" download><Download size={16} /> Backup herunterladen</a>
          <label className="btn file">
            <Upload size={16} /> {backupBusy ? 'Wiederherstellung …' : 'Backup wiederherstellen'}
            <input type="file" accept=".db,.sqlite,.sqlite3" hidden disabled={backupBusy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void restoreBackup(file);
            }} />
          </label>
        </div>
      </div>

      {settings && (
        <div className="card stack">
          <h3>KI-Assistent</h3>
          <label>
            Anbieter
            <select value={settings.llmProvider} onChange={(e) => {
              const llmProvider = e.target.value as Settings['llmProvider'];
              setSettings({ ...settings, llmProvider, llmModel: llmProvider === 'copilot' ? 'auto' : 'gpt-4o-mini', webSearch: settings.webSearch === 'off' ? 'off' : llmProvider === 'copilot' ? 'on' : 'tavily' });
            }}>
              <option value="copilot">GitHub Copilot (Copilot-Abo, eingebaute Websuche)</option>
              <option value="openai">OpenAI-kompatible API (OpenAI, Azure AI Foundry, Ollama …)</option>
            </select>
          </label>
          {settings.llmProvider === 'copilot' ? (
            <p className="small muted">
              API-Key = GitHub <strong>Fine-grained Personal Access Token</strong> mit der Berechtigung „Copilot Requests“. Modell z. B. <code>auto</code>,{' '}
              <code>gpt-5</code> oder <code>claude-sonnet-4.5</code>.
            </p>
          ) : (
            <label>
              Basis-URL
              <input value={settings.llmBaseUrl} onChange={(e) => setSettings({ ...settings, llmBaseUrl: e.target.value })} />
            </label>
          )}
          <label>
            Modell
            <input value={settings.llmModel} onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })} />
          </label>
          <label>
            {settings.llmProvider === 'copilot' ? 'GitHub-Token' : 'API-Key'} {settings.llmApiKeySet && <span className="badge green">hinterlegt</span>}
            <input
              type="password"
              placeholder={settings.llmApiKeySet ? '•••••• (leer lassen = unverändert)' : settings.llmProvider === 'copilot' ? 'github_pat_…' : 'API-Key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label>
            Websuche
            <select value={settings.webSearch} onChange={(e) => setSettings({ ...settings, webSearch: e.target.value as Settings['webSearch'] })}>
              <option value="off">Aus</option>
              {settings.llmProvider === 'copilot' ? (
                <option value="on">An (Copilot web_search + web_fetch)</option>
              ) : (
                <>
                  <option value="tavily">Tavily (funktioniert mit jedem Modell mit Tool-Calling)</option>
                  <option value="native">Native Websuche des Modells (z. B. OpenAI gpt-4o-search-preview)</option>
                </>
              )}
            </select>
          </label>
          {settings.llmProvider === 'openai' && settings.webSearch === 'tavily' && (
            <label>
              Tavily API-Key {settings.searchApiKeySet && <span className="badge green">hinterlegt</span>}
              <input
                type="password"
                placeholder={settings.searchApiKeySet ? '•••••• (leer lassen = unverändert)' : 'tvly-…'}
                value={searchKey}
                onChange={(e) => setSearchKey(e.target.value)}
              />
            </label>
          )}
          <p className="small muted">Anleitung: docs/ENTWICKLER.md → „KI-Assistent mit Websuche“.</p>
          <button className="btn primary" onClick={saveSettings}>
            Speichern
          </button>
        </div>
      )}
    </div>
  );
}
