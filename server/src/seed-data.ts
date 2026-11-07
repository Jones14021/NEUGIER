import type { Availability, CampType, ShowerStatus, Stop, StopKind, StopScope } from '@neugier/shared';

// Aus "Routenplanung (2).xlsx" (Blatt "Reiseverlauf") übernommen.
// Koordinaten sind Näherungen; Stopps ohne Koordinaten werden serverseitig per Google geokodiert.

/** Erhöhen, wenn sich die Seed-Daten ändern – bestehende Datenbanken werden dann synchronisiert. */
export const SEED_VERSION = 2;

type BookingState = Stop['booking'];

export interface SeedStop {
  name: string;
  kind: StopKind;
  scope?: StopScope;
  at?: [number, number];
  notes?: string;
  time?: string;
  duration?: string;
  links?: string[];
  booking?: BookingState;
  camp?: CampType;
}

export interface SeedDay {
  date: string;
  title: string;
  times?: string;
  notes?: string;
  shower?: [ShowerStatus, string];
  power?: Availability;
  water?: Availability;
  dump?: Availability;
  stops: SeedStop[];
  expenses?: { title: string; amount: number | null; currency?: string; paidBy?: string; note?: string }[];
}

export const SEED_TRIP = {
  name: 'Neuseeland 2026/27',
  region: 'Neuseeland',
  startDate: '2026-12-14',
  endDate: '2027-01-20',
  currency: 'EUR',
  members: [] as string[],
  notes: '',
};

const camp = (name: string, at: [number, number] | undefined, o: Partial<SeedStop> = {}): SeedStop => ({
  name,
  kind: 'campsite',
  at,
  ...o,
});

const KOMOOT = (id: string, token: string) =>
  `https://www.komoot.com/de-de/tour/${id}?share_token=${token}&ref=wtd&t_s=referral&t_cid=route_share&t_ref_username=3298652191339`;

const HOLIDAY_PARK = { power: 'ja', water: 'ja', dump: 'unklar' } as const;
const FREEDOM = { power: 'nein', water: 'unklar', dump: 'unklar' } as const;

