import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Change, Role, TripState } from '@neugier/shared';
import { canSeePlanning } from '@neugier/shared';
import { viewerState } from './api';
import { userFromCookieHeader } from './auth';
import { events, getState } from './store';

interface Client {
  ws: WebSocket;
  tripId: string | null;
  name: string;
  userId: string;
  role: Role;
  dayId: string | null;
}

/**
 * Live-Collab: Clients abonnieren eine Reise und bekommen alle Änderungen sofort.
 * Zusätzlich Präsenz (wer ist gerade online, auf welchem Tag).
 */
export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<Client>();

  const presence = (tripId: string) => {
    const list = [...clients]
      .filter((c) => c.tripId === tripId)
      .map((c) => ({ userId: c.userId, name: c.name, dayId: c.dayId }));
    for (const c of clients) if (c.tripId === tripId) send(c.ws, { type: 'presence', users: list });
  };

  wss.on('connection', (ws, req) => {
    const user = userFromCookieHeader(req.headers.cookie);
    if (!user || user.role === 'pending') {
      ws.close(4401, 'unauthorized');
      return;
    }
    const client: Client = { ws, tripId: null, name: user.name, userId: user.id, role: user.role, dayId: null };
    clients.add(client);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'subscribe') {
          const prev = client.tripId;
          client.tripId = msg.tripId;
          client.dayId = msg.dayId ?? null;
          if (prev && prev !== client.tripId) presence(prev);
          if (client.tripId) presence(client.tripId);
        }
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => {
      clients.delete(client);
      if (client.tripId) presence(client.tripId);
    });
  });

  events.on('change', ({ tripId, changes }: { tripId: string; changes: Change[] }) => {
    let viewerSnapshot: TripState | null | undefined;
    for (const c of clients) {
      if (c.tripId !== tripId) continue;
      if (canSeePlanning(c.role)) send(c.ws, { type: 'changes', changes });
      else {
        // Zuschauer bekommen statt Einzeländerungen den gefilterten Gesamtstand
        viewerSnapshot ??= (() => {
          const s = getState(tripId);
          return s ? viewerState(s) : null;
        })();
        if (viewerSnapshot) send(c.ws, { type: 'state', state: viewerSnapshot });
      }
    }
  });

  // Keep-alive (Tailscale/Proxies schließen sonst inaktive Verbindungen)
  setInterval(() => {
    for (const c of clients) if (c.ws.readyState === c.ws.OPEN) c.ws.ping();
  }, 30000);
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
