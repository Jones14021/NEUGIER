import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Day, PlaceResult, Stop } from '@neugier/shared';
import { dayStops, hasCoords, moveStopOps, newId } from '@neugier/shared';
import { api } from '../api';
import { useTrip } from '../store';

export function ShoppingSuggestions({ day, routePoints }: { day: Day; routePoints: Stop[] }) {
  const { state, canEdit, apply, toast } = useTrip();
  const [query, setQuery] = useState('Supermarkt');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const dayList = dayStops(state.stops, day.id);
  const ideas = state.stops.filter((stop) => !stop.dayId && stop.kind === 'supply');
  const already = new Set(dayList.map((stop) => stop.placeId).filter(Boolean));
  const positions = useMemo(() => routePoints.filter(hasCoords), [routePoints]);
  const locationKey = JSON.stringify([...new Set([positions[0], positions[Math.floor(positions.length / 2)], positions[positions.length - 1]].filter(Boolean).map(({ lat, lng }) => JSON.stringify([lat, lng])))].map((point) => JSON.parse(point)));

  const search = async (term: string, coordinates: [number, number][]) => {
    const request = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const anchors = coordinates.length ? coordinates : [null];
      const replies = await Promise.all(anchors.map((point) => {
        const params = new URLSearchParams({ q: [term.trim(), state.trip.region].filter(Boolean).join(', ') });
        if (point) { params.set('lat', String(point[0])); params.set('lng', String(point[1])); }
        return api<PlaceResult[]>(`/maps/search?${params}`);
      }));
      if (request === requestId.current) setResults([...new Map(replies.flat().map((place) => [place.placeId, place])).values()]);
    } catch (reason) {
      if (request === requestId.current) { setResults([]); setError((reason as Error).message); }
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  };

  useEffect(() => {
    const points = JSON.parse(locationKey) as [number, number][];
    requestId.current++;
    setBusy(false);
    setResults([]);
    setError('');
    if (points.length) void search('Supermarkt', points);
    return () => { requestId.current++; };
  }, [day.id, locationKey]);

  const insertionIndex = () => {
    const index = dayList.findIndex((stop) => stop.scope === 'main' && (stop.kind === 'campsite' || stop.kind === 'accommodation'));
    return index < 0 ? dayList.length : index;
  };

  const addIdea = (stop: Stop) => {
    void apply(moveStopOps(state.stops, stop.id, day.id, insertionIndex()), `Einkauf eingeplant: ${stop.name}`);
  };

  const addPlace = (place: PlaceResult) => {
    const stop: Stop = { id: newId(), dayId: day.id, order: dayList.length + 100, scope: 'day', kind: 'supply', name: place.name,
      address: place.address, lat: place.lat, lng: place.lng, placeId: place.placeId, notes: '', time: '', duration: '', links: [], booking: '' };
    void apply([{ op: 'create', type: 'stop', data: stop }, ...moveStopOps([...state.stops, stop], stop.id, day.id, insertionIndex())], `Einkauf eingeplant: ${stop.name}`);
    toast(`${stop.name} eingeplant`);
  };

  if (!canEdit) return null;
  return (
    <section className="shopping-section">
      <h3>Einkaufsmöglichkeiten</h3>
      <div className="row">
        <input aria-label="Einkaufsmöglichkeiten suchen" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim()) void search(query, JSON.parse(locationKey));
        }} />
        <button className="icon-btn" title="Einkaufsmöglichkeiten suchen" aria-label="Einkaufsmöglichkeiten suchen" disabled={busy || !query.trim()} onClick={() => void search(query, JSON.parse(locationKey))}><Search size={17} /></button>
      </div>
      {busy && <p className="small muted">Suche Einkaufsmöglichkeiten …</p>}
      {error && <p className="small error">{error}</p>}
      {!busy && !error && !results.length && !ideas.length && <p className="small muted">Keine Einkaufsmöglichkeiten gefunden.</p>}
      {ideas.map((stop) => <div className="row shopping-result" key={stop.id}><span className="grow"><strong>{stop.name}</strong><span className="small muted"> · Idee</span></span><button className="icon-btn" title="Als Zwischenstopp hinzufügen" aria-label={`${stop.name} als Zwischenstopp hinzufügen`} onClick={() => addIdea(stop)}><Plus size={18} /></button></div>)}
      {results.filter((place) => !already.has(place.placeId)).map((place) => <div className="row shopping-result" key={place.placeId}><span className="grow"><strong>{place.name}</strong><span className="small muted shopping-address">{place.address}</span></span><button className="icon-btn" title="Als Zwischenstopp hinzufügen" aria-label={`${place.name} als Zwischenstopp hinzufügen`} onClick={() => addPlace(place)}><Plus size={18} /></button></div>)}
    </section>
  );
}