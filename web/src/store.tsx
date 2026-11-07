import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppConfig, Change, Op, Trip, TripState, User } from '@neugier/shared';
import { applyOpsLocal, canSeePlanning } from '@neugier/shared';
import { api, ApiError, sendOps } from './api';

interface Presence {
  userId: string;
  name: string;
  dayId: string | null;
}

interface Pending {
  tripId: string;
  ops: Op[];
  label: string;
  source: 'user' | 'ai';
}

interface Ctx {
  config: AppConfig;
  user: User;
  /** null = noch nicht geladen. */
  trips: Trip[] | null;
  state: TripState | null;
  presence: Presence[];
  canEdit: boolean;
  /** Darf Tagesplanung, Ausgaben, Assistent etc. sehen (nicht Zuschauer). */
  canPlan: boolean;
  /** WebSocket verbunden. */
  online: boolean;
  /** Offline gespeicherte, noch nicht gesendete Änderungen. */
  pendingCount: number;
  /** Änderung anwenden (optimistisch; offline wird sie gespeichert und später gesendet). */
  apply: (ops: Op[], label: string, source?: 'user' | 'ai') => Promise<void>;
  selectTrip: (id: string) => void;
  setFocusDay: (dayId: string | null) => void;
  reload: () => Promise<void>;
  toast: (msg: string) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider fehlt');
  return c;
}

/** Wie useStore, garantiert aber eine geladene Reise. */
export function useTrip(): Ctx & { state: TripState } {
  const c = useStore();
  if (!c.state) throw new Error('Keine Reise geladen');
  return c as Ctx & { state: TripState };
}

const TRIP_KEY = 'neugier.trip';
const OUTBOX_KEY = 'neugier.outbox';
const stateKey = (id: string) => `neugier.state.${id}`;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Letzten Stand lokal sichern, damit die App ohne Netz (z. B. Milford Sound) weiter funktioniert. */
function persist(s: TripState | null) {
  if (!s) return;
  try {
    localStorage.setItem(stateKey(s.trip.id), JSON.stringify(s));
  } catch {
    /* Speicher voll – egal */
  }
}

