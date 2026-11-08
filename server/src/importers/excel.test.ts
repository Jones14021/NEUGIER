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

test('imports real amounts without interpreting links, nights or per-person prices as totals', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reiseverlauf');
  const row = (index: number, price: ExcelJS.CellValue) => {
    const item = sheet.getRow(index);
    item.getCell(2).value = `Route ${index}`;
    item.getCell(3).value = new Date(`2027-01-0${index - 3}T00:00:00Z`);
    item.getCell(5).value = 'Aktivität';
    item.getCell(6).value = 'Campingplatz';
    item.getCell(9).value = price;
    return item;
  };
  row(4, { text: 'https://example.test/booking/272879', hyperlink: 'https://example.test/booking/272879' });
  row(5, 'Campingplatz 4 Nächte: 150 Euro / 2 Personen');
  row(6, '68 Euro / Person');
  row(7, '280 Dollar / 2 Personen\nCampsite: 55 Dollar / 2 Personen').getCell(10).value = { formula: '55/4', result: 13.75 };
  const entities = await parseExcel(Buffer.from(await workbook.xlsx.writeBuffer()), { startDate: '2026-12-14', currency: 'EUR' });
  const expenses = entities.filter((entity) => entity.type === 'expense').map((entity) => entity.data as { amount: number | null; title: string; currency: string });
  assert.deepEqual(expenses.map((expense) => expense.amount), [150, null, 280, 55]);
  assert.deepEqual(expenses.map((expense) => expense.currency), ['EUR', 'EUR', 'NZD', 'NZD']);
  assert.equal(expenses[0].title, 'Campingplatz');
  assert.equal(expenses[3].title, 'Campingplatz');
  const camping = entities.find((entity) => entity.type === 'stop' && entity.data.key === 'xl:camp:2027-01-04')!;
  assert.match((camping.data as { notes: string }).notes, /13\.75/);
});