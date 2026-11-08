import { useState } from 'react';
import { ListTodo, X } from 'lucide-react';
import type { Todo } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { useTrip } from '../store';

export function TodoButton({ dayId, targetId, targetType, initialTitle }: { dayId: string | null; targetId: string; targetType: NonNullable<Todo['targetType']>; initialTitle: string }) {
  const { apply, toast } = useTrip();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const save = async () => {
    const todo: Todo = { id: newId(), dayId, targetId, targetType, title: title.trim(), done: false, createdAt: new Date().toISOString() };
    await apply([{ op: 'create', type: 'todo', data: todo }], 'Todo erstellt');
    setOpen(false);
    toast('Todo erstellt');
  };
  return <>
    <button className="icon-btn" title="Als Todo vormerken" aria-label={`${initialTitle} als Todo vormerken`} onClick={() => { setTitle(initialTitle); setOpen(true); }}><ListTodo size={16} /></button>
    {open && <div className="modal-bg" onClick={() => setOpen(false)}><div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="todo-dialog-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><h3 id="todo-dialog-title">Todo erstellen</h3><button className="icon-btn" title="Schließen" aria-label="Schließen" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <label>Aufgabe<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && title.trim()) void save(); }} /></label>
      <div className="modal-foot"><button className="btn" onClick={() => setOpen(false)}>Abbrechen</button><button className="btn primary" disabled={!title.trim()} onClick={() => void save()}>Todo speichern</button></div>
    </div></div>}
  </>;
}