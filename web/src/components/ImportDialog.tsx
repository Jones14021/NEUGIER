import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { api } from '../api';
import { useTrip } from '../store';

type Pick = 'incoming' | 'current';

interface FieldDiff {
  field: string;
  base: unknown;
  current: unknown;
  incoming: unknown;
  auto: Pick | null;
}
interface MergeItem {
  key: string;
  type: string;
  label: string;
  status: 'new' | 'update' | 'conflict' | 'removed' | 'deleted-local';
  fields: FieldDiff[];
}
interface Plan {
  importId: string;
  source: string;
  items: MergeItem[];
  unchanged: number;
}

const STATUS: Record<MergeItem['status'], [string, string]> = {
  conflict: ['Konflikt', 'red'],
  update: ['Geändert', 'orange'],
  new: ['Neu', 'green'],
  removed: ['In Datei entfernt', 'red'],
  'deleted-local': ['Lokal gelöscht', 'orange'],
};
const TYPE_LABEL: Record<string, string> = { day: 'Tag', stop: 'Stopp', expense: 'Ausgabe', memory: 'Erinnerung', comment: 'Kommentar' };

/** Excel/JSON (Re-)Import mit manueller Konfliktlösung (3-Wege-Merge). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { state, toast } = useTrip();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fields, setFields] = useState<Record<string, Record<string, Pick>>>({});
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'conflict'>('conflict');

  const analyze = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const p = await api<Plan>(`/trips/${state.trip.id}/import/analyze`, { form });
      setPlan(p);
      setFilter(p.items.some((i) => i.status === 'conflict') ? 'conflict' : 'all');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    setBusy(true);
    try {
      const r = await api<{ changes: number }>(`/trips/${state.trip.id}/import/apply`, {
        body: { importId: plan!.importId, resolution: { fields, accept } },
      });
      toast(`Import abgeschlossen: ${r.changes} Änderungen`);
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = (key: string, field: string, v: Pick) => setFields((f) => ({ ...f, [key]: { ...f[key], [field]: v } }));
  const chooseAll = (v: Pick) => {
    const next: typeof fields = {};
    for (const it of plan!.items) for (const f of it.fields) if (f.auto === null) (next[it.key] ??= {})[f.field] = v;
    setFields(next);
  };

  const unresolved = plan?.items.flatMap((i) => i.fields.filter((f) => f.auto === null && !fields[i.key]?.[f.field])).length ?? 0;
  const shown = plan?.items.filter((i) => filter === 'all' || i.status === 'conflict') ?? [];

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Import (Excel oder JSON)</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {!plan && (
          <div className="stack">
            <p className="small muted">
              Excel nach dem Template „Routenplanung.xlsx" (Blatt „Reiseverlauf", optional „Tabelle1" als Ideen) oder eine
              NEUGIER-JSON-Exportdatei. Beim erneuten Import wird mit dem aktuellen Stand gemergt: nur geänderte Felder werden
              übernommen, bei beidseitigen Änderungen entscheidest du.
            </p>
            <label className="btn primary file">
              <Upload size={16} /> {busy ? 'Analysiere …' : 'Datei wählen'}
              <input type="file" accept=".xlsx,.json" hidden onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
            </label>
          </div>
        )}
        {plan && (
          <>
            <p className="small">
              {plan.items.filter((i) => i.status === 'new').length} neu · {plan.items.filter((i) => i.status === 'update').length} geändert ·{' '}
              <strong>{plan.items.filter((i) => i.status === 'conflict').length} Konflikte</strong> · {plan.unchanged} unverändert
            </p>
            <div className="row wrap">
              <div className="seg small">
                <button className={filter === 'conflict' ? 'sel' : ''} onClick={() => setFilter('conflict')}>
                  Nur Konflikte
                </button>
                <button className={filter === 'all' ? 'sel' : ''} onClick={() => setFilter('all')}>
                  Alle
                </button>
              </div>
              <button className="btn small" onClick={() => chooseAll('current')}>
                Alle Konflikte: aktuell behalten
              </button>
              <button className="btn small" onClick={() => chooseAll('incoming')}>
                Alle Konflikte: aus Datei
              </button>
            </div>
            <div className="merge-list">
              {shown.map((it) => (
                <div key={it.key} className="merge-item">
                  <div className="row">
                    <span className={`badge ${STATUS[it.status][1]}`}>{STATUS[it.status][0]}</span>
                    <span className="small muted">{TYPE_LABEL[it.type] ?? it.type}</span>
                    <strong className="small grow">{it.label}</strong>
                    {(it.status === 'new' || it.status === 'removed' || it.status === 'deleted-local') && (
                      <label className="check small">
                        <input
                          type="checkbox"
                          checked={accept[it.key] ?? it.status === 'new'}
                          onChange={(e) => setAccept({ ...accept, [it.key]: e.target.checked })}
                        />
                        {it.status === 'removed' ? 'Löschen' : 'Übernehmen'}
                      </label>
                    )}
                  </div>
                  {it.fields
                    .filter((f) => f.auto !== 'current')
                    .map((f) => {
                      const sel = fields[it.key]?.[f.field] ?? f.auto;
                      return (
                        <div key={f.field} className="merge-field">
                          <div className="small muted">{f.field}</div>
                          <div className="merge-choices">
                            <button className={`merge-choice${sel === 'current' ? ' sel' : ''}`} onClick={() => choose(it.key, f.field, 'current')}>
                              <span className="small muted">Aktuell</span>
                              <span className="pre small">{show(f.current)}</span>
                            </button>
                            <button className={`merge-choice${sel === 'incoming' ? ' sel' : ''}`} onClick={() => choose(it.key, f.field, 'incoming')}>
                              <span className="small muted">Aus Datei</span>
                              <span className="pre small">{show(f.incoming)}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <span className="small muted">{unresolved > 0 ? `${unresolved} offene Konflikte (Standard: aktuell behalten)` : ''}</span>
              <span className="grow" />
              <button className="btn" onClick={() => setPlan(null)}>
                Zurück
              </button>
              <button className="btn primary" disabled={busy} onClick={applyImport}>
                Import übernehmen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function show(v: unknown): string {
  if (v == null || v === '') return '–';
  if (typeof v === 'string') return v.startsWith('@key:') ? '(Verknüpfung)' : v;
  return JSON.stringify(v, null, 1);
}
