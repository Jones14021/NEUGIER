export type Role = 'pending' | 'viewer' | 'editor' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: Role;
  createdAt: string;
}

export type EntityType = 'trip' | 'day' | 'stop' | 'expense' | 'memory' | 'comment';

export interface BaseEntity {
  id: string;
  /** Stabiler Schlüssel für (Re-)Import-Merge, z. B. "xl:camp:2026-12-20". */
  key?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Trip extends BaseEntity {
  name: string;
  /** Wird an Ortsnamen ohne Koordinaten angehängt (Google-Maps-Links, Suche). */
  region: string;
  startDate: string;
  endDate: string;
  currency: string;
  /** Mitreisende (für Ausgaben / Splid). */
  members: string[];
  notes: string;
}

export type ShowerStatus = 'ja' | 'nein' | 'unklar';

export interface Day extends BaseEntity {
  date: string; // YYYY-MM-DD
  title: string;
  /** Feste Termine, z. B. "Feiertag" oder "Abflug 12:20". */
  times: string;
  notes: string;
  /** Duschen wird getrennt vom Campen geplant. */
  shower: { status: ShowerStatus; note: string };
}

export type StopKind =
  | 'campsite'
  | 'accommodation'
  | 'activity'
  | 'hike'
  | 'sight'
  | 'food'
  | 'shower'
  | 'supply'
  | 'transport'
  | 'other';

/** main = Teil der Hauptroute (Gesamtreise), day = nur Tagesplanung. */
export type StopScope = 'main' | 'day';

export type CampType = '' | 'freedom' | 'doc' | 'holiday_park' | 'hotel';

export interface Stop extends BaseEntity {
  /** null = Ideen-Pool (noch keinem Tag zugeordnet). */
  dayId: string | null;
  order: number;
  scope: StopScope;
  kind: StopKind;
  name: string;
  notes: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  address?: string;
  time: string;
  duration: string;
  links: string[];
  booking: '' | 'offen' | 'gebucht';
  camp?: { type: CampType; powered: boolean; shower: boolean };
}

export interface Expense extends BaseEntity {
  dayId: string | null;
  stopId: string | null;
  title: string;
  amount: number | null;
  currency: string;
  paidBy: string;
  /** Leer = alle Mitreisenden. */
  splitBetween: string[];
  note: string;
}

export interface Memory extends BaseEntity {
  dayId: string | null;
  text: string;
  photos: string[];
  author: string;
  createdAt: string;
}

export interface Comment extends BaseEntity {
  /** ID von Tag oder Stopp. */
  targetId: string;
  text: string;
  author: string;
  authorId: string;
  createdAt: string;
}

export interface EntityMap {
  trip: Trip;
  day: Day;
  stop: Stop;
  expense: Expense;
  memory: Memory;
  comment: Comment;
}

export type AnyEntity = EntityMap[EntityType];

export interface TypedEntity<T extends EntityType = EntityType> {
  type: T;
  data: EntityMap[T];
}

export type Op =
  | { op: 'create'; type: EntityType; data: AnyEntity }
  | { op: 'update'; type: EntityType; id: string; patch: Record<string, unknown> }
  | { op: 'put'; type: EntityType; data: AnyEntity }
  | { op: 'delete'; type: EntityType; id: string };

export type ChangeSource = 'user' | 'ai' | 'import' | 'rollback' | 'seed';

export interface Change {
  id: number;
  batchId: string;
  type: EntityType;
  entityId: string;
  before: AnyEntity | null;
  after: AnyEntity | null;
  userName: string;
  source: ChangeSource;
  label: string;
  ts: string;
}

export interface TripState {
  trip: Trip;
  days: Day[];
  stops: Stop[];
  expenses: Expense[];
  memories: Memory[];
  comments: Comment[];
}

export interface TripExport {
  format: 'neugier-trip';
  version: 1;
  exportedAt: string;
  trip: Trip;
  days: Day[];
  stops: Stop[];
  expenses: Expense[];
  memories: Memory[];
  comments: Comment[];
}

export interface AppConfig {
  googleClientId: string;
  devLogin: boolean;
  mapsApiKey: string;
  mapId: string;
  llmConfigured: boolean;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSec: number;
}

export interface RouteResult {
  /** Dekodierte Punkte der Route. */
  path: { lat: number; lng: number }[];
  legs: RouteLeg[];
  /** true = Luftlinie (kein API-Key oder Fehler). */
  fallback: boolean;
}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
}
