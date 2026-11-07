import type { CampType, Role, ShowerStatus, StopKind, StopScope } from './types';

export const KIND_LABEL: Record<StopKind, string> = {
  campsite: 'Campingplatz',
  accommodation: 'Unterkunft',
  activity: 'Aktivität',
  hike: 'Wanderung',
  sight: 'Sehenswürdigkeit',
  food: 'Café / Essen',
  shower: 'Dusche',
  supply: 'Einkauf / Versorgung',
  transport: 'Transport',
  other: 'Sonstiges',
};

export const KIND_ICON: Record<StopKind, string> = {
  campsite: '⛺',
  accommodation: '🛏',
  activity: '⭐',
  hike: '🥾',
  sight: '📷',
  food: '☕',
  shower: '🚿',
  supply: '🛒',
  transport: '✈',
  other: '•',
};

export const KIND_COLOR: Record<StopKind, string> = {
  campsite: '#2f7d4f',
  accommodation: '#2f7d4f',
  activity: '#d9822b',
  hike: '#8a5a2b',
  sight: '#6b5bd6',
  food: '#c2527a',
  shower: '#2a8bbf',
  supply: '#5f6b7a',
  transport: '#334155',
  other: '#64748b',
};

/** Stopp-Arten, die standardmäßig Teil der Hauptroute sind. */
export const MAIN_KINDS: StopKind[] = ['campsite', 'accommodation', 'transport'];

export function defaultScope(kind: StopKind): StopScope {
  return MAIN_KINDS.includes(kind) ? 'main' : 'day';
}

export const SCOPE_LABEL: Record<StopScope, string> = {
  main: 'Hauptroute',
  day: 'Nur Tagesroute',
};

export const CAMP_LABEL: Record<CampType, string> = {
  '': '–',
  freedom: 'Freedom Camping',
  doc: 'DOC Campsite',
  holiday_park: 'Holiday Park',
  hotel: 'Hotel / B&B',
};

export const SHOWER_LABEL: Record<ShowerStatus, string> = {
  ja: 'Duschen möglich',
  nein: 'Keine Dusche',
  unklar: 'Dusche unklar',
};

export const FACILITY_LABEL = {
  power: { ja: 'Strom', nein: 'Kein Strom', unklar: 'Strom?' },
  water: { ja: 'Frischwasser', nein: 'Kein Frischwasser', unklar: 'Frischwasser?' },
  dump: { ja: 'Dump-Station', nein: 'Keine Dump-Station', unklar: 'Dump-Station?' },
} as const;

/** Zuschauer sehen nur Reise-Übersicht und Erinnerungen. */
export function canSeePlanning(role: Role): boolean {
  return role === 'editor' || role === 'admin';
}

export const ROLE_LABEL: Record<Role, string> = {
  pending: 'Wartet auf Freigabe',
  viewer: 'Zuschauer (Reise + Erinnerungen)',
  editor: 'Mitarbeiter',
  admin: 'Admin',
};
