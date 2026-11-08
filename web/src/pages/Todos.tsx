import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash } from 'lucide-react';
import type { Todo } from '@neugier/shared';
import { fmtDate, newId } from '@neugier/shared';
import { useTrip } from '../store';

export function Todos() {
  const { state, apply } = useTrip();
  const [title, setTitle] = useState('');
  const items = [...(state.todos ?? [])].sort((first, second) => Number(first.done) - Number(second.done) || first.createdAt.localeCompare(second.createdAt));
  const add = () => {
    if (!title.trim()) return;
    const todo: Todo = { id: newId(), dayId: null, targetId: null, targetType: null, title: title.trim(), done: false, createdAt: new Date().toISOString() };
    void apply([{ op: 'create', type: 'todo', data: todo }], 'Todo erstellt');
    setTitle('');
  };
  return <div className="page">
    <div className="page-head"><h2>Todos</h2><span className="small muted">{items.filter((todo) => !todo.done).length} offen</span></div>
    <div className="row"><input aria-label="Neues Todo" placeholder="Neues Todo" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); }} /><button className="icon-btn" title="Todo hinzufügen" aria-label="Todo hinzufügen" disabled={!title.trim()} onClick={add}><Plus size={18} /></button></div>
    {!items.length && <p className="muted">Keine Todos vorhanden.</p>}
    <div className="todo-list">{items.map((todo) => {
      const day = state.days.find((item) => item.id === todo.dayId);
      return <div className={`todo-item${todo.done ? ' done' : ''}`} key={todo.id}>
        <input type="checkbox" checked={todo.done} aria-label={`${todo.title} erledigt`} onChange={(event) => void apply([{ op: 'update', type: 'todo', id: todo.id, patch: { done: event.target.checked } }], 'Todo geändert')} />
        <div className="grow"><input className="todo-title" aria-label="Todo bearbeiten" defaultValue={todo.title} key={`${todo.id}:${todo.title}`} onBlur={(event) => {
          const value = event.target.value.trim();
          if (value && value !== todo.title) void apply([{ op: 'update', type: 'todo', id: todo.id, patch: { title: value } }], 'Todo bearbeitet');
          else event.target.value = todo.title;
        }} />{day && <Link className="small muted" to={`/tag/${day.id}`}>{fmtDate(day.date)} · {day.title}</Link>}</div>
        <button className="icon-btn" title="Todo löschen" aria-label={`${todo.title} löschen`} onClick={() => { if (confirm('Todo löschen?')) void apply([{ op: 'delete', type: 'todo', id: todo.id }], 'Todo gelöscht'); }}><Trash size={16} /></button>
      </div>;
    })}</div>
  </div>;
}