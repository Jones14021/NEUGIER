import { useState } from 'react';
import { MessageSquare, Pencil } from 'lucide-react';
import type { Comment } from '@neugier/shared';
import { api } from '../api';
import { useTrip } from '../store';

export function Comments({ targetId, compact }: { targetId: string; compact?: boolean }) {
  const { state, toast, canEdit } = useTrip();
  const list = state.comments.filter((c) => c.targetId === targetId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [open, setOpen] = useState(!compact);
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<Comment | null>(null);

  const save = async (id: string | undefined, t: string) => {
    try {
      await api(`/trips/${state.trip.id}/comments`, { body: { id, targetId, text: t } });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!open) {
    if (!canEdit && !list.length) return null;
    return (
      <button className="link small" onClick={() => setOpen(true)}>
        <MessageSquare size={14} /> {list.length ? `${list.length} Kommentar${list.length > 1 ? 'e' : ''}` : 'Kommentieren'}
      </button>
    );
  }

  return (
    <div className="comments">
      {list.map((c) =>
        edit?.id === c.id ? (
          <div key={c.id} className="row">
            <textarea rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            <button className="btn small primary" onClick={() => (save(c.id, edit.text), setEdit(null))}>
              OK
            </button>
          </div>
        ) : (
          <div key={c.id} className="comment">
            <span className="small">
              <strong>{c.author}</strong> {c.text}
              {c.updatedBy && c.updatedBy !== c.author && <span className="muted"> (bearb. {c.updatedBy})</span>}
            </span>
            {canEdit && <button className="icon-btn" title="Bearbeiten (leer = löschen)" onClick={() => setEdit(c)}>
              <Pencil size={14} />
            </button>}
          </div>
        ),
      )}
      {canEdit && <div className="row">
        <input
          placeholder="Kommentar …"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) save(undefined, text).then(() => setText(''));
          }}
        />
        <button className="btn small" disabled={!text.trim()} onClick={() => save(undefined, text).then(() => setText(''))}>
          Senden
        </button>
      </div>}
    </div>
  );
}
