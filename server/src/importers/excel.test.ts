import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseExcel } from './excel';

test('multiple rows on a date get distinct import keys', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reiseverlauf');
  for (const rowNumber of [4, 5]) {
    const row = sheet.getRow(rowNumber);
    row.getCell(2).value = 'Route';
    row.getCell(3).value = new Date('2027-01-09T00:00:00Z');
    row.getCell(5).value = `Aktivität ${rowNumber}`;
    row.getCell(6).value = `Camping ${rowNumber}`;
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const entities = await parseExcel(buffer, { startDate: '2026-12-14', currency: 'EUR' });
  const keys = entities.map((entity) => entity.data.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.filter((key) => key?.startsWith('xl:act:')), ['xl:act:2027-01-09', 'xl:act:2027-01-09:2']);
  assert.deepEqual(keys.filter((key) => key?.startsWith('xl:camp:')), ['xl:camp:2027-01-09', 'xl:camp:2027-01-09:2']);
});

test('preserves accommodation mentioned in a title alongside an activity', async () => {
  const workbook = new ExcelJS.Workbook();
  const row = workbook.addWorksheet('Reiseverlauf').getRow(4);
  row.getCell(2).value = 'SINGAPUR\n(Hotel Mi Rochor)';
  row.getCell(3).value = new Date('2027-01-18T00:00:00Z');
  row.getCell(5).value = 'Lichtershow';
  const entities = await parseExcel(Buffer.from(await workbook.xlsx.writeBuffer()), { startDate: '2026-12-14', currency: 'EUR' });
  const hotel = entities.find((entity) => entity.type === 'stop' && 'kind' in entity.data && entity.data.kind === 'accommodation');
  assert.ok(hotel);
  assert.equal('name' in hotel.data && hotel.data.name, 'Hotel Mi Rochor');
});