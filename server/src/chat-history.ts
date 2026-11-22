import type { ChatMessage } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { db } from './db';

interface ConversationRow {
  id: string;
  title: string;
  messages: string;
  created_at: string;
  updated_at: string;
}

function parse(row: ConversationRow) {
  return { id: row.id, title: row.title, messages: JSON.parse(row.messages) as ChatMessage[], createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listConversations(userId: string, tripId: string) {
  return (db.prepare('SELECT id, title, created_at, updated_at FROM chat_conversations WHERE user_id = ? AND trip_id = ? ORDER BY updated_at DESC, id DESC').all(userId, tripId) as unknown as Omit<ConversationRow, 'messages'>[])
    .map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function getConversation(userId: string, tripId: string, id: string) {
  const row = db.prepare('SELECT id, title, messages, created_at, updated_at FROM chat_conversations WHERE id = ? AND user_id = ? AND trip_id = ?').get(id, userId, tripId) as unknown as ConversationRow | undefined;
  if (!row) throw Object.assign(new Error('Chat nicht gefunden'), { status: 404 });
  return parse(row);
}

export function createConversation(userId: string, tripId: string) {
  const id = newId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_conversations (id, user_id, trip_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, tripId, 'Neuer Chat', '[]', now, now);
  return getConversation(userId, tripId, id);
}

export function validateImportedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000 || JSON.stringify(value).length > 1_000_000) throw Object.assign(new Error('Ungültiger lokaler Chatverlauf'), { status: 400 });
  for (const message of value) {
    if (!message || typeof message !== 'object' || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000) throw Object.assign(new Error('Ungültige Chatnachricht'), { status: 400 });
    if (message.sources !== undefined && (!Array.isArray(message.sources) || message.sources.some((source: { title?: unknown; url?: unknown }) => {
      try { return typeof source?.title !== 'string' || typeof source.url !== 'string' || !['http:', 'https:'].includes(new URL(source.url).protocol); } catch { return true; }
    }))) throw Object.assign(new Error('Ungültige Chatquelle'), { status: 400 });
    if (message.proposal !== undefined && (!Array.isArray(message.proposal) || message.proposal.some((change: Record<string, unknown>) => {
      if (!change || typeof change !== 'object' || !['add', 'update', 'move', 'remove'].includes(String(change.action))) return true;
      if (change.action === 'add') return !change.stop || typeof change.stop !== 'object' || typeof (change.stop as { name?: unknown }).name !== 'string';
      if (typeof change.stopId !== 'string') return true;
      return change.action === 'update' && (!change.patch || typeof change.patch !== 'object');
    }))) throw Object.assign(new Error('Ungültiger Chatvorschlag'), { status: 400 });
  }
  return value as ChatMessage[];
}

export function saveConversation(userId: string, tripId: string, id: string, messages: ChatMessage[]) {
  const title = messages.find((message) => message.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Neuer Chat';
  const result = db.prepare('UPDATE chat_conversations SET title = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ? AND trip_id = ?')
    .run(title, JSON.stringify(messages), new Date().toISOString(), id, userId, tripId);
  if (!result.changes) throw Object.assign(new Error('Chat nicht gefunden'), { status: 404 });
  return getConversation(userId, tripId, id);
}

export function deleteConversation(userId: string, tripId: string, id: string): void {
  const result = db.prepare('DELETE FROM chat_conversations WHERE id = ? AND user_id = ? AND trip_id = ?').run(id, userId, tripId);
  if (!result.changes) throw Object.assign(new Error('Chat nicht gefunden'), { status: 404 });
}