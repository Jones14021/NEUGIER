import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { restoreDatabase } from './backup';

test('restores a complete backup into a live WAL database and rejects invalid files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-test-'));
  const live = path.join(directory, 'live.db');
  const snapshot = path.join(directory, 'snapshot.db');
  const invalid = path.join(directory, 'invalid.db');
  const db = new DatabaseSync(live);
  try {
    db.exec('PRAGMA journal_mode=WAL');
    for (const table of ['users', 'sessions', 'settings', 'entities', 'changes', 'import_base', 'route_cache']) db.exec(`CREATE TABLE ${table} (value TEXT)`);
    db.exec("INSERT INTO settings VALUES ('original')");
    await backup(db, snapshot);
    db.exec("UPDATE settings SET value='changed'");
    fs.writeFileSync(invalid, 'not a database');
    await assert.rejects(restoreDatabase(invalid, live, db));
    assert.equal((db.prepare('SELECT value FROM settings').get() as { value: string }).value, 'changed');
    await restoreDatabase(snapshot, live, db);
    assert.equal((db.prepare('SELECT value FROM settings').get() as { value: string }).value, 'original');
    db.exec("INSERT INTO settings VALUES ('after restore')");
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count, 2);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});