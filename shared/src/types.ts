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
export type Availability = ShowerStatus;

export interface Facilities {
  power: Availability;
  water: Availability;
  /** Dump-Station für Schwarzwasser. */
  dump: Availability;
}

export interface Day extends BaseEntity {
  date: string; // YYYY-MM-DD
  title: string;
  /** Feste Termine, z. B. "Feiertag" oder "Abflug 12:20". */
  times: string;
  /** Markdown-light (fett, kursiv, Listen, Links). */
  notes: string;
  /** Duschen wird getrennt vom Campen geplant. */
  shower: { status: ShowerStatus; note: string };
  facilities?: Facilities;
  /** URL des Titelbilds (Upload oder aus Erinnerungen). */
  cover?: string;
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
  camp?: { type: CampType; powered?: boolean; shower?: boolean };
  /** Server konnte keine Koordinaten zum Namen/zur Adresse finden. */
  geoFailed?: boolean;
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
  webSearch: boolean;
}

export interface RouteLeg {
  /** 0 = keine Straßenroute gefunden (Luftlinie). */
  distanceMeters: number;
  durationSec: number;
  path?: { lat: number; lng: number }[];
}

export interface RouteResult {
  /** Dekodierte Punkte der Route. */
  path: { lat: number; lng: number }[];
  /** Eine Etappe pro aufeinanderfolgendem Punktepaar. */
  legs: RouteLeg[];
  /** true = mindestens eine Etappe nur als Luftlinie (kein API-Key oder keine Route). */
  fallback: boolean;
}

/** Vom KI-Assistenten vorgeschlagene Änderung (wird im Diff angezeigt, nicht direkt angewendet). */
export type ProposedChange =
  | {
      action: 'add';
      /** Datum des Tages (YYYY-MM-DD) oder null für Ideen-Pool. */
      date: string | null;
      /** Einfügen nach diesem Stopp (null = am Anfang). */
      afterStopId: string | null;
      stop: Pick<Stop, 'name' | 'kind' | 'scope' | 'notes'> & Partial<Pick<Stop, 'lat' | 'lng' | 'placeId' | 'address' | 'time' | 'duration'>>;
      reason: string;
    }
  | { action: 'update'; stopId: string; patch: Partial<Pick<Stop, 'name' | 'kind' | 'scope' | 'notes' | 'time' | 'duration'>>; reason: string }
  | { action: 'move'; stopId: string; date: string | null; afterStopId: string | null; reason: string }
  | { action: 'remove'; stopId: string; reason: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  proposal?: ProposedChange[];
  sources?: { title: string; url: string }[];
}

export interface ChatResponse {
  content: string;
  proposal: ProposedChange[];
  sources: { title: string; url: string }[];
}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
}
