import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { Role, User } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { config } from './config';
import { db } from './db';

const COOKIE = 'neugier_session';
const RANK: Record<Role, number> = { pending: 0, viewer: 1, editor: 2, admin: 3 };
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: Role;
  created_at: string;
}

function rowToUser(r: UserRow): User {
  return { id: r.id, email: r.email, name: r.name, picture: r.picture, role: r.role, createdAt: r.created_at };
}

export function listUsers(): User[] {
  return (db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]).map(rowToUser);
}

export function setRole(userId: string, role: Role): void {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

export function deleteUser(userId: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function upsertUser(email: string, name: string, picture: string): User {
  email = email.toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined;
  if (existing) {
    db.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?').run(name, picture, existing.id);
    if (config.adminEmails.includes(email) && existing.role !== 'admin') setRole(existing.id, 'admin');
    return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as unknown as UserRow);
  }
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  // Der erste Nutzer und konfigurierte Admin-E-Mails werden automatisch Admin
  const role: Role = count === 0 || config.adminEmails.includes(email) ? 'admin' : 'pending';
  const user: User = { id: newId(), email, name, picture, role, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO users (id, email, name, picture, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.name,
    user.picture,
    user.role,
    user.createdAt,
  );
  return user;
}

function createSession(res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    new Date().toISOString(),
  );
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 365 });
}

export function userFromCookieHeader(header: string | undefined): User | undefined {
  const token = parseCookies(header)[COOKIE];
  if (!token) return undefined;
  const row = db
    .prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?')
    .get(token) as unknown as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
    if (RANK[req.user.role] < RANK[role]) return res.status(403).json({ error: 'Keine Berechtigung' });
    next();
  };
}

export async function loginGoogle(req: Request, res: Response): Promise<void> {
  if (!googleClient) {
    res.status(400).json({ error: 'Google Login nicht konfiguriert' });
    return;
  }
  const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.email) {
    res.status(400).json({ error: 'Kein E-Mail im Token' });
    return;
  }
  const user = upsertUser(p.email, p.name || p.email, p.picture || '');
  createSession(res, user.id);
  res.json(user);
}

export function loginDev(req: Request, res: Response): void {
  if (!config.devLogin) {
    res.status(400).json({ error: 'Dev-Login deaktiviert' });
    return;
  }
  const email = String(req.body.email || '').trim();
  const name = String(req.body.name || '').trim() || email;
  if (!email.includes('@')) {
    res.status(400).json({ error: 'Bitte gültige E-Mail angeben' });
    return;
  }
  const user = upsertUser(email, name, '');
  createSession(res, user.id);
  res.json(user);
}

export function logout(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}
