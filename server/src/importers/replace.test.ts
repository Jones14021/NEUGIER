import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Day, Trip, TypedEntity } from '@neugier/shared';

test('replacement and import baseline commit or roll back together', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-import-test-'));
  process.env.DATA_DIR = directory;
  const { db } = await import('../db');
  const { applyOps, getState } = await import('../store');
  const { replaceWithImport } = await import('./replace');
  try {
    const trip: Trip = { id: 'trip', name: 'Test', region: '', startDate: '2026-01-01', endDate: '2026-01-01', currency: 'EUR', members: [], notes: '' };
    const day: Day = { id: '', key: 'xl:day:2026-01-02', date: '2026-01-02', title: 'Excel', times: '', notes: '', shower: { status: 'unklar', note: '' } };
    const incoming: TypedEntity[] = [{ type: 'day', data: day }];
    applyOps(trip.id, [{ op: 'create', type: 'trip', data: trip }], { userName: 'Test', userId: '', source: 'user', label: 'Test' });
    db.exec("CREATE TRIGGER reject_base BEFORE INSERT ON import_base BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => replaceWithImport(getState(trip.id)!, incoming), /test failure/);
    assert.equal(getState(trip.id)!.days.length, 0);
    assert.equal(getState(trip.id)!.trip.startDate, '2026-01-01');
    db.exec('DROP TRIGGER reject_base');
    replaceWithImport(getState(trip.id)!, incoming);
    assert.equal(getState(trip.id)!.days[0].title, 'Excel');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM import_base').get() as { count: number }).count, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});