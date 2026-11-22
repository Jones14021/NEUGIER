import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History, Plus, Send, Trash, X } from 'lucide-react';
import type { ChatConversation, ChatConversationSummary, ChatMessage, ProposedChange } from '@neugier/shared';
import { fmtDate, proposalToOps } from '@neugier/shared';
import { api } from '../api';
import { ProposalDiff } from '../components/ProposalDiff';
import { RichTextView } from '../components/RichText';
import { useTrip } from '../store';

const SUGGESTIONS = [
  'Schlag mir einen Zwischenstopp mit Café für diesen Tag vor',
  'Wo kann ich an diesem Tag duschen?',
  'Ist die Etappe an diesem Tag zu lang?',
  'Welche Buchungen sind noch offen?',
  'Wo gibt es auf der Route Dump-Stationen und Frischwasser?',
];
const LEGACY_KEY = 'neugier.chat';

/** KI-Assistent: bekommt die komplette Reise als Kontext, Vorschläge erscheinen als Diff. */
export function Chat() {
  const { state, user, config, canEdit, apply, toast } = useTrip();
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const dayId = params.get('tag') ?? messages.findLast((message) => message.role === 'user' && message.dayId)?.dayId;
  const day = state.days.find((d) => d.id === dayId);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [legacyAvailable, setLegacyAvailable] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(LEGACY_KEY) ?? '[]'); return Array.isArray(saved) && saved.length > 0; } catch { return false; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [openDiff, setOpenDiff] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const base = `/trips/${state.trip.id}/conversations`;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setConversationId(null);
    setError('');
    api<ChatConversationSummary[]>(base).then(async (items) => {
      const current = items[0] ? await api<ChatConversation>(`${base}/${items[0].id}`) : null;
      if (!active) return;
      setHistory(items);
      if (current) { setConversationId(current.id); setMessages(current.messages); }
    }).catch((failure) => { if (active) setError(`Chatverlauf konnte nicht geladen werden: ${(failure as Error).message}`); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, user.id]);

  const refreshHistory = async () => setHistory(await api<ChatConversationSummary[]>(base));

  const toggleHistory = () => {
    if (!historyOpen) void refreshHistory().catch((failure) => setError((failure as Error).message));
    setHistoryOpen(!historyOpen);
  };

  const openConversation = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const conversation = await api<ChatConversation>(`${base}/${id}`);
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      setOpenDiff(null);
      setHistoryOpen(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  };

  const removeConversation = async (id: string) => {
    if (!confirm('Diesen Chat endgültig löschen?')) return;
    try {
      await api(`${base}/${id}`, { method: 'DELETE' });
      if (conversationId === id) { setConversationId(null); setMessages([]); setOpenDiff(null); }
      await refreshHistory();
    } catch (failure) { setError((failure as Error).message); }
  };

  const importLegacy = async () => {
    if (!confirm('Den auf diesem Gerät gespeicherten alten Chat in dieses Konto und diese Reise übernehmen?')) return;
    setLoading(true);
    setError('');
    try {
      const saved = JSON.parse(sessionStorage.getItem(LEGACY_KEY) ?? '[]') as ChatMessage[];
      const conversation = await api<ChatConversation>(base, { body: { messages: saved } });
      sessionStorage.removeItem(LEGACY_KEY);
      setLegacyAvailable(false);
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      await refreshHistory();
    } catch (failure) { setError(`Lokaler Chat konnte nicht übernommen werden: ${(failure as Error).message}`); }
    finally { setLoading(false); }
  };

  const send = async (text: string) => {
    if (!text.trim() || busy || loading) return;
    text = text.trim();
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError('');
    let id = conversationId;
    try {
      if (!id) {
        const created = await api<ChatConversation>(base, { method: 'POST' });
        id = created.id;
        setConversationId(id);
      }
      const conversation = await api<ChatConversation>(`${base}/${id}/messages`, { body: { content: text, dayId } });
      setMessages(conversation.messages);
      if (conversation.messages.at(-1)?.proposal?.length) setOpenDiff(conversation.messages.length - 1);
      await refreshHistory();
    } catch (e) {
      setError((e as Error).message);
      if (id) {
        try {
          const saved = await api<ChatConversation>(`${base}/${id}`);
          setMessages(saved.messages);
          if (saved.messages.at(-1)?.content !== text) setInput(text);
          await refreshHistory();
        }
        catch { setInput(text); }
      } else { setMessages(messages); setInput(text); }
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!conversationId || busy) return;
    setBusy(true);
    setError('');
    try {
      const conversation = await api<ChatConversation>(`${base}/${conversationId}/messages`, { body: { retry: true, dayId } });
      setMessages(conversation.messages);
      if (conversation.messages.at(-1)?.proposal?.length) setOpenDiff(conversation.messages.length - 1);
      await refreshHistory();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };

  const applyProposal = async (i: number, changes: ProposedChange[]) => {
    await apply(proposalToOps(state, changes), `KI-Vorschlag übernommen (${changes.length})`, 'ai');
    try {
      if (conversationId) setMessages((await api<ChatConversation>(`${base}/${conversationId}/messages/${i}/applied`, { method: 'POST' })).messages);
    } catch { setError('Der Vorschlag wurde übernommen, aber der Chatverlauf konnte nicht aktualisiert werden.'); }
    setOpenDiff(null);
    toast('Änderungen übernommen – rückgängig über die Historie');
  };

  return (
    <div className="page chat">
      <div className="page-head">
        <h2>Assistent</h2>
        <div className="row">
          <button className="icon-btn" type="button" title={historyOpen ? 'Verlauf schließen' : 'Chatverlauf'} aria-label={historyOpen ? 'Verlauf schließen' : 'Chatverlauf'} aria-expanded={historyOpen} onClick={toggleHistory}>{historyOpen ? <X size={18} /> : <History size={18} />}</button>
          <button className="btn small" type="button" disabled={busy || loading} onClick={() => { setConversationId(null); setMessages([]); setOpenDiff(null); setHistoryOpen(false); setError(''); }}><Plus size={16} /> Neuer Chat</button>
        </div>
      </div>
      <p className="small muted">
        {day ? `Kontext: ${fmtDate(day.date)} – ${day.title}` : 'Kontext: ganze Reise'}
        {config.webSearch && ' · 🔎 Websuche aktiv'}
      </p>
      {!config.llmConfigured && <p className="card small">Kein API-Key hinterlegt. Ein Admin kann ihn unter „Mehr → Admin" eintragen.</p>}
      {legacyAvailable && <button className="btn small" type="button" disabled={busy || loading} onClick={() => void importLegacy()}>Vorherigen lokalen Chat übernehmen</button>}
      {error && <p className="error small" role="alert">{error}</p>}
      {!loading && conversationId && messages.at(-1)?.role === 'user' && <button className="btn small" type="button" disabled={busy} onClick={() => void retry()}>Antwort erneut versuchen</button>}
      {historyOpen && <div className="chat-history">
        {history.length === 0 && <p className="muted small">Noch keine gespeicherten Chats.</p>}
        {history.map((item) => <div className="chat-history-row" key={item.id}>
          <button type="button" className="chat-history-open" disabled={busy || loading} onClick={() => void openConversation(item.id)}><span>{item.title}</span><span className="muted small">{new Date(item.updatedAt).toLocaleString('de-DE')}</span></button>
          <button type="button" className="icon-btn" title="Chat löschen" aria-label={`${item.title} löschen`} disabled={busy || loading} onClick={() => void removeConversation(item.id)}><Trash size={16} /></button>
        </div>)}
      </div>}

      <div className="messages">
        {loading && <p className="muted small">Chatverlauf wird geladen …</p>}
        {!loading && messages.length === 0 && (
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
                  <button className="btn small primary" disabled={busy} onClick={() => setOpenDiff(i)}>
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
        <button className="btn primary" aria-label="Nachricht senden" disabled={busy || loading || !input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
