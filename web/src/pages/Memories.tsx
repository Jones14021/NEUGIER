import { useMemo, useRef, useState } from 'react';
import { ImagePlus, Pencil, Trash } from 'lucide-react';
import type { Memory } from '@neugier/shared';
import { fmtDate, newId, sortedDays, todayIso } from '@neugier/shared';
import { uploadPhotos } from '../api';
import { findToday } from '../hooks';
import { useTrip } from '../store';

/** Fotos & Erinnerungen (auch rein textuell) – getrennt von der Planung. */
export function Memories() {
  const { state, canEdit, apply, user, toast } = useTrip();
  const days = useMemo(() => sortedDays(state.days), [state.days]);
  const [dayId, setDayId] = useState<string>(findToday(days)?.id ?? '');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dayById = new Map(days.map((d) => [d.id, d]));

  const list = [...state.memories].sort((a, b) => {
    const da = dayById.get(a.dayId ?? '')?.date ?? '';
    const db = dayById.get(b.dayId ?? '')?.date ?? '';
    return db.localeCompare(da) || b.createdAt.localeCompare(a.createdAt);
  });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      setPhotos([...photos, ...(await uploadPhotos(files))]);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const m: Memory = { id: newId(), dayId: dayId || null, text, photos, author: user.name, createdAt: new Date().toISOString() };
    apply([{ op: 'create', type: 'memory', data: m }], 'Erinnerung hinzugefügt');
    setText('');
    setPhotos([]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Erinnerungen</h2>
      </div>
      {canEdit && (
        <div className="card stack">
          <select value={dayId} onChange={(e) => setDayId(e.target.value)}>
            <option value="">Allgemein</option>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {fmtDate(d.date)} – {d.title.slice(0, 40)}
                {d.date === todayIso() ? ' (heute)' : ''}
              </option>
            ))}
          </select>
          <textarea rows={3} placeholder="Was habt ihr erlebt?" value={text} onChange={(e) => setText(e.target.value)} />
          {photos.length > 0 && (
            <div className="photo-grid">
              {photos.map((p) => (
                <img key={p} src={p} alt="" />
              ))}
            </div>
          )}
          <div className="row">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={16} /> {busy ? 'Lädt hoch …' : 'Fotos'}
            </button>
            <span className="grow" />
            <button className="btn primary" disabled={!text.trim() && !photos.length} onClick={save}>
              Speichern
            </button>
          </div>
        </div>
      )}
      {list.map((m) => {
        const d = m.dayId ? dayById.get(m.dayId) : undefined;
        return (
          <div key={m.id} className="card memory">
            <div className="row small muted">
              <span className="grow">
                {d ? `${fmtDate(d.date)} · ${d.title}` : 'Allgemein'} · {m.author}
              </span>
              {canEdit && (
                <>
                  <button className="icon-btn" onClick={() => setEditing(editing === m.id ? null : m.id)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => confirm('Erinnerung löschen?') && apply([{ op: 'delete', type: 'memory', id: m.id }], 'Erinnerung gelöscht')}>
                    <Trash size={14} />
                  </button>
                </>
              )}
            </div>
            {editing === m.id ? (
              <textarea
                autoFocus
                rows={4}
                defaultValue={m.text}
                onBlur={(e) => {
                  setEditing(null);
                  if (e.target.value !== m.text) apply([{ op: 'update', type: 'memory', id: m.id, patch: { text: e.target.value } }], 'Erinnerung bearbeitet');
                }}
              />
            ) : (
              m.text && <p className="pre">{m.text}</p>
            )}
            {m.photos.length > 0 && (
              <div className="photo-grid">
                {m.photos.map((p) => (
                  <a key={p} href={p} target="_blank" rel="noreferrer">
                    <img src={p} alt="" loading="lazy" />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {list.length === 0 && <p className="muted center-text">Noch keine Erinnerungen.</p>}
    </div>
  );
}
