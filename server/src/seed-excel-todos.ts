import type { Op, Todo, TripState } from '@neugier/shared';
import { newId } from '@neugier/shared';

const tasks = [
  ['uretiti', '2026-12-17', 'camp', 'Uretiti nach Feststehen der Camper-Abholzeit buchen oder Freedom-Alternative wählen'],
  ['woolleys-alternative', '2026-12-18', 'camp', 'Alternative zu Woolleys Bay Western Carpark suchen'],
  ['woolleys-tides', '2026-12-18', 'camp', 'Gezeiten für Woolleys Bay prüfen'],
  ['hobbiton', '2026-12-21', 'act', 'Tickets für die dreistündige Hobbiton-Tour buchen'],
  ['tongariro', '2026-12-23', 'act', 'Tongariro-Shuttle vom Ketetahi-Parkplatz nach Mangatepopo reservieren'],
  ['glowworms', '2026-12-26', 'day', 'Glühwürmchentour buchen'],
  ['henry-peak', '2026-12-27', 'act', 'Wanderroute und Parkplatz für Henry Peak prüfen'],
  ['abel-tasman', '2026-12-31', 'act', 'Weitere Abel-Tasman-Bucht und Wassertaxi auswählen'],
  ['west-coast', '2027-01-02', 'act', 'Programm an der Westküste festlegen'],
  ['spontaneous-camp', '2027-01-03', 'day', 'Campingplatz wie geplant spontan festlegen'],
  ['cascade-creek', '2027-01-09', 'camp', 'Campingplatz Cascade Creek buchen'],
  ['milford-activity', '2027-01-09', 'day', 'Milford-Sound-Aktivität vorab organisieren'],
  ['milford-walk', '2027-01-10', 'act', 'Milford-Wanderung und Wassertaxi-Logistik prüfen; Hooker-Trail-Notiz klären'],
  ['luggage', '2027-01-16', 'act', 'Gepäck vor der Camperrückgabe zur Unterkunft bringen'],
  ['singapore-taxi', '2027-01-17', 'day', 'Nächtlichen Taxi-Transfer zum Hotel in Singapur planen'],
] as const;

export function excelTodoOps(state: TripState): Op[] {
  const ops: Op[] = [];
  const existing = state.todos ?? [];
  for (const [taskId, date, targetKind, title] of tasks) {
    const day = state.days.find((item) => item.date === date);
    if (!day) continue;
    const target = targetKind === 'day' ? day : state.stops.find((item) => item.key === `xl:${targetKind}:${date}` && item.dayId === day.id);
    if (!target) continue;
    const key = `todo:excel:${taskId}`;
    if (existing.some((todo) => todo.key === key || (todo.targetId === target.id && todo.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase()))) continue;
    const data: Todo = {
      id: newId(), key, dayId: day.id, targetId: target.id, targetType: targetKind === 'day' ? 'day' : 'stop',
      title, done: false, createdAt: new Date().toISOString(),
    };
    ops.push({ op: 'create', type: 'todo', data });
  }
  return ops;
}