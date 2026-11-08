import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AdvancedMarker, APILoadingStatus, APIProvider, Map, useApiLoadingStatus, useMap } from '@vis.gl/react-google-maps';
import { LocateFixed, Maximize, Minimize } from 'lucide-react';
import { mapMarkerScale } from '@neugier/shared';
import { useStore } from '../store';

type LatLng = { lat: number; lng: number };

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

const MapAuthFailure = createContext(false);

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  title?: string;
  active?: boolean;
  /** Kleinere, blassere Darstellung (z. B. Kontext-Punkte, zurückliegende Tage). */
  muted?: boolean;
  /** Kleine Icons unter dem Pin (z. B. ⚡🚿💧). */
  badges?: string;
  /** Per Drag verschiebbar (Ort ändern wie in Komoot). */
  draggable?: boolean;
}

export interface MapPath {
  id: string;
  path: LatLng[];
  color: string;
  dashed?: boolean;
  weight?: number;
  opacity?: number;
}

export interface MapLabel {
  id: string;
  at: LatLng;
  text: string;
}

interface Props {
  markers: MapMarker[];
  paths: MapPath[];
  /** Fahrzeit-Etiketten auf der Route (wie die Routenvorschau in Google Maps). */
  labels?: MapLabel[];
  /** Wohnmobil-Symbol (aktuelle Position). */
  camper?: (LatLng & { title: string; live: boolean }) | null;
  /** Wenn sich der Wert ändert, wird auf alle Marker gezoomt. */
  fitKey: string;
  focus?: LatLng | null;
  onMarkerClick?: (id: string) => void;
  onMarkerDrag?: (id: string, p: LatLng) => void;
  onMapClick?: (p: LatLng) => void;
  fullscreenControl?: boolean;
  scaleMarkers?: boolean;
  children?: ReactNode;
}

export function MapProvider({ children }: { children: ReactNode }) {
  const { config } = useStore();
  const [authFailed, setAuthFailed] = useState(false);
  useLayoutEffect(() => {
    if (!config.mapsApiKey) return;
    const previous = window.gm_authFailure;
    const handler = () => {
      previous?.();
      setAuthFailed(true);
    };
    window.gm_authFailure = handler;
    return () => {
      if (window.gm_authFailure === handler) window.gm_authFailure = previous;
    };
  }, [config.mapsApiKey]);
  if (!config.mapsApiKey) return <>{children}</>;
  return (
    <APIProvider apiKey={config.mapsApiKey} language="de" region="DE">
      <MapAuthFailure.Provider value={authFailed}>{children}</MapAuthFailure.Provider>
    </APIProvider>
  );
}

export function MapView(props: Props) {
  const { config } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [manualFullscreen, setManualFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === containerRef.current);
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setManualFullscreen(false); };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', keydown); };
  }, []);
  const toggle = async () => {
    if (manualFullscreen) return setManualFullscreen(false);
    if (document.fullscreenElement === containerRef.current) return void await document.exitFullscreen();
    try {
      if (!containerRef.current?.requestFullscreen) throw new Error('Fullscreen unavailable');
      await containerRef.current.requestFullscreen();
    } catch { setManualFullscreen(true); }
  };
  const expanded = fullscreen || manualFullscreen;
  const children = <>{props.children}{props.fullscreenControl && <button className="icon-btn map-fullscreen" title={expanded ? 'Vollbild beenden' : 'Karte im Vollbild'} aria-label={expanded ? 'Vollbild beenden' : 'Karte im Vollbild'} onClick={() => void toggle()}>{expanded ? <Minimize size={18} /> : <Maximize size={18} />}</button>}</>;
  const mapProps = { ...props, children, containerRef, manualFullscreen };
  if (!config.mapsApiKey) return <NoKeyMap {...mapProps} />;
  return <GoogleMapView {...mapProps} />;
}

type MapContainerProps = Props & { containerRef: React.RefObject<HTMLDivElement | null>; manualFullscreen: boolean };

function GoogleMapView(props: MapContainerProps) {
  const { config } = useStore();
  const status = useApiLoadingStatus();
  const authFailed = useContext(MapAuthFailure);
  if (authFailed || status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
    return <NoKeyMap {...props} error="Google Maps konnte nicht geladen werden. Browser-Key, erlaubte Website und Abrechnung prüfen." />;
  }
  return (
    <div ref={props.containerRef} className={`map${props.manualFullscreen ? ' manual-fullscreen' : ''}`}>
      <Map
        mapId={config.mapId}
        defaultCenter={{ lat: -41, lng: 173 }}
        defaultZoom={5}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        onClick={(e) => e.detail.latLng && props.onMapClick?.(e.detail.latLng)}
      >
        <Paths paths={props.paths} />
        {props.labels?.map((l) => (
          <AdvancedMarker key={`l-${l.id}`} position={l.at} zIndex={5} clickable={false}>
            <div className="leg-label">{l.text}</div>
          </AdvancedMarker>
        ))}
        <MapMarkers markers={props.markers} scaleMarkers={props.scaleMarkers} onMarkerClick={props.onMarkerClick} onMarkerDrag={props.onMarkerDrag} />
        {props.camper && (
          <AdvancedMarker position={props.camper} zIndex={3000} title={props.camper.title}>
            <div className={`camper${props.camper.live ? ' live' : ''}`}>🚐</div>
          </AdvancedMarker>
        )}
        <Fitter markers={props.markers} fitKey={props.fitKey} focus={props.focus} />
        <MyLocation />
      </Map>
      {props.children}
    </div>
  );
}

