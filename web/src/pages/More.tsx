import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, History, Lightbulb, LogOut, Shield, Upload } from 'lucide-react';
import { KIND_ICON, placeLink, ROLE_LABEL } from '@neugier/shared';
import { api } from '../api';
import { EditableText } from './DayPage';
import { HistoryPanel } from '../components/HistoryPanel';
import { ImportDialog } from '../components/ImportDialog';
import { useTrip } from '../store';

export function More({ onLogout }: { onLogout: () => void }) {
  const { state, user, canEdit, apply, presence, trips, selectTrip } = useTrip();
  const [dialog, setDialog] = useState<'import' | 'history' | null>(null);
  const pool = state.stops.filter((s) => !s.dayId);
  const updateTrip = (patch: Record<string, unknown>) => apply([{ op: 'update', type: 'trip', id: state.trip.id, patch }], 'Reise bearbeitet');

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          {user.picture && <img className="avatar" src={user.picture} alt="" />}
          <div className="grow">
            <strong>{user.name}</strong>
            <div className="small muted">
              {user.email} · {ROLE_LABEL[user.role]}
            </div>
          </div>
          <button className="btn small" onClick={() => api('/auth/logout', { method: 'POST' }).then(onLogout)}>
            <LogOut size={14} /> Abmelden
          </button>
        </div>
        {presence.length > 0 && <p className="small muted">Gerade online: {[...new Set(presence.map((p) => p.name))].join(', ')}</p>}
      </div>

      {trips && trips.length > 1 && (
        <div className="card">
          <h3>Reise wählen</h3>
          <select value={state.trip.id} onChange={(e) => selectTrip(e.target.value)}>
            {trips?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card">
        <h3>Reise</h3>
        <label className="small muted">Name</label>
        <EditableText value={state.trip.name} placeholder="Name" disabled={!canEdit} onSave={(name) => updateTrip({ name })} />
        <label className="small muted">Region (für Ortssuche ohne Koordinaten)</label>
        <EditableText value={state.trip.region} placeholder="z. B. Neuseeland" disabled={!canEdit} onSave={(region) => updateTrip({ region })} />
        <label className="small muted">Infos & ToDos</label>
        <EditableText value={state.trip.notes} placeholder="Allgemeine Infos …" multiline disabled={!canEdit} onSave={(notes) => updateTrip({ notes })} />
      </div>

      <div className="card">
        <h3>
          <Lightbulb size={18} /> Ideen-Pool ({pool.length})
        </h3>
        <p className="small muted">Noch keinem Tag zugeordnet. In der Tagesansicht über „Aus Ideen" einplanen.</p>
        {pool.map((s) => (
          <div key={s.id} className="pool-item">
            <span>{KIND_ICON[s.kind]}</span>
            <div className="grow">
              <div>{s.name}</div>
              {s.notes && <div className="small muted">{s.notes}</div>}
            </div>
            {s.links[0] && (
              <a className="icon-btn" href={s.links[0]} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
              </a>
            )}
            <a className="icon-btn" href={placeLink(s, state.trip.region)} target="_blank" rel="noreferrer">
              📍
            </a>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h3>Daten</h3>
        <button className="btn" onClick={() => setDialog('history')}>
          <History size={16} /> Versionshistorie
        </button>
        {canEdit && (
          <button className="btn" onClick={() => setDialog('import')}>
            <Upload size={16} /> Import (Excel / JSON) mit Merge
          </button>
        )}
        <a className="btn" href={`/api/trips/${state.trip.id}/export.json`}>
          <Download size={16} /> Export (JSON)
        </a>
        <a className="btn" href={`/api/trips/${state.trip.id}/export/splid.csv`}>
          <Download size={16} /> Ausgaben für Splid (CSV)
        </a>
      </div>

      {user.role === 'admin' && (
        <Link className="btn primary" to="/admin">
          <Shield size={16} /> Admin-Dashboard
        </Link>
      )}

      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryPanel onClose={() => setDialog(null)} />}
    </div>
  );
}
