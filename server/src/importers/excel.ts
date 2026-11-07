import ExcelJS from 'exceljs';
import type { CampType, Day, Expense, ShowerStatus, Stop, StopKind, TypedEntity } from '@neugier/shared';
import { defaultScope } from '@neugier/shared';
import { REF } from '../merge';

/**
 * Liest das Excel-Template ("Reiseverlauf" + optional "Tabelle1" als Ideen-Pool).
 * Jedes Objekt bekommt einen stabilen `key` (aus Datum/Zeile), damit ein Re-Import mergen kann.
 * Referenzen auf Tage werden als `@key:<key>` notiert und beim Merge aufgelöst.
 *
 * Spalten Reiseverlauf: A Tag-Nr | B Route/Titel | C Datum | D Uhrzeit | E Aktivitäten |
 *                       F Campsite | G Duschen? | H Details | I Preise
 */
export async function parseExcel(buf: Buffer, opts: { startDate?: string; currency: string }): Promise<TypedEntity[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Reiseverlauf') ?? wb.worksheets.find((w) => w.name !== 'Tabelle1');
  if (!ws) throw new Error('Arbeitsblatt "Reiseverlauf" nicht gefunden');

  const rows: Row[] = [];
  let lastDate = '';
  ws.eachRow((row, idx) => {
    if (idx <= 3) return;
    const r: Row = {
      idx,
      title: text(row.getCell(2)),
      date: dateOf(row.getCell(3)),
      time: timeOf(row.getCell(4)),
      act: text(row.getCell(5)),
      actLink: link(row.getCell(5)),
      camp: text(row.getCell(6)),
      shower: text(row.getCell(7)),
      details: text(row.getCell(8)),
      detailsLink: link(row.getCell(8)),
      price: row.getCell(9).value,
      priceText: text(row.getCell(9)),
      priceLink: link(row.getCell(9)),
    };
    if (!r.title && !r.act && !r.camp) return;
    r.date = r.date || lastDate;
    if (!r.date) return;
    lastDate = r.date;
    rows.push(r);
  });

  // Jahres-Tippfehler korrigieren: Daten vor Reisebeginn gehören ins Folgejahr
  const start = opts.startDate || rows.map((r) => r.date).sort()[0];
  for (const r of rows) if (r.date < start) r.date = `${Number(r.date.slice(0, 4)) + 1}${r.date.slice(4)}`;

  const out: TypedEntity[] = [];
  const keyCounts = new Map<string, number>();
  const uniqueKey = (key: string) => {
    const count = (keyCounts.get(key) ?? 0) + 1;
    keyCounts.set(key, count);
    return count === 1 ? key : `${key}:${count}`;
  };
  const byDate = new Map<string, Row[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);

  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const dayKey = `xl:day:${date}`;
    const main = list.find((r) => r.act || r.camp) ?? list[0];
    const showerRow = list.find((r) => r.shower);
    const day: Day = {
      id: '',
      key: dayKey,
      date,
      title: oneLine(main.title),
      times: list
        .filter((r) => r.time)
        .map((r) => (r.act || r.camp ? r.time : `${oneLine(r.title)} ${r.time}`))
        .join(' · '),
      notes: list.filter((r) => r.details).map((r) => r.details).join('\n\n'),
      shower: { status: showerStatus(showerRow?.shower), note: showerRow?.shower ?? '' },
      facilities: {
        power: /powered/i.test(showerRow?.shower ?? '') ? 'ja' : 'unklar',
        water: 'unklar',
        dump: 'unklar',
      },
    };
    out.push({ type: 'day', data: day });

    let order = 0;
    for (const r of list) {
      const slug = slugify(r.title).slice(0, 30) || String(r.idx);
      const isEvent = !r.act && !r.camp;
      if (isEvent) {
        const kind: StopKind = /unterkunft|hotel|b&b|bed/i.test(r.title) ? 'accommodation' : 'transport';
        out.push({ type: 'stop', data: stop(uniqueKey(`xl:row:${date}:${slug}`), dayKey, order++, kind, r.title, '', r.time) });
      }
      if (r.act) {
        const [name, ...rest] = r.act.split('\n');
        const kind: StopKind = /wanderung|track|walk/i.test(r.act) ? 'hike' : 'activity';
        const s = stop(uniqueKey(`xl:act:${date}`), dayKey, order++, kind, name, rest.join('\n').trim(), '');
        if (r.actLink) s.links = [r.actLink];
        out.push({ type: 'stop', data: s });
      }
      if (r.camp) {
        const [name, ...rest] = r.camp.split('\n');
        const s = stop(uniqueKey(`xl:camp:${date}`), dayKey, 100 + order++, 'campsite', name, rest.join('\n').trim(), '');
        s.camp = { type: campType(r.camp) };
        s.booking = /gebucht/i.test(r.camp) ? 'gebucht' : /buchen/i.test(r.camp + r.details) ? 'offen' : '';
        const links = [r.detailsLink].filter(Boolean) as string[];
        if (links.length) s.links = links;
        out.push({ type: 'stop', data: s });
      }
      if (r.priceText) {
        const amount = typeof r.price === 'number' ? r.price : parseAmount(r.priceText);
        const e: Expense = {
          id: '',
          key: uniqueKey(`xl:price:${date}:${slug}`),
          dayId: `${REF}${dayKey}`,
          stopId: null,
          title: oneLine(r.camp && !r.act ? r.camp : r.act || r.title),
          amount,
          currency: /dollar/i.test(r.priceText) ? 'NZD' : opts.currency,
          paidBy: '',
          splitBetween: [],
          note: [r.priceText.startsWith('http') ? '' : r.priceText, r.priceLink ?? ''].filter(Boolean).join('\n'),
        };
        out.push({ type: 'expense', data: e });
      }
    }
  }

  const ideas = wb.getWorksheet('Tabelle1');
  if (ideas) out.push(...parseIdeas(ideas));
  return out;
}