function MapMarkers({ markers, scaleMarkers, onMarkerClick, onMarkerDrag }: Pick<Props, 'markers' | 'scaleMarkers' | 'onMarkerClick' | 'onMarkerDrag'>) {
  const map = useMap();
  const [zoom, setZoom] = useState(5);
  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(map.getZoom() ?? 5);
    update();
    const listener = map.addListener('zoom_changed', update);
    return () => listener.remove();
  }, [map]);
  const scale = scaleMarkers ? mapMarkerScale(zoom) : 1;
  return markers.map((marker) => <AdvancedMarker key={marker.id} position={marker} title={marker.title} draggable={marker.draggable}
    zIndex={marker.active ? 1000 : marker.muted ? 1 : 10} onClick={() => onMarkerClick?.(marker.id)}
    onDragEnd={(event) => event.latLng && onMarkerDrag?.(marker.id, { lat: event.latLng.lat(), lng: event.latLng.lng() })}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}><Pin m={marker} /></div>
  </AdvancedMarker>);
}

function Pin({ m }: { m: MapMarker }) {
  return (
    <div className={`pin-wrap${m.draggable ? ' drag' : ''}`}>
      <div className={`pin${m.active ? ' active' : ''}${m.muted ? ' muted' : ''}`} style={{ background: m.color }}>
        {m.label}
      </div>
      {m.badges && <div className="pin-badges">{m.badges}</div>}
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
            ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: p.opacity ?? 1, scale: 3 }, offset: '0', repeat: '14px' }]
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
  const last = useRef('');
  useEffect(() => {
    if (!map || !markers.length || last.current === fitKey) return;
    last.current = fitKey;
    if (markers.length === 1) {
      map.setCenter(markers[0]);
      map.setZoom(12);
      return;
    }
    const b = new google.maps.LatLngBounds();
    markers.forEach((m) => b.extend(m));
    map.fitBounds(b, 48);
  }, [map, fitKey, markers]);
  useEffect(() => {
    if (map && focus) map.panTo(focus);
  }, [map, focus]);
  return null;
}

/** Quick Action: zum eigenen Standort springen (wie in Google Maps). */
function MyLocation() {
  const map = useMap();
  const [pos, setPos] = useState<LatLng | null>(null);
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

/** Ersatzdarstellung ohne API-Key: einfache Projektion der Punkte (Drag ändert Koordinaten ebenfalls). */
function NoKeyMap({ markers, paths, labels, camper, onMarkerClick, onMarkerDrag, children, error, containerRef, manualFullscreen, scaleMarkers }: MapContainerProps & { error?: string }) {
  const box = containerRef;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const pts = [...markers, ...paths.flatMap((p) => p.path), ...(camper ? [camper] : [])];
  if (!pts.length) {
    return (
      <div ref={box} className={`map nokey${manualFullscreen ? ' manual-fullscreen' : ''}`}>
        <p className="muted small">{error ?? 'Keine Koordinaten · Google Maps API-Key fehlt (.env)'}</p>
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
  const unproject = (px: number, py: number): LatLng => ({
    lng: minLng + ((px / 100 - pad) / (1 - 2 * pad)) * w,
    lat: maxLat - ((py / 100 - pad) / (1 - 2 * pad)) * h,
  });
  const rel = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  return (
    <div
      className={`map nokey${manualFullscreen ? ' manual-fullscreen' : ''}`}
      ref={box}
      onPointerMove={(e) => drag && setDrag({ id: drag.id, ...rel(e) })}
      onPointerUp={() => {
        if (drag) onMarkerDrag?.(drag.id, unproject(drag.x, drag.y));
        setDrag(null);
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {paths.map((p) => (
          <polyline
            key={p.id}
            points={p.path.map((q) => `${x(q.lng)},${y(q.lat)}`).join(' ')}
            fill="none"
            stroke={p.color}
            strokeOpacity={p.opacity ?? 1}
            strokeDasharray={p.dashed ? '4 3' : undefined}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: p.weight ?? 3 }}
          />
        ))}
      </svg>
      {labels?.map((l) => (
        <div key={l.id} className="leg-label abs" style={{ left: `${x(l.at.lng)}%`, top: `${y(l.at.lat)}%` }}>
          {l.text}
        </div>
      ))}
      {markers.map((m) => {
        const pos = drag?.id === m.id ? { left: `${drag.x}%`, top: `${drag.y}%` } : { left: `${x(m.lng)}%`, top: `${y(m.lat)}%` };
        return (
          <div
            key={m.id}
            className="abs-pin"
            style={pos}
            title={m.title}
            onClick={() => onMarkerClick?.(m.id)}
            onPointerDown={(e) => {
              if (!m.draggable) return;
              e.preventDefault();
              setDrag({ id: m.id, ...rel(e) });
            }}
          >
            <div style={scaleMarkers ? { transform: 'scale(0.65)', transformOrigin: 'bottom center' } : undefined}><Pin m={m} /></div>
          </div>
        );
      })}
      {camper && (
        <div className={`camper abs${camper.live ? ' live' : ''}`} style={{ left: `${x(camper.lng)}%`, top: `${y(camper.lat)}%` }} title={camper.title}>
          🚐
        </div>
      )}
      <span className="nokey-hint">{error ?? 'Vorschau ohne Google Maps (API-Key fehlt)'}</span>
      {children}
    </div>
  );
}

/** Mittelpunkt einer Linie (für Etiketten). */
export function midpoint(path: LatLng[]): LatLng | null {
  if (!path.length) return null;
  return path[Math.floor(path.length / 2)];
}
