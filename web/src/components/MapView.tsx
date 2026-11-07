import { useEffect, useState, type ReactNode } from 'react';
import { AdvancedMarker, APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { LocateFixed } from 'lucide-react';
import { useStore } from '../store';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  title?: string;
  active?: boolean;
  /** Kleinere, blassere Darstellung (z. B. Kontext-Punkte). */
  muted?: boolean;
}

export interface MapPath {
  id: string;
  path: { lat: number; lng: number }[];
  color: string;
  dashed?: boolean;
  weight?: number;
  opacity?: number;
}

interface Props {
  markers: MapMarker[];
  paths: MapPath[];
  /** Wenn sich der Wert ändert, wird auf alle Marker gezoomt. */
  fitKey: string;
  focus?: { lat: number; lng: number } | null;
  onMarkerClick?: (id: string) => void;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  children?: ReactNode;
}

export function MapProvider({ children }: { children: ReactNode }) {
  const { config } = useStore();
  if (!config.mapsApiKey) return <>{children}</>;
  return (
    <APIProvider apiKey={config.mapsApiKey} language="de" region="DE">
      {children}
    </APIProvider>
  );
}

export function MapView(props: Props) {
  const { config } = useStore();
  if (!config.mapsApiKey) return <NoKeyMap {...props} />;
  return (
    <div className="map">
      <Map
        mapId={config.mapId}
        defaultCenter={{ lat: -41, lng: 173 }}
        defaultZoom={5}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl={false}
        clickableIcons={false}
        onClick={(e) => e.detail.latLng && props.onMapClick?.(e.detail.latLng)}
      >
        {props.markers.map((m) => (
          <AdvancedMarker
            key={m.id}
            position={m}
            title={m.title}
            zIndex={m.active ? 1000 : m.muted ? 1 : 10}
            onClick={() => props.onMarkerClick?.(m.id)}
          >
            <div
              className={`pin${m.active ? ' active' : ''}${m.muted ? ' muted' : ''}`}
              style={{ background: m.color }}
            >
              {m.label}
            </div>
          </AdvancedMarker>
        ))}
        <Paths paths={props.paths} />
        <Fitter markers={props.markers} fitKey={props.fitKey} focus={props.focus} />
        <MyLocation />
      </Map>
      {props.children}
    </div>
  );
}

function Paths({ paths }: { paths: MapPath[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const lines = paths.map(
      (p) =>
        new google.maps.Polyline({
          map,
          path: p.path,
          strokeColor: p.color,
          strokeOpacity: p.dashed ? 0 : (p.opacity ?? 0.9),
          strokeWeight: p.weight ?? 4,
          icons: p.dashed
            ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '14px' }]
            : undefined,
          clickable: false,
        }),
    );
    return () => lines.forEach((l) => l.setMap(null));
  }, [map, paths]);
  return null;
}

function Fitter({ markers, fitKey, focus }: Pick<Props, 'markers' | 'fitKey' | 'focus'>) {
  const map = useMap();
  useEffect(() => {
    if (!map || !markers.length) return;
    if (markers.length === 1) {
      map.setCenter(markers[0]);
      map.setZoom(12);
      return;
    }
    const b = new google.maps.LatLngBounds();
    markers.forEach((m) => b.extend(m));
    map.fitBounds(b, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  useEffect(() => {
    if (map && focus) map.panTo(focus);
  }, [map, focus]);
  return null;
}

/** Quick Action: zum eigenen Standort springen (wie in Google Maps). */
function MyLocation() {
  const map = useMap();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const locate = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(ll);
        map?.panTo(ll);
        map?.setZoom(13);
      },
      () => alert('Standort nicht verfügbar'),
      { enableHighAccuracy: true },
    );
  return (
    <>
      {pos && (
        <AdvancedMarker position={pos} zIndex={2000}>
          <div className="me-dot" />
        </AdvancedMarker>
      )}
      <button className="fab locate" title="Mein Standort" onClick={locate}>
        <LocateFixed size={20} />
      </button>
    </>
  );
}

/** Ersatzdarstellung ohne API-Key: einfache Projektion der Punkte. */
function NoKeyMap({ markers, paths, onMarkerClick, children }: Props) {
  const pts = [...markers, ...paths.flatMap((p) => p.path)];
  if (!pts.length) {
    return (
      <div className="map nokey">
        <p className="muted small">Keine Koordinaten · Google Maps API-Key fehlt (.env)</p>
        {children}
      </div>
    );
  }
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pad = 0.08;
  const w = Math.max(maxLng - minLng, 0.01);
  const h = Math.max(maxLat - minLat, 0.01);
  const x = (lng: number) => (pad + ((lng - minLng) / w) * (1 - 2 * pad)) * 100;
  const y = (lat: number) => (pad + ((maxLat - lat) / h) * (1 - 2 * pad)) * 100;
  return (
    <div className="map nokey">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {paths.map((p) => (
          <polyline
            key={p.id}
            points={p.path.map((q) => `${x(q.lng)},${y(q.lat)}`).join(' ')}
            fill="none"
            stroke={p.color}
            strokeWidth={0.6}
            strokeDasharray={p.dashed ? '1.5 1' : undefined}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: p.weight ?? 3 }}
          />
        ))}
      </svg>
      {markers.map((m) => (
        <div
          key={m.id}
          className={`pin abs${m.active ? ' active' : ''}${m.muted ? ' muted' : ''}`}
          style={{ left: `${x(m.lng)}%`, top: `${y(m.lat)}%`, background: m.color }}
          title={m.title}
          onClick={() => onMarkerClick?.(m.id)}
        >
          {m.label}
        </div>
      ))}
      <span className="nokey-hint">Vorschau ohne Google Maps (API-Key fehlt)</span>
      {children}
    </div>
  );
}
