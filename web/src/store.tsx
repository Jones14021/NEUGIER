import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppConfig, Change, Op, Trip, TripState, User } from '@neugier/shared';
import { applyOpsLocal } from '@neugier/shared';
import { api, sendOps } from './api';

interface Presence {
  userId: string;
  name: string;
  dayId: string | null;
}

interface Ctx {
  config: AppConfig;
  user: User;
  /** null = noch nicht geladen. */
  trips: Trip[] | null;
  state: TripState | null;
  presence: Presence[];
  canEdit: boolean;
  online: boolean;
  /** Änderung anwenden (optimistisch, danach per WebSocket bestätigt). */
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

export function StoreProvider({ config, user, children }: { config: AppConfig; user: User; children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [tripId, setTripId] = useState<string | null>(localStorage.getItem(TRIP_KEY));
  const [state, setState] = useState<TripState | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [online, setOnline] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const focusDay = useRef<string | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? '' : m)), 3500);
  }, []);

  const reload = useCallback(async () => {
    const list = await api<Trip[]>('/trips');
    setTrips(list);
    const id = list.find((t) => t.id === tripId)?.id ?? list[0]?.id ?? null;
    if (id !== tripId) setTripId(id);
    if (id) setState(await api<TripState>(`/trips/${id}`));
  }, [tripId]);

  useEffect(() => {
    reload().catch((e) => toast(e.message));
  }, [reload, toast]);

  const subscribe = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && tripId) {
      ws.send(JSON.stringify({ type: 'subscribe', tripId, dayId: focusDay.current }));
    }
  }, [tripId]);

  // WebSocket mit automatischem Reconnect; nach Reconnect kompletten Stand neu laden
  useEffect(() => {
    if (!tripId) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setOnline(true);
        subscribe();
        api<TripState>(`/trips/${tripId}`).then(setState).catch(() => {});
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'changes') setState((s) => (s ? applyChanges(s, msg.changes) : s));
        if (msg.type === 'presence') setPresence(msg.users);
      };
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [tripId, subscribe]);

  const apply = useCallback(
    async (ops: Op[], label: string, source: 'user' | 'ai' = 'user') => {
      if (!tripId || !ops.length) return;
      setState((s) => (s ? applyOpsLocal(s, ops) : s));
      try {
        await sendOps(tripId, ops, label, source);
      } catch (e) {
        toast(`Fehler: ${(e as Error).message}`);
        setState(await api<TripState>(`/trips/${tripId}`));
      }
    },
    [tripId, toast],
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

  const value = useMemo<Ctx>(
    () => ({
      config,
      user,
      trips,
      state,
      presence,
      online,
      canEdit: user.role === 'editor' || user.role === 'admin',
      apply,
      selectTrip,
      setFocusDay,
      reload,
      toast,
    }),
    [config, user, trips, state, presence, online, apply, selectTrip, setFocusDay, reload, toast],
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
