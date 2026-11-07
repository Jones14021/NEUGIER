import type { ChatMessage, ProposedChange, TripState } from '@neugier/shared';
import { dayStops, fmtDate, sortedDays, todayIso } from '@neugier/shared';
import { config } from './config';
import { getSetting } from './db';

export function llmSettings() {
  return {
    baseUrl: getSetting('llm.baseUrl') || config.llm.baseUrl,
    model: getSetting('llm.model') || config.llm.model,
    apiKey: getSetting('llm.apiKey') || config.llm.apiKey,
  };
}

/** Kompakter Reise-Kontext für das Modell (IDs nötig, damit Vorschläge referenzieren können). */
function tripContext(state: TripState, focusDayId?: string): string {
  const lines: string[] = [
    `Reise: ${state.trip.name} (${state.trip.region}), ${state.trip.startDate} bis ${state.trip.endDate}.`,
    `Mitreisende: ${state.trip.members.join(', ') || '–'}. Heute: ${todayIso()}.`,
    '',
    'Tage (Datum | Titel | Dusche) und Stopps [id] (Art, Hauptroute/Tagesroute):',
  ];
  for (const d of sortedDays(state.days)) {
    const mark = d.id === focusDayId ? ' <== aktuell geöffneter Tag' : '';
    lines.push(`## ${d.date} (${fmtDate(d.date)}) | ${d.title} | Dusche: ${d.shower.status} ${d.shower.note}${mark}`);
    if (d.times) lines.push(`   Termine: ${d.times}`);
    if (d.notes) lines.push(`   Notizen: ${d.notes.replace(/\n+/g, ' ').slice(0, 300)}`);
    for (const s of dayStops(state.stops, d.id)) {
      const coords = s.lat != null ? ` @${s.lat.toFixed(4)},${s.lng!.toFixed(4)}` : '';
      lines.push(
        `   - [${s.id}] ${s.name} (${s.kind}, ${s.scope === 'main' ? 'Hauptroute' : 'Tagesroute'})${coords}${s.notes ? ' – ' + s.notes.replace(/\n+/g, ' ').slice(0, 200) : ''}`,
      );
    }
  }
  const pool = state.stops.filter((s) => !s.dayId);
  if (pool.length) {
    lines.push('', 'Ideen-Pool (noch keinem Tag zugeordnet):');
    for (const s of pool) lines.push(`   - [${s.id}] ${s.name} (${s.kind})`);
  }
  return lines.join('\n');
}

const SYSTEM = `Du bist ein hilfsbereiter Reiseplanungs-Assistent für einen Camper-Roadtrip. Antworte auf Deutsch, knapp und konkret.
Wenn du Änderungen an der Route vorschlägst (Zwischenstopps einfügen, verschieben, ändern, entfernen), gib sie ZUSÄTZLICH zum Text
als JSON-Block in folgendem Format aus (genau ein Block, in \`\`\`json ... \`\`\`):
{"changes": [
  {"action":"add","date":"YYYY-MM-DD","afterStopId":"<id oder null>","stop":{"name":"...","kind":"campsite|accommodation|activity|hike|sight|food|shower|supply|transport|other","scope":"main|day","notes":"...","lat":-36.8,"lng":174.7,"address":"..."},"reason":"..."},
  {"action":"update","stopId":"<id>","patch":{"name":"...","notes":"..."},"reason":"..."},
  {"action":"move","stopId":"<id>","date":"YYYY-MM-DD","afterStopId":"<id oder null>","reason":"..."},
  {"action":"remove","stopId":"<id>","reason":"..."}
]}
Regeln: scope "main" nur für Übernachtungsorte/Transport (Hauptroute), Cafés/Wanderungen/Aktivitäten sind "day".
Duschen werden getrennt vom Campen geplant (eigener Stopp kind "shower" möglich). Gib Koordinaten an, wenn du sie sicher kennst.
Verwende ausschließlich existierende IDs aus dem Kontext. Ohne Änderungswunsch keinen JSON-Block ausgeben.`;

export async function chat(
  state: TripState,
  messages: ChatMessage[],
  focusDayId?: string,
): Promise<{ content: string; proposal: ProposedChange[] }> {
  const s = llmSettings();
  if (!s.apiKey) throw new Error('Kein API-Key für den KI-Assistenten hinterlegt (Admin → Einstellungen).');
  const r = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({
      model: s.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: tripContext(state, focusDayId) },
        ...messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!r.ok) throw new Error(`KI-Anfrage fehlgeschlagen (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const data = (await r.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return extractProposal(raw, state);
}

function extractProposal(raw: string, state: TripState): { content: string; proposal: ProposedChange[] } {
  const m = /```json\s*([\s\S]*?)```/.exec(raw);
  if (!m) return { content: raw.trim(), proposal: [] };
  let proposal: ProposedChange[] = [];
  try {
    const parsed = JSON.parse(m[1]) as { changes?: ProposedChange[] };
    const ids = new Set(state.stops.map((s) => s.id));
    proposal = (parsed.changes ?? []).filter((c) => (c.action === 'add' ? true : ids.has(c.stopId)));
  } catch {
    /* ungültiges JSON -> nur Text */
  }
  return { content: raw.replace(m[0], '').trim(), proposal };
}
