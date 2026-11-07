import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash } from 'lucide-react';
import type { Expense } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { useTrip } from '../store';

const CURRENCIES = ['EUR', 'NZD', 'SGD', 'USD'];

/** Ausgaben des Tages: schnell hinzufügen, bearbeiten, entfernen. Gesamtübersicht bleibt unter "Ausgaben". */
export function DayExpenses({ dayId }: { dayId: string }) {
  const { state, canEdit, apply } = useTrip();
  const list = state.expenses.filter((e) => e.dayId === dayId);
  const members = state.trip.members;
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(state.trip.currency);
  const [paidBy, setPaidBy] = useState('');

  const totals = new Map<string, number>();
  for (const e of list) if (e.amount != null) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);

  const add = () => {
    if (!title.trim()) return;
    const e: Expense = {
      id: newId(),
      dayId,
      stopId: null,
      title: title.trim(),
      amount: amount === '' ? null : Number(amount.replace(',', '.')),
      currency,
      paidBy,
      splitBetween: [],
      note: '',
    };
    apply([{ op: 'create', type: 'expense', data: e }], `Ausgabe: ${e.title}`);
    setTitle('');
    setAmount('');
  };

  const update = (e: Expense, patch: Partial<Expense>) => apply([{ op: 'update', type: 'expense', id: e.id, patch }], `Ausgabe bearbeitet: ${e.title}`);

  return (
    <div className="day-expenses">
      {list.map((e) => (
        <div key={e.id} className="exp-row">
          <input className="grow" disabled={!canEdit} defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && update(e, { title: ev.target.value })} />
          <input
            className="exp-amount"
            inputMode="decimal"
            disabled={!canEdit}
            defaultValue={e.amount ?? ''}
            placeholder="Betrag"
            onBlur={(ev) => {
              const v = ev.target.value === '' ? null : Number(ev.target.value.replace(',', '.'));
              if (v !== e.amount) update(e, { amount: v });
            }}
          />
          <select className="exp-cur" disabled={!canEdit} value={e.currency} onChange={(ev) => update(e, { currency: ev.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="exp-who" disabled={!canEdit} value={e.paidBy} onChange={(ev) => update(e, { paidBy: ev.target.value })}>
            <option value="">wer?</option>
            {[...new Set([...members, e.paidBy].filter(Boolean))].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          {canEdit && (
            <button className="icon-btn" title="Entfernen" onClick={() => apply([{ op: 'delete', type: 'expense', id: e.id }], `Ausgabe entfernt: ${e.title}`)}>
              <Trash size={16} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="exp-row new">
          <input className="grow" placeholder="Neue Ausgabe (z. B. Eintritt)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input className="exp-amount" inputMode="decimal" placeholder="Betrag" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <select className="exp-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="exp-who" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">wer?</option>
            {members.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button className="icon-btn nav" title="Hinzufügen" disabled={!title.trim()} onClick={add}>
            <Plus size={16} />
          </button>
        </div>
      )}
      <div className="row small muted">
        <span className="grow">{[...totals].map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' · ') || 'Noch keine Ausgaben'}</span>
        <Link to="/ausgaben" className="link">
          Alle Ausgaben →
        </Link>
      </div>
    </div>
  );
}
