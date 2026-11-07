import type { TripExport, TripState } from '@neugier/shared';
import { fmtDate } from '@neugier/shared';

export function toJson(state: TripState): TripExport {
  return { format: 'neugier-trip', version: 1, exportedAt: new Date().toISOString(), ...state };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Ausgaben als CSV für Splid. Splid hat keine offizielle Import-API –
 * die Datei ist so aufgebaut, dass sie 1:1 abgetippt oder per Tabellen-Import übernommen werden kann.
 */
export function toSplidCsv(state: TripState): string {
  const dayById = new Map(state.days.map((d) => [d.id, d]));
  const header = ['Titel', 'Betrag', 'Währung', 'Bezahlt von', 'Für', 'Datum', 'Notiz'];
  const lines = [header.join(';')];
  for (const e of state.expenses) {
    if (e.amount == null) continue;
    const day = e.dayId ? dayById.get(e.dayId) : undefined;
    const forWhom = e.splitBetween.length ? e.splitBetween : state.trip.members;
    lines.push(
      [
        e.title,
        e.amount.toFixed(2).replace('.', ','),
        e.currency,
        e.paidBy,
        forWhom.join(', '),
        day?.date ?? '',
        e.note.replace(/\n/g, ' '),
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return '\uFEFF' + lines.join('\n');
}

/** Kurztext zum Teilen (z. B. in Splid oder Messenger einfügen). */
export function toSplidText(state: TripState): string {
  const dayById = new Map(state.days.map((d) => [d.id, d]));
  return state.expenses
    .filter((e) => e.amount != null)
    .map((e) => {
      const day = e.dayId ? dayById.get(e.dayId) : undefined;
      return `${day ? fmtDate(day.date, false) + ': ' : ''}${e.title} – ${e.amount} ${e.currency}${e.paidBy ? ` (bezahlt von ${e.paidBy})` : ''}`;
    })
    .join('\n');
}
