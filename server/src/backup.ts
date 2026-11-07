import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const requiredTables = ['users', 'sessions', 'settings', 'entities', 'changes', 'import_base', 'route_cache'];

export function temporaryBackupPath(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-backup-'));
  return { directory, file: path.join(directory, 'backup.db') };
}

export async function restoreDatabase(sourcePath: string, destinationPath: string, current: DatabaseSync): Promise<void> {
  let source: DatabaseSync | undefined;
  try {
    try {
      source = new DatabaseSync(sourcePath, { readOnly: true });
      source.exec('PRAGMA trusted_schema = OFF');
      const check = source.prepare('PRAGMA integrity_check').all() as Record<string, unknown>[];
      if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') throw new Error('Datenbank ist beschädigt');
      for (const table of requiredTables) {
        const expected = current.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[];
        const actual = source.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[];
        if (!expected.length || expected.some((column) => !actual.some((candidate) => candidate.name === column.name && candidate.type === column.type))) {
          throw new Error(`Tabelle ${table} fehlt oder ist nicht kompatibel`);
        }
      }
      if (source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Datenbank enthält ungültige Referenzen');
    } catch (error) {
      throw Object.assign(new Error(`Ungültige Sicherung: ${(error as Error).message}`), { status: 400 });
    }
    await backup(source, destinationPath);
  } finally {
    source?.close();
  }
}