export const SEED_DAYS: SeedDay[] = [
  {
    date: '2026-12-14',
    title: 'Abflug in München',
    times: 'Abflug MUC 12:20',
    stops: [{ name: 'Flughafen München (MUC)', kind: 'transport', scope: 'day', at: [48.3538, 11.7861], time: '12:20' }],
  },
  { date: '2026-12-15', title: 'Flug', stops: [] },
  {
    date: '2026-12-16',
    title: 'Ankunft in Auckland',
    times: 'Ankunft AKL 05:50',
    notes: 'Check-in ab 14:00\nGebucht über Booking (Theresa)',
    shower: ['ja', 'im Hotel'],
    stops: [
      { name: 'Flughafen Auckland (AKL)', kind: 'transport', at: [-37.0082, 174.785], time: '05:50' },
      { name: 'Dumplings essen :)', kind: 'food', notes: 'Auckland' },
      {
        name: 'Manha Hotel Auckland Airport',
        kind: 'accommodation',
        camp: 'hotel',
        booking: 'gebucht',
        notes: 'Check-in ab 14:00, gebucht über Booking (Theresa)',
      },
    ],
    expenses: [{ title: 'Unterkunft Auckland (Manha Hotel)', amount: 100, paidBy: 'Theresa', note: 'Übernachtung pro Person: 50 €' }],
  },
  {
    date: '2026-12-17',
    title: 'Camper-Übernahme → Ruakaka Beach',
    times: 'Camper-Übernahme 10:00',
    notes: 'Fahrt von Auckland Camper-Übernahme: 2 h.\nCampsite buchen, sobald wir wissen, wann wir den Camper bekommen.',
    shower: ['unklar', 'Freedom: nein (Uretiti hätte eine)'],
    stops: [
      { name: 'Camper-Übernahme Auckland', kind: 'transport', time: '10:00' },
      { name: 'Ruakaka Beach', kind: 'sight', at: [-35.909, 174.457], time: '13:00' },
      camp('Uretiti Beach Campsite (DOC)', [-35.873, 174.442], {
        camp: 'doc',
        booking: 'offen',
        notes: 'Vorher buchen oder eine der zahlreichen Freedom Campsites nutzen',
      }),
    ],
  },
  {
    date: '2026-12-18',
    title: "Smuggler's Bay, Ocean Beach, Matapouri",
    notes: 'Gezeiten beachten (bei Flut bleibt kaum Strand übrig).\n1 h zum Ocean Beach; dann weiter nach Norden nach Matapouri (nochmal 1 h 15 min).',
    shower: ['nein', 'Dusche auf dem Weg in Tutukaka auf dem Campingplatz'],
    ...FREEDOM,
    stops: [
      { name: "Smuggler's Bay", kind: 'hike', at: [-35.851, 174.534] },
      { name: 'Ocean Beach (Whangarei Heads)', kind: 'sight', at: [-35.857, 174.565] },
      { name: 'Dusche Tutukaka (Campingplatz)', kind: 'shower', at: [-35.612, 174.528] },
      { name: 'Matapouri Bay', kind: 'sight', at: [-35.565, 174.505] },
      { name: 'Whale Bay', kind: 'hike', at: [-35.557, 174.508] },
      camp('Woolleys Bay (Western Carpark)', [-35.553, 174.488], { camp: 'freedom', notes: 'Freedom. Alternative: Sandy Bay Carpark (freedom)' }),
    ],
  },
  {
    date: '2026-12-19',
    title: 'Matapouri → Tararu',
    notes: 'Reisetag (ca. 4 h)',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [camp('Tararu Beachfront North Reserve', [-37.118, 175.515], { camp: 'freedom' })],
  },
  {
    date: '2026-12-20',
    title: 'Coromandel, Otama Beach, Cathedral Cove → Tairua',
    notes:
      'Reise- & Strandtag.\nTararu → Coromandel (1 h) → Otama Beach (45 min) → Cathedral Cove & Hahei Beach (55 min; eventuell weglassen, wenn es zeitlich eng wird) → Tairua (30 min)',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Coromandel Town', kind: 'sight', at: [-36.761, 175.499] },
      { name: 'Otama Beach', kind: 'sight', at: [-36.703, 175.77] },
      { name: 'Cathedral Cove & Hahei Beach', kind: 'hike', at: [-36.828, 175.79], notes: 'Eventuell weglassen, wenn es zeitlich eng wird' },
      camp('Tairua Campsite (Paradise Camping)', [-37.006, 175.848], {
        camp: 'holiday_park',
        links: [
          'https://checkout.lodgify.com/paradise-camping/272879/room?currency=EUR&arrival=2026-12-20&departure=2026-12-21&adults=2&roomId=333325',
        ],
      }),
    ],
  },
  {
    date: '2026-12-21',
    title: 'Hobbiton & Blue Spring',
    notes:
      'Tairua → Hobbiton Movie Set (Matamata) (1 h 40 min) → Tour (3 h) → Putaruru Blue Spring (30 min) → über Rotorua (See) zur Campsite (ca. 1 h).\n' +
      'Tickets bald schon buchen (3 h Tour) → Alarm eingestellt für Hobbiton Movie Set.',
    shower: ['nein', 'self contained'],
    ...FREEDOM,
    stops: [
      { name: 'Hobbiton Movie Set', kind: 'activity', at: [-37.8721, 175.6829], duration: '3 h', booking: 'offen' },
      { name: 'Blue Spring Putaruru (Te Waihou Walkway)', kind: 'hike', at: [-38.073, 175.858] },
      camp('Guy Roe Reserve Campground', undefined, { camp: 'freedom', notes: 'Self contained' }),
    ],
    expenses: [{ title: 'Hobbiton Tour', amount: 136, note: '68 Euro / Person' }],
  },
  {
    date: '2026-12-22',
    title: 'Wai-O-Tapu → Motutere',
    notes:
      'Campsite → Wai-O-Tapu (Thermal Wonderland) (14 min): Tour (3 h, 3 km) → über Taupo zum Campingplatz (1 h 15 min).\nFrüh dort zu sein lohnt sich (öffnet 8:30).',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Wai-O-Tapu Thermal Wonderland', kind: 'activity', at: [-38.3566, 176.37], time: '08:30', duration: '3 h' },
      camp('Motutere Top 10 Holiday Park', [-38.919, 175.955], { camp: 'holiday_park' }),
    ],
    expenses: [{ title: 'Wai-O-Tapu Eintritt', amount: 51, note: '51 Euro / 2 Personen (25,50 € p. P.)' }],
  },
  {
    date: '2026-12-23',
    title: 'Tongariro Alpine Crossing',
    times: 'MUST have!',
    notes:
      'Wanderung: Tongariro Alpine Crossing (20 km; 750 hm; 5 h ohne Pausen).\nParkplatz bei Ketetahi (Ziel) → Camper abstellen, Shuttle zum Startpunkt Mangatepopo Carpark.\n' +
      'Tickets für Wandershuttle unbedingt vorher reservieren!\nPuffer einplanen, falls Schlechtwetter (mind. 2 Tage am selben Campground).',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Ketetahi Carpark (Camper abstellen)', kind: 'transport', scope: 'day', at: [-39.0789, 175.6533] },
      {
        name: 'Tongariro Alpine Crossing (Start Mangatepopo)',
        kind: 'hike',
        at: [-39.1446, 175.5803],
        duration: '5 h',
        booking: 'offen',
        links: [
          KOMOOT('3242088781', 'aQ794Yi6NrmQbUaqT7pVsGl2c5rMM8tzdD0PMzh17CzpFIHxL6'),
          'https://www.tripadvisor.de/AttractionProductReview-g616351-d21086544-Tongariro_Crossing_Secure_Parking_Shuttle_one_way-Tongariro_National_Park_Manawatu.html',
        ],
      },
      camp('Motuoapa Bay Holiday Park', [-38.9298, 175.871], { camp: 'holiday_park' }),
    ],
    expenses: [{ title: 'Tongariro Shuttle', amount: 81, note: '81 Euro / 2 Personen' }],
  },
  {
    date: '2026-12-24',
    title: 'Taranaki Falls / Restday',
    notes: 'Restday',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Taranaki Falls', kind: 'hike', at: [-39.2167, 175.56] },
      camp('Motuoapa Bay Holiday Park', [-38.9298, 175.871], { camp: 'holiday_park' }),
    ],
  },
  {
    date: '2026-12-25',
    title: 'Taupo, Tama Lakes, Umukarikari',
    times: 'Feiertag',
    notes: 'Größere Wanderung',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Tama Lakes', kind: 'hike', at: [-39.205, 175.6] },
      { name: 'Mount Umukarikari', kind: 'hike', at: [-39.03, 175.83] },
      camp('Motuoapa Bay Holiday Park', [-38.9298, 175.871], { camp: 'holiday_park' }),
    ],
    expenses: [{ title: 'Motuoapa Bay Holiday Park (4 Nächte)', amount: 150, note: '150 Euro / 2 Personen (75 € p. P.)' }],
  },
  {
    date: '2026-12-26',
    title: 'Glühwürmchen & Three Sisters',
    times: 'Feiertag',
    notes: 'Turangi → Glühwürmchen (2 h 15 min) → Glühwürmchentour (ca. 2 h insgesamt) → Three Sisters (1,5 h) → Campingplatz freedom.\nGlühwürmchentour müssen wir noch buchen.',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [
      { name: 'Glühwürmchentour (Waitomo Caves)', kind: 'activity', at: [-38.261, 175.104], duration: '2 h', booking: 'offen' },
      { name: 'Three Sisters (Tongaporutu)', kind: 'sight', at: [-38.811, 174.588] },
      camp('Freedom Camping bei Three Sisters', [-38.815, 174.594], {
        camp: 'freedom',
        notes: 'Direkt bei Three Sisters oder schon in Richtung Nationalpark',
      }),
    ],
  },
  {
    date: '2026-12-27',
    title: 'Taranaki: Henry Peak',
    notes:
      'Three Sisters → Mangorei Carpark (1 h 15 min). Te Papa-Kura-o-Taranaki / New Plymouth.\nFahrt dahin über Forgotten World Highway (landschaftlich sehr schön :)',
    shower: ['unklar', 'Bezahlter Platz in New Plymouth hätte Dusche'],
    stops: [
      { name: 'Mangorei Carpark', kind: 'transport', scope: 'day', at: [-39.145, 174.122] },
      {
        name: 'Wanderung Henry Peak Runde',
        kind: 'hike',
        notes: '22 km, 1.200 hm, 8,5 h\nRoute nochmal checken, ob man dort überhaupt parken kann',
        duration: '8,5 h',
      },
      camp('Campingplatz New Plymouth', [-39.0556, 174.0752], {
        notes: 'Freedom Campingplatz im Nationalpark oder bezahlter in New Plymouth (mit Dusche)',
      }),
    ],
  },
  {
    date: '2026-12-28',
    title: 'Westküste → Wellington',
    notes: 'Reisetag an der Westküste entlang nach Wellington (4 h)',
    ...FREEDOM,
    stops: [camp('Freedom Camping Paraparaumu', [-40.914, 175.006], { camp: 'freedom', notes: 'Oder Porirua' })],
  },
  {
    date: '2026-12-29',
    title: 'Fähre Wellington → Picton → Abel Tasman',
    times: 'Fähre ab Wellington 08:45 · Ankunft Picton 12:15',
    notes: 'Picton → Campingplatz (3 h). Keine Deadline für Check-in :)',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Fährterminal Wellington', kind: 'transport', at: [-41.2789, 174.7811], time: '08:45' },
      { name: 'Fährterminal Picton', kind: 'transport', at: [-41.29, 174.003], time: '12:15' },
      { name: 'Coquille Bay (Spaziergang)', kind: 'hike', at: [-40.997, 173.017], notes: 'Evtl. noch laufen (48 min vom Campingplatz aus)' },
      camp('The Barn Cabins & Camp (Marahau)', [-41.0047, 173.008], {
        camp: 'holiday_park',
        booking: 'gebucht',
        notes: 'Abel Tasman Campingplatz, gebucht (Theresa)',
      }),
    ],
    expenses: [{ title: 'The Barn Cabins & Camp', amount: 360, currency: 'NZD', paidBy: 'Theresa', note: '360 Dollar / 2 Personen (90 NZD p. P.)' }],
  },
  {
    date: '2026-12-30',
    title: 'Coquille Bay Wanderung (Abel Tasman)',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Wanderung: Blick auf die Coquille Bay', kind: 'hike', at: [-40.997, 173.017], notes: '22 km, 380 hm, 6,5 h', duration: '6,5 h' },
      camp('The Barn Cabins & Camp (Marahau)', [-41.0047, 173.008], { camp: 'holiday_park', booking: 'gebucht' }),
    ],
  },
  {
    date: '2026-12-31',
    title: 'Wassertaxi → Collingwood',
    times: 'SILVESTER',
    notes: 'Fahrt zu einer weiteren Bucht (Wassertaxis), danach Weiterfahrt zum Collingwood Holiday Park (1,5 h).\nCheck-in bis max. 20:00.',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Wassertaxi Bark Bay', kind: 'activity', at: [-40.92, 173.059], notes: 'Sarah war an der Bark Bay' },
      camp('Collingwood Holiday Park', [-40.6764, 172.6806], {
        camp: 'holiday_park',
        booking: 'gebucht',
        notes: 'Gebucht (Theresa). Check-in bis 20:00 max',
      }),
    ],
    expenses: [{ title: 'Collingwood Holiday Park', amount: 40, paidBy: 'Theresa', note: '40 Euro / 2 Personen (20 € p. P.)' }],
  },
  {
    date: '2027-01-01',
    title: 'Wharariki Beach → Murchison',
    times: 'Feiertag',
    notes: 'Collingwood → Wharariki Beach (30 min) → (ca. 3,5 h Fahrt) Nähe Murchison.\nRiverside Holiday Park hat eigentlich immer Platz bei non-powered.',
    shower: ['nein', ''],
    stops: [
      { name: 'Wharariki Beach', kind: 'sight', at: [-40.5065, 172.6862], notes: 'Strand genießen' },
      camp('Riverside Holiday Park Murchison', [-41.795, 172.34], { camp: 'holiday_park', notes: 'Murchison hat 2 Campingplätze, Favorit: Riverside' }),
    ],
  },
  {
    date: '2027-01-02',
    title: 'Westküste: Punakaiki → Greymouth',
    notes: 'Murchison → Westküste (Irimahuwhero Lookout, Punakaiki Beach & Pancake Rocks, Motukiekie Beach Walk) → Greymouth (insgesamt 2,75 h Fahrt).\nProgramm Westküste?',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [
      { name: 'Irimahuwhero Lookout', kind: 'sight' },
      { name: 'Punakaiki Pancake Rocks', kind: 'sight', at: [-42.1137, 171.327] },
      { name: 'Motukiekie Beach Walk', kind: 'hike', at: [-42.31, 171.27] },
      camp('Cobden Beachfront (Greymouth)', [-42.437, 171.2], { camp: 'freedom', notes: 'Freedom, sehr schön' }),
    ],
  },
  {
    date: '2027-01-03',
    title: "Arthur's Pass → Mount Somers",
    notes:
      "Greymouth Strand genießen → Arthur's Pass → Mount Somers Holiday Park (oder anderer Campspot auf dem Weg), insgesamt 3,5 h Fahrt.\nNoch nicht gebucht! Machen wir spontan, je nachdem wie weit wir fahren.",
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: "Arthur's Pass", kind: 'sight', at: [-42.94, 171.562] },
      camp('Mount Somers Holiday Park', [-43.705, 171.395], { camp: 'holiday_park', booking: 'offen', notes: 'Oder anderer Campspot auf dem Weg' }),
    ],
  },
  {
    date: '2027-01-04',
    title: 'Lake Tekapo → Lake Pukaki',
    notes: 'Lake Tekapo & Lake Pukaki erkunden & Reisetag (2,5 h).\nFrüh da sein, sonst gibt es keine Plätze mehr!',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [
      { name: 'Lake Tekapo', kind: 'sight', at: [-44.004, 170.477] },
      camp('Lake Pukaki Overnight Campervan Parking', [-44.183, 170.137], { camp: 'freedom', notes: 'Freedom, direkt am See' }),
    ],
  },
  {
    date: '2027-01-05',
    title: 'Aoraki/Mt. Cook: Hooker Valley → Lindis Pass',
    notes: 'Lake Pukaki → Parkplatz Aoraki Mt. Cook (1 h) → Wanderung (ca. 5 h) → Fahrt in Richtung Wanaka (2,5 h)',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [
      {
        name: 'Hooker Valley Track',
        kind: 'hike',
        at: [-43.7186, 170.0937],
        notes: 'Angepasst: 4 h 45 min, 11,2 km, 640 hm',
        duration: '4 h 45 min',
        links: [KOMOOT('3384559265', 'aV3OcFisiRPJatu4G9aHtHu55RYZq0woVYt7lgUIr1CGB9QMZX')],
      },
      camp('Lindis Pass Historic Hotel', [-44.587, 169.722], { camp: 'freedom', notes: 'First come first serve' }),
    ],
  },
  {
    date: '2027-01-06',
    title: 'Roys Peak → Arrowtown',
    notes: 'Lindis Pass Historic Hotel → Wanaka Wanderparkplatz (1 h) → Wanderung (5,5 h) → Fahrt nach Arrowtown (1 h).\nKostenlose Stornierung nur bis 15 Tage vorher möglich (Storno 25 €).',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      {
        name: 'Roys Peak Track',
        kind: 'hike',
        at: [-44.701, 169.058],
        notes: '15 km; 1.200 hm; 5,5 h',
        duration: '5,5 h',
        links: [KOMOOT('2702315189', 'ap1u6E5nMnrzXzWpiuZ6Y2NyIvGf47WsAlx24P65BstO0YocIN')],
      },
      camp('Hampshire Holiday Parks – Arrowtown', [-44.94, 168.835], { camp: 'holiday_park', booking: 'gebucht', notes: 'Gebucht: Jonas' }),
    ],
    expenses: [{ title: 'Holiday Park Arrowtown', amount: 38, paidBy: 'Jonas', note: '38 Euro / 2 Personen (19 € p. P.)' }],
  },
  {
    date: '2027-01-07',
    title: 'Lake Hayes → Te Anau',
    notes: 'Arrowtown → Lake Hayes (Spaziergang 2 h) → Fahrt nach Te Anau (2 h 15 min).\nKostenlose Stornierung bis 2 Tage vorher.',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      {
        name: 'Wanderung: Blick auf den Lake Hayes',
        kind: 'hike',
        at: [-44.98, 168.81],
        notes: '9 km, 80 hm, 2 h',
        duration: '2 h',
        links: [KOMOOT('3244452638', 'aD6tUy1fV9RAdd5VhdPg8hP8KVpkpbgIme2zL7BYjAVpUn2ulB')],
      },
      camp('Te Anau Lakeview Holiday Park', [-45.42, 167.71], { camp: 'holiday_park', notes: 'Sarah' }),
    ],
    expenses: [{ title: 'Te Anau Lakeview Holiday Park (2 Nächte)', amount: 157, currency: 'NZD', note: '157 Dollar / 2 Personen / 2 Nächte' }],
  },
  {
    date: '2027-01-08',
    title: 'Te Anau (Restday)',
    notes: 'Restday.\nKostenlose Stornierung bis 2 Tage vorher.',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [camp('Te Anau Lakeview Holiday Park', [-45.42, 167.71], { camp: 'holiday_park', notes: 'Sarah' })],
  },
  {
    date: '2027-01-09',
    title: 'Key Summit, Lake Marian → Cascade Creek',
    notes:
      'Te Anau → Key Summit Trail & Lake Marian (1 h) → Milford Sound (50 min).\nNaturschutzgebiet → Campingplatz buchen.\nMilford Sound sollte man vorab buchen (kein Netz in Milford Sound).',
    stops: [
      {
        name: 'Key Summit Track (Blick auf das Hollyford)',
        kind: 'hike',
        at: [-44.8263, 168.1176],
        notes: '7 km, 400 hm, 2,5 h',
        duration: '2,5 h',
        links: [KOMOOT('3244465058', 'aIlR0rRdniLZigshnXOzZi7cfVe3zvlHgndYjkk7NMdfvZZqgG')],
      },
      {
        name: 'Lake Marian',
        kind: 'hike',
        at: [-44.796, 168.135],
        notes: '6 km, 400 hm, 2 h 44 min',
        duration: '2 h 44 min',
        links: [KOMOOT('3255056099', 'a7wi5HjhGkv8b1kr0ua9QVPmEcCqumR7Vq3L2sK7hIGb9RQWkm')],
      },
      camp('Cascade Creek Campsite', [-44.89, 168.08], { camp: 'doc', booking: 'offen' }),
    ],
  },
  {
    date: '2027-01-10',
    title: 'Milford Sound reinfahren',
    notes: 'Hooker Trail → Wanderung noch raussuchen, könnte überlaufen sein.',
    stops: [
      { name: 'Milford Sound', kind: 'activity', at: [-44.6414, 167.8974], booking: 'offen' },
      {
        name: 'Wanderung: Giants Gate',
        kind: 'hike',
        at: [-44.766, 167.98],
        notes: '10,5 km; 110 hm; ca. 3 h',
        duration: '3 h',
        links: [KOMOOT('3384858641', 'ajet3ThOhOc2JNHUJVriu1rY50DLi13xJDVd8HDYcLzNyichP6')],
      },
      camp('Cascade Creek Campsite', [-44.89, 168.08], { camp: 'doc' }),
    ],
  },
  {
    date: '2027-01-11',
    title: 'Cascade Creek → Queenstown',
    notes: 'Reisetag (3 h) + Queenstown.\nKostenlose Stornierung nur bis 15 Tage vorher möglich (Storno 25 €).',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [camp('Hampshire Holiday Parks – Queenstown', [-45.031, 168.66], { camp: 'holiday_park' })],
    expenses: [{ title: 'Holiday Park Queenstown (2 Nächte)', amount: 130, currency: 'NZD', note: '130 Dollar / 2 Personen / 2 Nächte' }],
  },
  {
    date: '2027-01-12',
    title: 'Queenstown: Ben Lomond',
    notes: 'Kostenlose Stornierung nur bis 15 Tage vorher möglich (Storno 25 €).',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      {
        name: 'Ben-Lomond-Sattel',
        kind: 'hike',
        at: [-45.0275, 168.6537],
        notes: '16 km; 1.500 hm; 8,5 h',
        duration: '8,5 h',
        links: [KOMOOT('3384693423', 'am93FQUSRWktNEUaCbC7hiFRapF8iOLfJGby0QKhWhKr5lXYWN')],
      },
      camp('Hampshire Holiday Parks – Queenstown', [-45.031, 168.66], { camp: 'holiday_park' }),
    ],
  },
  {
    date: '2027-01-13',
    title: 'Queenstown → Warrington',
    notes: 'Fahrt 3,5 h. Strand.',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [camp('Warrington Reserve', [-45.716, 170.596], { camp: 'freedom', notes: 'Self contained' })],
  },
  {
    date: '2027-01-14',
    title: 'Warrington → Akaroa',
    notes: 'Reisetag (5 h)',
    shower: ['nein', ''],
    ...FREEDOM,
    stops: [camp('Okains Bay DOC Campground', [-43.702, 173.058], { camp: 'doc', notes: 'Oder Freedom Campingplatz' })],
  },
  {
    date: '2027-01-15',
    title: 'Akaroa Delfintour → Christchurch',
    notes:
      'Delfintour in Akaroa (bis ca. 13:00), restlicher Nachmittag in Akaroa → Fahrt zum Campingplatz in Christchurch (1,5 h).\nDelfintour (Akaroa Dolphins): Check-in 9:30.',
    shower: ['ja', 'Powered Campsite'],
    ...HOLIDAY_PARK,
    stops: [
      { name: 'Delfintour Akaroa Dolphins', kind: 'activity', at: [-43.806, 172.967], time: '09:30' },
      camp('South Brighton Holiday Park', [-43.5085, 172.731], { camp: 'holiday_park' }),
    ],
    expenses: [
      { title: 'Delfintour Akaroa', amount: 280, currency: 'NZD', note: '280 Dollar / 2 Personen' },
      { title: 'South Brighton Holiday Park', amount: 55, currency: 'NZD', note: '55 Dollar / 2 Personen' },
    ],
  },
  {
    date: '2027-01-16',
    title: 'Camper-Rückgabe Christchurch',
    times: 'Rückgabe Camper 16:00',
    notes:
      'Strandtag bis Mittag, Camper fertig machen; Gepäck an die Unterkunft bringen → dann ca. 30 min nach Christchurch zur Camperrückgabe.\n' +
      'Gepäck schon vorher an die Unterkunft bringen, bevor wir den Camper abgeben!\nUnterkunft: Check-in 14:00–23:30, Check-out bis 10:00. Gebucht über Booking (Theresa).',
    shower: ['ja', 'B&B'],
    stops: [
      {
        name: 'Bed & Breakfast in the Heart of Fendalton',
        kind: 'accommodation',
        at: [-43.52, 172.6],
        camp: 'hotel',
        booking: 'gebucht',
        notes: 'Gepäck hier abladen. Check-in 14:00–23:30, Check-out bis 10:00',
      },
      { name: 'Camper-Rückgabe Christchurch', kind: 'transport', scope: 'day', time: '16:00' },
    ],
    expenses: [{ title: 'Unterkunft Christchurch (B&B)', amount: 95, paidBy: 'Theresa', note: '47,50 € p. P.' }],
  },
  {
    date: '2027-01-17',
    title: 'Rückflug ab Christchurch → Singapur',
    times: 'Abflug CHC 17:20 · Ankunft SIN 22:55',
    notes: 'Transfer zum Hotel per Taxi (nachts keine Öffis mehr; max. 50 Dollar).',
    stops: [
      { name: 'Flughafen Christchurch (CHC)', kind: 'transport', at: [-43.4894, 172.5322], time: '17:20' },
      { name: 'Flughafen Singapur (SIN)', kind: 'transport', scope: 'day', at: [1.3644, 103.9915], time: '22:55' },
    ],
  },
  {
    date: '2027-01-18',
    title: 'Singapur',
    notes: 'Check-in 24/7',
    stops: [
      { name: 'Lichtershow Marina Bay Sands', kind: 'activity', at: [1.2834, 103.8607], time: '20:00', notes: '20:00 und 21:00 – Empfehlung Jakob & Berni' },
      { name: 'Hotel Mi Rochor', kind: 'accommodation', scope: 'day', at: [1.3025, 103.854], camp: 'hotel' },
    ],
    expenses: [{ title: 'Hotel Mi Rochor', amount: 321, note: '160,50 € p. P.' }],
  },
  {
    date: '2027-01-19',
    title: 'Singapur',
    stops: [{ name: 'Hotel Mi Rochor', kind: 'accommodation', scope: 'day', at: [1.3025, 103.854], camp: 'hotel' }],
  },
  {
    date: '2027-01-20',
    title: 'Rückflug Singapur → München',
    times: 'Abflug SIN 12:55 · Ankunft MUC 19:10',
    stops: [{ name: 'Flughafen Singapur (SIN)', kind: 'transport', scope: 'day', at: [1.3644, 103.9915], time: '12:55' }],
  },
];