export function StoreProvider({ config, user, children }: { config: AppConfig; user: User; children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [tripId, setTripId] = useState<string | null>(localStorage.getItem(TRIP_KEY));
  const [state, setStateRaw] = useState<TripState | null>(() => (tripId ? loadJson<TripState | null>(stateKey(tripId), null) : null));
  const [presence, setPresence] = useState<Presence[]>([]);
  const [online, setOnline] = useState(false);
  const [outbox, setOutbox] = useState<Pending[]>(() => loadJson<Pending[]>(OUTBOX_KEY, []));
  const [toastMsg, setToastMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const focusDay = useRef<string | null>(null);
  const flushing = useRef(false);

  const setState = useCallback((fn: TripState | null | ((s: TripState | null) => TripState | null)) => {
    setStateRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      persist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  }, [outbox]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? '' : m)), 3500);
  }, []);

  /** Server-Stand laden und noch nicht gesendete lokale Änderungen darüberlegen. */
  const fetchState = useCallback(
    async (id: string) => {
      const s = await api<TripState>(`/trips/${id}`);
      const mine = loadJson<Pending[]>(OUTBOX_KEY, []).filter((p) => p.tripId === id);
      setState(mine.reduce((acc, p) => applyOpsLocal(acc, p.ops), s));
    },
    [setState],
  );

  const reload = useCallback(async () => {
    try {
      const list = await api<Trip[]>('/trips');
      setTrips(list);
      const id = list.find((t) => t.id === tripId)?.id ?? list[0]?.id ?? null;
      if (id !== tripId) setTripId(id);
      if (id) await fetchState(id);
    } catch (e) {
      // Offline: mit lokal gespeichertem Stand weiterarbeiten
      if (!(e instanceof ApiError)) {
        const cached = tripId ? loadJson<TripState | null>(stateKey(tripId), null) : null;
        setTrips(cached ? [cached.trip] : []);
      } else throw e;
    }
  }, [tripId, fetchState]);

  useEffect(() => {
    reload().catch((e) => toast(e.message));
  }, [reload, toast]);

  /** Outbox der Reihe nach senden. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let queue = loadJson<Pending[]>(OUTBOX_KEY, []);
      while (queue.length) {
        const p = queue[0];
        try {
          await sendOps(p.tripId, p.ops, p.label, p.source);
        } catch (e) {
          if (!(e instanceof ApiError)) break; // weiterhin offline
          toast(`Offline-Änderung verworfen: ${p.label} (${e.message})`);
        }
        queue = queue.slice(1);
        setOutbox(queue);
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
      }
    } finally {
      flushing.current = false;
    }
  }, [toast]);

  const subscribe = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && tripId) {
      ws.send(JSON.stringify({ type: 'subscribe', tripId, dayId: focusDay.current }));
    }
  }, [tripId]);

  // WebSocket mit automatischem Reconnect; nach Reconnect Outbox senden und Stand neu laden
  useEffect(() => {
    if (!tripId) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = async () => {
        setOnline(true);
        subscribe();
        await flush();
        fetchState(tripId).catch(() => {});
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'changes') setState((s) => (s ? applyChanges(s, msg.changes) : s));
        if (msg.type === 'state') setState(msg.state);
        if (msg.type === 'presence') setPresence(msg.users);
      };
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    addEventListener('online', flush);
    return () => {
      stopped = true;
      clearTimeout(retry);
      removeEventListener('online', flush);
      wsRef.current?.close();
    };
  }, [tripId, subscribe, flush, fetchState, setState]);

  const apply = useCallback(
    async (ops: Op[], label: string, source: 'user' | 'ai' = 'user') => {
      if (!tripId || !ops.length) return;
      setState((s) => (s ? applyOpsLocal(s, ops) : s));
      const queued = loadJson<Pending[]>(OUTBOX_KEY, []);
      // Solange noch etwas in der Warteschlange ist, hinten anstellen (Reihenfolge bleibt erhalten)
      if (queued.length || !navigator.onLine) {
        const next = [...queued, { tripId, ops, label, source }];
        setOutbox(next);
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
        void flush();
        return;
      }
      try {
        await sendOps(tripId, ops, label, source);
      } catch (e) {
        if (e instanceof ApiError) {
          toast(`Fehler: ${e.message}`);
          fetchState(tripId).catch(() => {});
        } else {
          const next = [...loadJson<Pending[]>(OUTBOX_KEY, []), { tripId, ops, label, source }];
          setOutbox(next);
          localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
          toast('Offline – Änderung wird gesendet, sobald wieder Netz da ist');
        }
      }
    },
    [tripId, toast, flush, fetchState, setState],
  );

  const selectTrip = useCallback((id: string) => {
    localStorage.setItem(TRIP_KEY, id);
    setTripId(id);
  }, []);

  const setFocusDay = useCallback(
    (dayId: string | null) => {
      focusDay.current = dayId;
      subscribe();
    },
    [subscribe],
  );

  const canPlan = canSeePlanning(user.role);
  const value = useMemo<Ctx>(
    () => ({
      config,
      user,
      trips,
      state,
      presence,
      online,
      pendingCount: outbox.length,
      canEdit: canPlan,
      canPlan,
      apply,
      selectTrip,
      setFocusDay,
      reload,
      toast,
    }),
    [config, user, trips, state, presence, online, outbox.length, canPlan, apply, selectTrip, setFocusDay, reload, toast],
  );

  return (
    <StoreCtx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </StoreCtx.Provider>
  );
}

function applyChanges(s: TripState, changes: Change[]): TripState {
  const ops: Op[] = changes.map((c) =>
    c.after ? { op: 'put', type: c.type, data: c.after } : { op: 'delete', type: c.type, id: c.entityId },
  );
  return applyOpsLocal(s, ops);
}