function parseIdeas(ws: ExcelJS.Worksheet): TypedEntity[] {
  const out: TypedEntity[] = [];
  let section = '';
  ws.eachRow((row) => {
    const b = text(row.getCell(2));
    const c = text(row.getCell(3));
    if (!b) return;
    if (/^(nordinsel|südinsel|wanderungen)$/i.test(b)) {
      section = b;
      return;
    }
    if (!section) return;
    const url = link(row.getCell(3)) ?? (c.startsWith('http') ? c : undefined);
    if (section.toLowerCase() === 'wanderungen' && !url) return;
    const kind: StopKind = section.toLowerCase() === 'wanderungen' ? 'hike' : 'sight';
    const s = stop(`xl:idea:${slugify(b)}`, null, 0, kind, b, [url ? '' : c, text(row.getCell(4))].filter(Boolean).join('\n'), '');
    s.notes = [section, s.notes].filter(Boolean).join(' – ');
    if (url) s.links = [url];
    out.push({ type: 'stop', data: s });
  });
  return out;
}

interface Row {
  idx: number;
  title: string;
  date: string;
  time: string;
  act: string;
  actLink?: string;
  camp: string;
  shower: string;
  details: string;
  detailsLink?: string;
  price: ExcelJS.CellValue;
  priceText: string;
  priceLink?: string;
}

function stop(
  key: string,
  dayKey: string | null,
  order: number,
  kind: StopKind,
  name: string,
  notes: string,
  time: string,
): Stop {
  return {
    id: '',
    key,
    dayId: dayKey ? `${REF}${dayKey}` : null,
    order,
    scope: defaultScope(kind),
    kind,
    name: name.trim(),
    notes,
    time,
    duration: '',
    links: [],
    booking: '',
  };
}

function text(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('').trim();
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function link(cell: ExcelJS.Cell): string | undefined {
  const v = cell.value;
  if (v && typeof v === 'object' && 'hyperlink' in v) return v.hyperlink;
  return cell.hyperlink || undefined;
}

function dateOf(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text(cell));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function timeOf(cell: ExcelJS.Cell): string {
  const v = cell.value;
  // Excel-Uhrzeiten kommen als Datum am 1899-12-30 in UTC
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  return text(cell);
}

function oneLine(s: string): string {
  return s.replace(/\s*\n+\s*/g, ' / ').trim();
}

function showerStatus(s?: string): ShowerStatus {
  if (!s) return 'unklar';
  if (/^\s*ja/i.test(s)) return 'ja';
  if (/^\s*(nein|freedom nein)/i.test(s)) return 'nein';
  return 'unklar';
}

function campType(s: string): CampType {
  if (/holiday park|top 10|campingplatz gebucht|cabins/i.test(s)) return 'holiday_park';
  if (/\bDOC\b/.test(s)) return 'doc';
  if (/freedom|carpark|parking/i.test(s)) return 'freedom';
  if (/hotel|b&b/i.test(s)) return 'hotel';
  return '';
}

function parseAmount(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '');
}
