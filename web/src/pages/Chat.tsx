import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send } from 'lucide-react';
import type { ChatMessage, ChatResponse, ProposedChange } from '@neugier/shared';
import { fmtDate, proposalToOps } from '@neugier/shared';
import { api } from '../api';
import { ProposalDiff } from '../components/ProposalDiff';
import { RichTextView } from '../components/RichText';
import { useTrip } from '../store';

const KEY = 'neugier.chat';
const SUGGESTIONS = [
  'Schlag mir einen Zwischenstopp mit Café für diesen Tag vor',
  'Wo kann ich an diesem Tag duschen?',
  'Ist die Etappe an diesem Tag zu lang?',
  'Welche Buchungen sind noch offen?',
  'Wo gibt es auf der Route Dump-Stationen und Frischwasser?',
];

/** KI-Assistent: bekommt die komplette Reise als Kontext, Vorschläge erscheinen als Diff. */
export function Chat() {
  const { state, config, canEdit, apply, toast } = useTrip();
  const [params] = useSearchParams();
  const dayId = params.get('tag') ?? undefined;
  const day = state.days.find((d) => d.id === dayId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => JSON.parse(sessionStorage.getItem(KEY) ?? '[]'));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [openDiff, setOpenDiff] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api<ChatResponse>(`/trips/${state.trip.id}/chat`, {
        body: { messages: next.map(({ role, content }) => ({ role, content })), dayId },
      });
      setMessages([...next, { role: 'assistant', content: r.content, proposal: r.proposal, sources: r.sources }]);
      if (r.proposal.length) setOpenDiff(next.length);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = async (i: number, changes: ProposedChange[]) => {
    await apply(proposalToOps(state, changes), `KI-Vorschlag übernommen (${changes.length})`, 'ai');
    setMessages(messages.map((m, j) => (j === i ? { ...m, proposal: [] , content: m.content + '\n\n✅ Übernommen' } : m)));
    setOpenDiff(null);
    toast('Änderungen übernommen – rückgängig über die Historie');
  };

  return (
    <div className="page chat">
      <div className="page-head">
        <h2>Assistent</h2>
        {messages.length > 0 && (
          <button className="btn small" onClick={() => setMessages([])}>
            Neuer Chat
          </button>
        )}
      </div>
      <p className="small muted">
        {day ? `Kontext: ${fmtDate(day.date)} – ${day.title}` : 'Kontext: ganze Reise'}
        {config.webSearch && ' · 🔎 Websuche aktiv'}
      </p>
      {!config.llmConfigured && <p className="card small">Kein API-Key hinterlegt. Ein Admin kann ihn unter „Mehr → Admin" eintragen.</p>}

      <div className="messages">
        {messages.length === 0 && (
          <div className="stack">
            <p className="muted small">Die komplette Reiseplanung wird automatisch mitgeschickt. Vorschläge kannst du prüfen und übernehmen.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? <RichTextView text={m.content} /> : <div className="pre">{m.content}</div>}
            {m.sources && m.sources.length > 0 && (
              <div className="sources small">
                🔎{' '}
                {m.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url}
                  </a>
                ))}
              </div>
            )}
            {m.proposal && m.proposal.length > 0 && (
              <>
                {openDiff === i ? (
                  canEdit ? (
                    <ProposalDiff state={state} proposal={m.proposal} onApply={(c) => applyProposal(i, c)} onCancel={() => setOpenDiff(null)} />
                  ) : (
                    <p className="small muted">Nur Mitarbeiter können Vorschläge übernehmen.</p>
                  )
                ) : (
                  <button className="btn small primary" onClick={() => setOpenDiff(i)}>
                    {m.proposal.length} Vorschlag{m.proposal.length > 1 ? 'e' : ''} ansehen
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant muted">denkt nach …</div>}
        <div ref={endRef} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input placeholder="Frag etwas zur Reise …" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn primary" disabled={busy || !input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
