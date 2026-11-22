import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Headphones, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import { useTrip } from '../store';

interface PodcastInfo {
  enabled: boolean;
  status: string;
  available: boolean;
  stale: boolean;
  error: string;
  model: string;
  updatedAt: string;
  sources: { title: string; url: string }[];
}

interface PodcastContextValue {
  podcasts: Record<string, PodcastInfo>;
  play: (dayId: string, title: string) => void;
  regenerate: (dayId: string) => Promise<void>;
  player: ReactNode;
}

const PodcastContext = createContext<PodcastContextValue | null>(null);

export function PodcastProvider({ children }: { children: ReactNode }) {
  const { state, user, toast } = useTrip();
  const [podcasts, setPodcasts] = useState<Record<string, PodcastInfo>>({});
  const [current, setCurrent] = useState<{ dayId: string; title: string } | null>(null);
  const [rate, setRate] = useState('1');
  const audio = useRef<HTMLAudioElement>(null);
  const tripId = state.trip.id;

  useEffect(() => {
    let active = true;
    setPodcasts({});
    const refresh = () => api<Record<string, PodcastInfo>>(`/trips/${encodeURIComponent(tripId)}/podcasts`).then((result) => { if (active) setPodcasts(result); }).catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [tripId, user.id]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
    setCurrent(null);
  }, [tripId, user.id]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: 'NEUGIER · KI-Podcast', album: state.trip.name });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { void audio.current?.play(); }],
      ['pause', () => audio.current?.pause()],
      ['seekbackward', (details) => { if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - (details.seekOffset ?? 10)); }],
      ['seekforward', (details) => { if (audio.current) audio.current.currentTime = Math.min(audio.current.duration || Infinity, audio.current.currentTime + (details.seekOffset ?? 10)); }],
      ['seekto', (details) => { if (audio.current && details.seekTime != null) audio.current.currentTime = details.seekTime; }],
    ];
    for (const [action, handler] of handlers) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
    return () => {
      for (const [action] of handlers) { try { navigator.mediaSession.setActionHandler(action, null); } catch {} }
      navigator.mediaSession.metadata = null;
    };
  }, [current, state.trip.name]);

  const play = (dayId: string, title: string) => {
    const element = audio.current;
    if (!element) return;
    if (current?.dayId !== dayId || !element.src) {
      element.src = `/api/trips/${encodeURIComponent(tripId)}/podcasts/${encodeURIComponent(dayId)}/audio?v=${encodeURIComponent(podcasts[dayId]?.updatedAt ?? '')}`;
      element.playbackRate = Number(rate);
      setCurrent({ dayId, title });
    }
    void element.play().catch(() => toast('Podcast konnte nicht abgespielt werden.'));
  };

  const regenerate = async (dayId: string) => {
    try {
      await api(`/trips/${encodeURIComponent(tripId)}/podcasts/${encodeURIComponent(dayId)}/regenerate`, { method: 'POST' });
      const info = await api<PodcastInfo>(`/trips/${encodeURIComponent(tripId)}/podcasts/${encodeURIComponent(dayId)}`);
      setPodcasts((previous) => ({ ...previous, [dayId]: info }));
      toast('Podcast wird neu erzeugt');
    } catch (error) { toast((error as Error).message); }
  };

  const player = <div className={`podcast-player${current ? '' : ' podcast-player-hidden'}`}>
      {current && <div className="podcast-player-head"><span><Headphones size={16} /> {current.title} <span className="muted small">KI-Podcast</span></span><button className="icon-btn" type="button" title="Player schließen" aria-label="Player schließen" onClick={() => { audio.current?.pause(); audio.current?.removeAttribute('src'); audio.current?.load(); setCurrent(null); }}><X size={18} /></button></div>}
      <div className="podcast-player-controls"><audio ref={audio} controls preload="none" onError={() => { if (current) toast('Podcast konnte nicht geladen werden.'); }} /><select aria-label="Wiedergabegeschwindigkeit" value={rate} onChange={(event) => { setRate(event.target.value); if (audio.current) audio.current.playbackRate = Number(event.target.value); }}><option value="0.75">0,75×</option><option value="1">1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></div>
      {current && !!podcasts[current.dayId]?.sources.length && <details className="podcast-sources"><summary>Quellen</summary>{podcasts[current.dayId].sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</details>}
    </div>;
  return <PodcastContext.Provider value={{ podcasts, play, regenerate, player }}>{children}</PodcastContext.Provider>;
}

export function PodcastPlayer() { return useContext(PodcastContext)?.player ?? null; }

export function PodcastButton({ dayId, title }: { dayId: string; title: string }) {
  const context = useContext(PodcastContext);
  const { user } = useTrip();
  if (!context) return null;
  const info = context.podcasts[dayId];
  if (!info) return null;
  const busy = info.status === 'queued' || info.status === 'generating';
  return <div className="podcast-day" onClick={(event) => event.stopPropagation()}>
    {info.available && <button className="btn small" type="button" onClick={() => context.play(dayId, title)}><Headphones size={16} /> Podcast</button>}
    {busy && <span className="small muted" role="status">{info.status === 'queued' ? 'Podcast vorgemerkt' : 'Podcast wird erstellt'}</span>}
    {info.stale && <span className="small muted">Ältere Aufnahme</span>}
    {info.status === 'failed' && <span className="small" role="status">Podcast fehlgeschlagen{user.role === 'admin' && info.error ? `: ${info.error}` : ''}</span>}
    {user.role === 'admin' && info.enabled && <button className="icon-btn" type="button" title="Podcast neu erzeugen" aria-label={`Podcast für ${title} neu erzeugen`} onClick={() => { if (confirm(`Podcast für „${title}“ auf dem Server neu erzeugen?`)) void context.regenerate(dayId); }}><RefreshCw size={16} /></button>}
  </div>;
}