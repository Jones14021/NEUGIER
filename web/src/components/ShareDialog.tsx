import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Stop, StopKind } from '@neugier/shared';
import { dayStops, defaultScope, fmtDate, moveStopOps, newId, sortedDays } from '@neugier/shared';
import { api } from '../api';
import { useTrip } from '../store';

export function ShareDialog() {
  const { state, canEdit, apply, toast } = useTrip();
  const location = useLocation();
  const navigate = useNavigate();
  const [shared] = useState(() => {
    const params = new URLSearchParams(location.search);
    const text = (params.get('text') ?? '').slice(0, 4000);
    const title = (params.get('title') ?? '').slice(0, 200);
    const candidate = (params.get('url') || text.match(/https?:\/\/[^\s]+/)?.[0] || '').slice(0, 2048).replace(/[),.]+$/, '');
    let url = '';
    try { const parsed = new URL(candidate); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.toString(); } catch { /* no link */ }
    const description = text.replace(/https?:\/\/[^\s]+/g, '').trim();
    return { title, description, url };
  });
  const initialName = shared.description.split('\n')[0] || shared.title;
  const [name, setName] = useState(initialName === 'Google Maps' ? '' : initialName);
  const [kind, setKind] = useState<StopKind>('other');
  const [dayId, setDayId] = useState('');
  const [resolved, setResolved] = useState<{ name?: string; lat?: number; lng?: number } | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.history.replaceState(window.history.state, '', '/teilen');
    if (!canEdit || !shared.url || !/^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps\/|(?:www\.)?google\.(?:com|de|co\.nz)\/maps|maps\.google\.(?:com|de|co\.nz)\/)/i.test(shared.url)) return;
    let active = true;
    setStatus('Kartenlink wird aufgelöst …');
    api<{ name?: string; lat?: number; lng?: number }>(`/maps/resolve-share?${new URLSearchParams({ url: shared.url })}`)
      .then((result) => {
        if (!active) return;
        setResolved(result);
        if (result.name && (!initialName || initialName === 'Google Maps')) setName((current) => current.trim() ? current : result.name!);
        setStatus(result.lat != null ? 'Ort erkannt' : 'Ort konnte nicht automatisch bestimmt werden');
      })
      .catch(() => { if (active) setStatus('Kartenlink konnte nicht aufgelöst werden'); });
    return () => { active = false; };
  }, [canEdit, shared, initialName]);

  const save = async () => {
    if (!name.trim()) return;
    const items = dayId ? dayStops(state.stops, dayId) : state.stops.filter((stop) => !stop.dayId);
    const stop: Stop = { id: newId(), dayId: dayId || null, order: items.length + 100, scope: defaultScope(kind), kind, name: name.trim(),
      notes: shared.description && shared.description !== name ? shared.description : '', time: '', duration: '', links: shared.url ? [shared.url] : [], booking: '',
      lat: resolved?.lat, lng: resolved?.lng, geoFailed: !!shared.url && resolved?.lat == null };
    const campIndex = items.findIndex((item) => item.scope === 'main' && (item.kind === 'campsite' || item.kind === 'accommodation'));
    setSaving(true);
    await apply([{ op: 'create', type: 'stop', data: stop }, ...moveStopOps([...state.stops, stop], stop.id, stop.dayId, campIndex < 0 ? items.length : campIndex)], `Ort geteilt: ${stop.name}`);
    toast(dayId ? 'Stopp hinzugefügt' : 'Im Ideen-Pool gespeichert');
    navigate(dayId ? `/tag/${dayId}` : '/mehr', { replace: true });
  };

  return <div className="modal-bg"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
    <div className="modal-head"><h3 id="share-title">Geteilten Ort speichern</h3><button className="icon-btn" title="Schließen" aria-label="Schließen" onClick={() => navigate('/', { replace: true })}><X size={20} /></button></div>
    {!canEdit ? <p>Nur Mitarbeiter können Orte speichern.</p> : <div className="stack">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Verwendung<select value={kind} onChange={(event) => setKind(event.target.value as StopKind)}><option value="other">Ort</option><option value="sight">Sehenswürdigkeit</option><option value="activity">Aktivität</option><option value="hike">Wanderung</option><option value="food">Essen</option><option value="supply">Einkauf / Versorgung</option><option value="shower">Dusche</option><option value="campsite">Campingplatz</option><option value="accommodation">Unterkunft</option></select></label>
      <label>Speichern unter<select value={dayId} onChange={(event) => setDayId(event.target.value)}><option value="">Ideen-Pool</option>{sortedDays(state.days).map((day) => <option key={day.id} value={day.id}>{fmtDate(day.date)} · {day.title}</option>)}</select></label>
      {shared.url && <a className="small" href={shared.url} target="_blank" rel="noreferrer">{new URL(shared.url).hostname} öffnen</a>}
      {status && <p className="small muted">{status}</p>}
    </div>}
    <div className="modal-foot"><button className="btn" onClick={() => navigate('/', { replace: true })}>Abbrechen</button>{canEdit && <button className="btn primary" disabled={!name.trim() || saving} onClick={() => void save()}>Speichern</button>}</div>
  </div></div>;
}