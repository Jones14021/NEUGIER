import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { CampType, PlaceResult, Stop, StopKind, StopScope } from '@neugier/shared';
import { CAMP_LABEL, defaultScope, KIND_ICON, KIND_LABEL, SCOPE_LABEL } from '@neugier/shared';
import { api } from '../api';

interface Props {
  stop: Stop;
  isNew: boolean;
  bias?: { lat: number; lng: number };
  onSave: (s: Stop) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Bearbeiten/Anlegen eines Stopps inkl. Google-Ortssuche. */
export function StopEditor({ stop, isNew, bias, onSave, onDelete, onClose }: Props) {
  const [s, setS] = useState<Stop>(stop);
  const [q, setQ] = useState(isNew ? '' : stop.name);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const set = <K extends keyof Stop>(k: K, v: Stop[K]) => setS((p) => ({ ...p, [k]: v }));

  const search = async () => {
    const params = new URLSearchParams({ q });
    if (bias) params.set('lat', String(bias.lat)), params.set('lng', String(bias.lng));
    setResults(await api<PlaceResult[]>(`/maps/search?${params}`));
  };

  const pick = (p: PlaceResult) => {
    setS((prev) => ({
      ...prev,
      name: prev.name && !isNew ? prev.name : p.name,
      lat: p.lat,
      lng: p.lng,
      placeId: p.placeId,
      address: p.address,
      kind: isNew && prev.kind === 'other' ? guessKind(p.types) : prev.kind,
    }));
    setResults(null);
  };

  const setKind = (kind: StopKind) =>
    setS((p) => ({
      ...p,
      kind,
      scope: isNew ? defaultScope(kind) : p.scope,
      camp: kind === 'campsite' || kind === 'accommodation' ? (p.camp ?? { type: '', powered: false, shower: false }) : p.camp,
    }));

  const isCamp = s.kind === 'campsite' || s.kind === 'accommodation';

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{isNew ? 'Stopp hinzufügen' : 'Stopp bearbeiten'}</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="stack">
          <div className="row">
            <input
              placeholder="Ort suchen (Google)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className="btn" onClick={search}>
              <Search size={16} />
            </button>
          </div>
          {results && (
            <div className="results">
              {results.length === 0 && <p className="muted small">Keine Treffer (oder kein Maps-Server-Key).</p>}
              {results.map((r) => (
                <button key={r.placeId} className="result" onClick={() => pick(r)}>
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.address}</span>
                </button>
              ))}
            </div>
          )}
          {s.lat != null && (
            <p className="small muted">
              📍 {s.address || `${s.lat.toFixed(5)}, ${s.lng?.toFixed(5)}`}{' '}
              <button className="link" onClick={() => setS((p) => ({ ...p, lat: undefined, lng: undefined, placeId: undefined, address: undefined }))}>
                entfernen
              </button>
            </p>
          )}

          <label>
            Name
            <input value={s.name} onChange={(e) => set('name', e.target.value)} />
          </label>

          <div className="kind-grid">
            {(Object.keys(KIND_LABEL) as StopKind[]).map((k) => (
              <button key={k} className={`kind-btn${s.kind === k ? ' sel' : ''}`} onClick={() => setKind(k)}>
                <span>{KIND_ICON[k]}</span>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="seg">
            {(['main', 'day'] as StopScope[]).map((sc) => (
              <button key={sc} className={s.scope === sc ? 'sel' : ''} onClick={() => set('scope', sc)}>
                {SCOPE_LABEL[sc]}
              </button>
            ))}
          </div>
          <p className="small muted">
            Hauptroute = erscheint auf der Gesamtreise-Karte (Übernachtung, Transfers). Tagesroute = nur in der Tagesplanung
            (Café, Wanderung, Dusche …).
          </p>

          {isCamp && (
            <fieldset>
              <legend>Übernachtung</legend>
              <select
                value={s.camp?.type ?? ''}
                onChange={(e) => set('camp', { ...(s.camp ?? { powered: false, shower: false }), type: e.target.value as CampType })}
              >
                {(Object.keys(CAMP_LABEL) as CampType[]).map((c) => (
                  <option key={c} value={c}>
                    {CAMP_LABEL[c]}
                  </option>
                ))}
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!s.camp?.powered}
                  onChange={(e) => set('camp', { type: '', shower: false, ...s.camp, powered: e.target.checked })}
                />
                Strom (powered)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!s.camp?.shower}
                  onChange={(e) => set('camp', { type: '', powered: false, ...s.camp, shower: e.target.checked })}
                />
                Duschen vor Ort
              </label>
            </fieldset>
          )}

          <div className="row">
            <label>
              Uhrzeit
              <input value={s.time} placeholder="z. B. 09:30" onChange={(e) => set('time', e.target.value)} />
            </label>
            <label>
              Dauer
              <input value={s.duration} placeholder="z. B. 3 h" onChange={(e) => set('duration', e.target.value)} />
            </label>
          </div>
          <label>
            Buchung
            <select value={s.booking} onChange={(e) => set('booking', e.target.value as Stop['booking'])}>
              <option value="">–</option>
              <option value="offen">Noch buchen</option>
              <option value="gebucht">Gebucht</option>
            </select>
          </label>
          <label>
            Notizen
            <textarea rows={4} value={s.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <label>
            Links (einer pro Zeile)
            <textarea
              rows={2}
              value={s.links.join('\n')}
              onChange={(e) => set('links', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
            />
          </label>
        </div>
        <div className="modal-foot">
          {onDelete && (
            <button className="btn danger" onClick={onDelete}>
              Löschen
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!s.name.trim()} onClick={() => onSave(s)}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function guessKind(types: string[]): StopKind {
  const t = types.join(' ');
  if (/campground|rv_park/.test(t)) return 'campsite';
  if (/lodging|hotel/.test(t)) return 'accommodation';
  if (/cafe|restaurant|bakery|bar|food/.test(t)) return 'food';
  if (/supermarket|grocery|gas_station|store/.test(t)) return 'supply';
  if (/airport|ferry|transit|train/.test(t)) return 'transport';
  if (/park|hiking|natural_feature/.test(t)) return 'hike';
  if (/tourist_attraction|museum|point_of_interest/.test(t)) return 'sight';
  return 'other';
}
