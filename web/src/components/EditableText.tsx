import { useEffect, useState } from 'react';

/** Einzeiliger Text, der per Klick bearbeitet wird (für Titel, Termine etc.). */
export function EditableText(p: { value: string; placeholder: string; className?: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(p.value);
  useEffect(() => {
    if (!editing) setV(p.value);
  }, [p.value, editing]);

  if (!editing || p.disabled) {
    return (
      <div className={`editable ${p.className ?? ''}${p.disabled ? '' : ' can'}`} onClick={() => !p.disabled && setEditing(true)}>
        {p.value || <span className="muted">{p.disabled ? '' : p.placeholder}</span>}
      </div>
    );
  }
  const done = () => {
    setEditing(false);
    if (v !== p.value) p.onSave(v);
  };
  return <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && done()} />;
}
