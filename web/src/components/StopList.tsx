import { useRef, useState, type ReactNode } from 'react';
import { ExternalLink, GripVertical, History, Navigation, Pencil, Trash } from 'lucide-react';
import type { RouteLeg, Stop } from '@neugier/shared';
import { CAMP_LABEL, fmtHours, fmtKm, KIND_COLOR, KIND_ICON, KIND_LABEL, placeLink, routeLink } from '@neugier/shared';
import { RichTextView } from './RichText';

interface Props {
  stops: Stop[];
  region: string;
  legs: Map<string, RouteLeg>;
  activeId?: string | null;
  canEdit: boolean;
  onReorder: (stopId: string, toIndex: number) => void;
  onEdit: (s: Stop) => void;
  onDelete: (s: Stop) => void;
  onSelect?: (s: Stop) => void;
  onHistory?: (s: Stop) => void;
  /** Zusätzlicher Inhalt pro Stopp (z. B. Kommentare). */
  extra?: (s: Stop) => ReactNode;
}

/**
 * Stoppliste mit Drag & Drop (Griff links, funktioniert per Maus und Touch),
 * Fahrzeit-Etappen aus Google Maps und Navigation pro Stopp.
 */
export function StopList(p: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; over: number; y: number; startY: number } | null>(null);

  const indexAt = (clientY: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])];
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  };

  const startDrag = (e: React.PointerEvent, s: Stop, i: number) => {
    if (!p.canEdit) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: s.id, over: i, y: e.clientY, startY: e.clientY });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, over: indexAt(e.clientY), y: e.clientY });
  };

  const onUp = () => {
    if (!drag) return;
    const from = p.stops.findIndex((s) => s.id === drag.id);
    // Ziel-Index ohne das gezogene Element berechnen
    const to = drag.over > from ? drag.over - 1 : drag.over;
    if (to !== from) p.onReorder(drag.id, to);
    setDrag(null);
  };

  return (
    <div className="stop-list" ref={listRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
      {p.stops.map((s, i) => {
        const leg = p.legs.get(s.id);
        const nav = routeLink([s], p.region, true);
        const dragging = drag?.id === s.id;
        return (
          <div key={s.id}>
            {drag && drag.over === i && !dragging && <div className="drop-line" />}
            {leg && (
              <div className="leg small muted">
                ↓ {leg.durationSec ? `${fmtHours(leg.durationSec)} · ${fmtKm(leg.distanceMeters)}` : 'keine Straßenroute'}
              </div>
            )}
            <div
              data-stop={s.id}
              className={`stop${p.activeId === s.id ? ' active' : ''}${dragging ? ' dragging' : ''}`}
              style={dragging ? { transform: `translateY(${drag.y - drag.startY}px)` } : undefined}
              onClick={() => p.onSelect?.(s)}
            >
              {p.canEdit && (
                <span className="grip" title="Ziehen zum Verschieben" onPointerDown={(e) => startDrag(e, s, i)}>
                  <GripVertical size={18} />
                </span>
              )}
              <span className="stop-icon" style={{ background: KIND_COLOR[s.kind] }}>
                {KIND_ICON[s.kind]}
              </span>
              <div className="grow">
                <div className="stop-title">
                  {s.time && <span className="accent small">{s.time} </span>}
                  <strong>{s.name}</strong>
                </div>
                <div className="small muted">
                  {KIND_LABEL[s.kind]}
                  {s.scope === 'main' ? ' · Hauptroute' : ''}
                  {s.duration && ` · ${s.duration}`}
                  {s.camp?.type && ` · ${CAMP_LABEL[s.camp.type]}`}
                  {s.lat == null && (s.geoFailed ? ' · ⚠ Ort nicht gefunden' : ' · Ort wird gesucht …')}
                </div>
                {s.address && <div className="small muted ellipsis">📍 {s.address}</div>}
                {s.booking && (
                  <span className={`badge ${s.booking === 'gebucht' ? 'green' : 'orange'}`}>{s.booking === 'gebucht' ? 'Gebucht' : 'Noch buchen'}</span>
                )}
                {s.notes && <RichTextView text={s.notes} className="small" />}
                {s.links.map((l) => (
                  <a key={l} className="link small ellipsis" href={l} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    <ExternalLink size={12} /> {hostname(l)}
                  </a>
                ))}
                {p.extra?.(s)}
              </div>
              <div className="stop-actions" onClick={(e) => e.stopPropagation()}>
                {nav && (
                  <a className="icon-btn nav" href={nav} target="_blank" rel="noreferrer" title="Navigation starten">
                    <Navigation size={18} />
                  </a>
                )}
                <a className="icon-btn" href={placeLink(s, p.region)} target="_blank" rel="noreferrer" title="In Google Maps öffnen">
                  <ExternalLink size={16} />
                </a>
                {p.canEdit && (
                  <>
                    <button className="icon-btn" onClick={() => p.onEdit(s)} title="Bearbeiten">
                      <Pencil size={16} />
                    </button>
                    <button className="icon-btn" onClick={() => p.onDelete(s)} title="Löschen">
                      <Trash size={16} />
                    </button>
                  </>
                )}
                {p.onHistory && (
                  <button className="icon-btn" onClick={() => p.onHistory!(s)} title="Versionen">
                    <History size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {drag && drag.over === p.stops.length && <div className="drop-line" />}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}
