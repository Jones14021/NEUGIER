import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Download, ExternalLink, History, Lightbulb, LogOut, Pencil, Plus, Shield, Trash, Upload } from 'lucide-react';
import type { Stop } from '@neugier/shared';
import { fmtDate, KIND_ICON, moveStopOps, newId, placeLink, ROLE_LABEL, sortedDays } from '@neugier/shared';
import { api } from '../api';
import { EditableText } from '../components/EditableText';
import { HistoryPanel } from '../components/HistoryPanel';
import { ImportDialog } from '../components/ImportDialog';
import { EditableRichText, RichTextView } from '../components/RichText';
import { StopEditor } from '../components/StopEditor';
import { useTrip } from '../store';

export function More({ onLogout }: { onLogout: () => void }) {
  const { state, user, canEdit, canPlan, apply, presence, trips, selectTrip } = useTrip();
  const [dialog, setDialog] = useState<'import' | 'history' | null>(null);
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
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {canPlan && (
        <div className="card">
          <h3>Reise</h3>
          <label className="small muted">Name</label>
          <EditableText value={state.trip.name} placeholder="Name" disabled={!canEdit} onSave={(name) => updateTrip({ name })} />
          <label className="small muted">Region (für Ortssuche ohne Koordinaten)</label>
          <EditableText value={state.trip.region} placeholder="z. B. Neuseeland" disabled={!canEdit} onSave={(region) => updateTrip({ region })} />
          <label className="small muted">Infos & ToDos</label>
          <EditableRichText value={state.trip.notes} placeholder="Allgemeine Infos, ToDos …" className="notes" disabled={!canEdit} onSave={(notes) => updateTrip({ notes })} />
        </div>
      )}

      {canPlan && <Ideas />}

      {canPlan && (
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
          <Link className="btn" to="/assistent">
            ✨ KI-Assistent
          </Link>
        </div>
      )}

      {!canPlan && (
        <div className="card small muted">
          Als Zuschauer siehst du die Reiseübersicht und die Erinnerungen. Für die Tagesplanung bitte einen Admin um die Rolle „Mitarbeiter“.
        </div>
      )}

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

/** Ideen-Pool: Stopps ohne Tag. Hinzufügen, bearbeiten, entfernen, einem Tag zuordnen. */
function Ideas() {
  const { state, canEdit, apply } = useTrip();
  const pool = state.stops.filter((s) => !s.dayId).sort((a, b) => a.order - b.order);
  const days = sortedDays(state.days);
  const [edit, setEdit] = useState<{ stop: Stop; isNew: boolean } | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);

  const newIdea = (): Stop => ({
    id: newId(),
    dayId: null,
    order: pool.length,
    scope: 'day',
    kind: 'sight',
    name: '',
    notes: '',
    time: '',
    duration: '',
    links: [],
    booking: '',
  });

  return (
    <div className="card">
      <div className="row">
        <h3 className="grow">
          <Lightbulb size={18} /> Ideen ({pool.length})
        </h3>
        {canEdit && (
          <button className="btn small primary" onClick={() => setEdit({ stop: newIdea(), isNew: true })}>
            <Plus size={14} /> Idee
          </button>
        )}
      </div>
      <p className="small muted">Noch keinem Tag zugeordnet. Mit 📅 einplanen, in der Tagesansicht über „Aus Ideen“.</p>
      {pool.length === 0 && <p className="small muted">Noch keine Ideen.</p>}
      {pool.map((s) => (
        <div key={s.id} className="pool-item">
          <span>{KIND_ICON[s.kind]}</span>
          <div className="grow">
            <div>{s.name}</div>
            {s.notes && <RichTextView text={s.notes} className="small muted" />}
            {planFor === s.id && (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  const dayId = e.target.value;
                  if (!dayId) return;
                  const count = state.stops.filter((x) => x.dayId === dayId).length;
                  apply(moveStopOps(state.stops, s.id, dayId, count), `Idee eingeplant: ${s.name}`);
                  setPlanFor(null);
                }}
                onBlur={() => setPlanFor(null)}
              >
                <option value="">Tag wählen …</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {fmtDate(d.date)} – {d.title.slice(0, 40)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {s.links[0] && (
            <a className="icon-btn" href={s.links[0]} target="_blank" rel="noreferrer" title="Link">
              <ExternalLink size={16} />
            </a>
          )}
          <a className="icon-btn" href={placeLink(s, state.trip.region)} target="_blank" rel="noreferrer" title="Google Maps">
            📍
          </a>
          {canEdit && (
            <>
              <button className="icon-btn" title="Einem Tag zuordnen" onClick={() => setPlanFor(s.id)}>
                <CalendarPlus size={16} />
              </button>
              <button className="icon-btn" title="Bearbeiten" onClick={() => setEdit({ stop: s, isNew: false })}>
                <Pencil size={16} />
              </button>
              <button
                className="icon-btn"
                title="Entfernen"
                onClick={() => confirm(`Idee „${s.name}“ entfernen?`) && apply([{ op: 'delete', type: 'stop', id: s.id }], `Idee entfernt: ${s.name}`)}
              >
                <Trash size={16} />
              </button>
            </>
          )}
        </div>
      ))}
      {edit && (
        <StopEditor
          stop={edit.stop}
          isNew={edit.isNew}
          onSave={(s) => {
            apply([edit.isNew ? { op: 'create', type: 'stop', data: s } : { op: 'put', type: 'stop', data: s }], edit.isNew ? `Idee: ${s.name}` : `Idee bearbeitet: ${s.name}`);
            setEdit(null);
          }}
          onDelete={
            edit.isNew
              ? undefined
              : () => {
                  apply([{ op: 'delete', type: 'stop', id: edit.stop.id }], `Idee entfernt: ${edit.stop.name}`);
                  setEdit(null);
                }
          }
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
