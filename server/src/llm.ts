import type { ChatMessage, ChatResponse, ProposedChange, TripState } from '@neugier/shared';
import { dayStops, fmtDate, sortedDays, todayIso } from '@neugier/shared';
import { config } from './config';
import { askCopilot } from './copilot';
import { getSetting } from './db';

export type LlmProvider = 'copilot' | 'openai';

export function llmSettings() {
  const provider = (getSetting('llm.provider') || config.llm.provider) as LlmProvider;
  const mode = (getSetting('llm.webSearch') || config.llm.webSearch) as 'off' | 'on' | 'tavily' | 'native';
  const searchApiKey = getSetting('search.apiKey') || config.tavilyApiKey;
  return {
    provider,
    baseUrl: getSetting('llm.baseUrl') || config.llm.baseUrl,
    model: getSetting('llm.model') || config.llm.model,
    apiKey: getSetting('llm.apiKey') || config.llm.apiKey,
    webSearchMode: mode,
    searchApiKey,
    // Copilot: jeder Modus außer "off" nutzt die eingebaute Websuche
    webSearch: provider === 'copilot' ? mode !== 'off' : mode === 'native' || (mode === 'tavily' && !!searchApiKey),
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

const SEARCH_HINT = `Du hast Zugriff auf eine Websuche (Tool "web_search"). Nutze sie automatisch für aktuelle oder
überprüfbare Fakten (Öffnungszeiten, Preise, Buchungslage, Sperrungen, Wetter, Campingplatz-Ausstattung) und nenne die Quellen kurz.`;

const REVIEW_PROMPT = `Prüfe den folgenden Spielplatz-Entwurf der Route kritisch: realistische Fahrzeiten pro Tag, Reihenfolge,
fehlende Dusch-/Versorgungsstopps (Frischwasser, Dump-Station), Buchungsengpässe, Wetterpuffer, sinnvolle Zwischenstopps (Cafés, Aussichtspunkte).
Antworte mit einer kurzen Bewertung (max. 8 Stichpunkte) und schlage konkrete Verbesserungen als JSON-Block vor.`;

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Sucht im Web nach aktuellen Informationen. Liefert Titel, URL und Auszug der besten Treffer.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Suchanfrage (gerne englisch für Neuseeland)' } },
      required: ['query'],
    },
  },
} as const;

type Msg = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Source = { title: string; url: string };

async function tavily(query: string, apiKey: string): Promise<{ text: string; sources: Source[] }> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: 5, include_answer: true }),
  });
  if (!r.ok) return { text: `Suche fehlgeschlagen (${r.status})`, sources: [] };
  const data = (await r.json()) as { answer?: string; results?: { title: string; url: string; content: string }[] };
  const results = data.results ?? [];
  const text = [
    data.answer ? `Kurzantwort: ${data.answer}` : '',
    ...results.map((x, i) => `[${i + 1}] ${x.title} – ${x.url}\n${x.content.slice(0, 600)}`),
  ]
    .filter(Boolean)
    .join('\n\n');
  return { text, sources: results.map((x) => ({ title: x.title, url: x.url })) };
}

async function complete(s: ReturnType<typeof llmSettings>, body: Record<string, unknown>) {
  const r = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, ...body }),
  });
  if (!r.ok) throw new Error(`KI-Anfrage fehlgeschlagen (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[]; annotations?: { type: string; url_citation?: Source }[] } }[];
  };
}

/**
 * Chat mit kompletter Reise als Kontext. Websuche:
 * - "tavily": Tool-Calling-Schleife, funktioniert mit jedem Modell mit Function Calling (z. B. GitHub Models / Copilot)
 * - "native": OpenAI-Suchmodelle (z. B. gpt-4o-search-preview) mit `web_search_options`
 */
export async function chat(state: TripState, messages: ChatMessage[], focusDayId?: string, mode?: 'review'): Promise<ChatResponse> {
  const s = llmSettings();
  if (!s.apiKey) throw new Error('Kein API-Key für den KI-Assistenten hinterlegt (Admin → Einstellungen).');

  if (s.provider === 'copilot') {
    const useSearch = s.webSearchMode !== 'off';
    const system = [SYSTEM, useSearch ? SEARCH_HINT.replace('"web_search"', '"web_search" (und "web_fetch" zum Lesen von Seiten)') : '', tripContext(state, focusDayId), mode === 'review' ? REVIEW_PROMPT : '']
      .filter(Boolean)
      .join('\n\n');
    // Copilot-Sessions sind zustandslos pro Anfrage: Verlauf als Transkript mitgeben
    const transcript = messages
      .slice(-20)
      .map((m) => `${m.role === 'user' ? 'Nutzer' : 'Assistent'}: ${m.content}`)
      .join('\n\n');
    const res = await askCopilot({ token: s.apiKey, model: s.model, system, prompt: transcript, webSearch: useSearch });
    return { ...extractProposal(res.content, state), sources: dedupe(res.sources) };
  }

  const useTavily = s.webSearchMode === 'tavily' && !!s.searchApiKey;
  const useNative = s.webSearchMode === 'native';

  const history: Msg[] = [
    { role: 'system', content: [SYSTEM, useTavily || useNative ? SEARCH_HINT : ''].filter(Boolean).join('\n\n') },
    { role: 'system', content: tripContext(state, focusDayId) },
    ...(mode === 'review' ? [{ role: 'system', content: REVIEW_PROMPT }] : []),
    ...messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
  ];
  const sources: Source[] = [];

  for (let round = 0; round < 4; round++) {
    const data = await complete(s, {
      messages: history,
      ...(useNative ? { web_search_options: {} } : { temperature: 0.4 }),
      ...(useTavily ? { tools: [SEARCH_TOOL] } : {}),
    });
    const msg = data.choices?.[0]?.message;
    for (const a of msg?.annotations ?? []) if (a.url_citation) sources.push({ title: a.url_citation.title, url: a.url_citation.url });
    if (!msg?.tool_calls?.length) return { ...extractProposal(msg?.content ?? '', state), sources: dedupe(sources) };

    history.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let query = '';
      try {
        query = (JSON.parse(call.function.arguments) as { query: string }).query;
      } catch {
        /* leere Anfrage */
      }
      const res = query ? await tavily(query, s.searchApiKey) : { text: 'Keine Anfrage', sources: [] };
      sources.push(...res.sources);
      history.push({ role: 'tool', tool_call_id: call.id, content: res.text });
    }
  }
  throw new Error('KI hat zu viele Suchrunden gebraucht');
}

function dedupe(list: Source[]): Source[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.url) && seen.add(x.url));
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
