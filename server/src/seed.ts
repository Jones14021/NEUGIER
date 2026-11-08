import type { Trip, TypedEntity } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { setSetting } from './db';
import { replaceWithImport } from './importers/replace';
import { applyOps, getState, listTrips } from './store';
import { excelTodoOps } from './seed-excel-todos';
import seedExcel from './seed-excel.json';

export function seedIfEmpty(): void {
  if (listTrips().length) return;
  const tripId = newId();
  applyOps(tripId, [{ op: 'create', type: 'trip', data: {
    id: tripId,
    name: 'Neuseeland 2026/27',
    region: 'Neuseeland',
    startDate: '2026-12-14',
    endDate: '2027-01-20',
    currency: 'EUR',
    members: [],
    notes: '',
  } as Trip }], {
    userName: 'System',
    userId: '',
    source: 'seed',
    label: 'Reise angelegt',
  });
  replaceWithImport(getState(tripId)!, seedExcel as TypedEntity[]);
  applyOps(tripId, excelTodoOps(getState(tripId)!), {
    userName: 'Excel-Import', userId: '', source: 'import', label: 'Offene Aufgaben aus Excel',
  });
  setSetting('seed.version', '2');
  console.log(`Seed: ${seedExcel.filter((item) => item.type === 'day').length} Tage aus Excel angelegt`);
}
