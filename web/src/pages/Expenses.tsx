import { useMemo, useState } from 'react';
import { Download, Plus, Trash } from 'lucide-react';
import type { Expense } from '@neugier/shared';
import { fmtDate, newId, sortedDays } from '@neugier/shared';
import { useTrip } from '../store';

/** Ausgaben pro Aktivität/Tag: wer hat gezahlt + Preis. Export nach Splid. */
export function Expenses() {
  const { state, canEdit, apply } = useTrip();
  const days = useMemo(() => sortedDays(state.days), [state.days]);
  const dayById = new Map(days.map((d) => [d.id, d]));
  const members = state.trip.members;
  const [newMember, setNewMember] = useState('');

  const list = [...state.expenses].sort((a, b) =>
    (dayById.get(a.dayId ?? '')?.date ?? '9').localeCompare(dayById.get(b.dayId ?? '')?.date ?? '9'),
  );

  const totals = new Map<string, number>();
  for (const e of list) if (e.amount != null) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
  const paid = new Map<string, Map<string, number>>();
  for (const e of list) {
    if (e.amount == null || !e.paidBy) continue;
    const m = paid.get(e.paidBy) ?? new Map();
    m.set(e.currency, (m.get(e.currency) ?? 0) + e.amount);
    paid.set(e.paidBy, m);
  }

  const update = (e: Expense, patch: Partial<Expense>) =>
    apply([{ op: 'update', type: 'expense', id: e.id, patch }], `Ausgabe bearbeitet: ${e.title}`);

  const add = () => {
    const e: Expense = {
      id: newId(),
      dayId: null,
      stopId: null,
      title: 'Neue Ausgabe',
      amount: null,
      currency: state.trip.currency,
      paidBy: '',
      splitBetween: [],
      note: '',
    };
    apply([{ op: 'create', type: 'expense', data: e }], 'Ausgabe hinzugefügt');
  };

  const addMember = () => {
    const n = newMember.trim();
    if (!n || members.includes(n)) return;
    apply([{ op: 'update', type: 'trip', id: state.trip.id, patch: { members: [...members, n] } }], `Mitreisende(r): ${n}`);
    setNewMember('');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Ausgaben</h2>
        <div className="row wrap">
          <a className="btn" href={`/api/trips/${state.trip.id}/export/splid.csv`}>
            <Download size={16} /> Splid (CSV)
          </a>
          {canEdit && (
            <button className="btn primary" onClick={add}>
              <Plus size={16} /> Ausgabe
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Mitreisende</h3>
        <div className="row wrap">
          {members.map((m) => (
            <span key={m} className="badge">
              {m}
            </span>
          ))}
          {members.length === 0 && <span className="muted small">Noch niemand eingetragen.</span>}
        </div>
        {canEdit && (
          <div className="row">
            <input placeholder="Name" value={newMember} onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
            <button className="btn" onClick={addMember}>
              Hinzufügen
            </button>
          </div>
        )}
        <p className="small muted">
          Summe: {[...totals].map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' · ') || '–'}
          {[...paid].map(([who, m]) => ` · ${who}: ${[...m].map(([c, v]) => `${v.toFixed(2)} ${c}`).join(', ')}`)}
        </p>
      </div>

      <div className="expense-list">
        {list.map((e) => (
          <div key={e.id} className="card expense">
            <div className="row">
              <input className="grow strong" disabled={!canEdit} defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && update(e, { title: ev.target.value })} />
              {canEdit && (
                <button className="icon-btn" title="Löschen" onClick={() => confirm('Ausgabe löschen?') && apply([{ op: 'delete', type: 'expense', id: e.id }], `Ausgabe gelöscht: ${e.title}`)}>
                  <Trash size={16} />
                </button>
              )}
            </div>
            <div className="row wrap">
              <input
                type="number"
                step="0.01"
                className="amount"
                placeholder="Betrag"
                disabled={!canEdit}
                defaultValue={e.amount ?? ''}
                onBlur={(ev) => {
                  const v = ev.target.value === '' ? null : Number(ev.target.value);
                  if (v !== e.amount) update(e, { amount: v });
                }}
              />
              <select disabled={!canEdit} value={e.currency} onChange={(ev) => update(e, { currency: ev.target.value })}>
                {['EUR', 'NZD', 'SGD', 'USD'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select disabled={!canEdit} value={e.paidBy} onChange={(ev) => update(e, { paidBy: ev.target.value })}>
                <option value="">bezahlt von …</option>
                {[...new Set([...members, e.paidBy].filter(Boolean))].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select disabled={!canEdit} value={e.dayId ?? ''} onChange={(ev) => update(e, { dayId: ev.target.value || null })}>
                <option value="">ohne Tag</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {fmtDate(d.date)} – {d.title.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>
            {members.length > 1 && (
              <div className="row wrap small">
                <span className="muted">Aufteilen auf:</span>
                {members.map((m) => (
                  <label key={m} className="check">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={e.splitBetween.length === 0 || e.splitBetween.includes(m)}
                      onChange={(ev) => {
                        const cur = e.splitBetween.length ? e.splitBetween : members;
                        const next = ev.target.checked ? [...cur, m] : cur.filter((x) => x !== m);
                        update(e, { splitBetween: next.length === members.length ? [] : next });
                      }}
                    />
                    {m}
                  </label>
                ))}
              </div>
            )}
            <textarea rows={1} placeholder="Notiz" disabled={!canEdit} defaultValue={e.note} onBlur={(ev) => ev.target.value !== e.note && update(e, { note: ev.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}
