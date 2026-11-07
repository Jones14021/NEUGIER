import type { Availability, Day, Facilities } from '@neugier/shared';
import { FACILITY_LABEL, SHOWER_LABEL } from '@neugier/shared';

const ICON = { shower: '🚿', power: '⚡', water: '💧', dump: '🚽' } as const;
type Key = keyof typeof ICON;

export function facilitiesOf(day: Day): Facilities {
  return day.facilities ?? { power: 'unklar', water: 'unklar', dump: 'unklar' };
}

function statusOf(day: Day, k: Key): Availability {
  return k === 'shower' ? day.shower.status : facilitiesOf(day)[k];
}

function label(k: Key, s: Availability): string {
  return k === 'shower' ? SHOWER_LABEL[s] : FACILITY_LABEL[k][s];
}

/** Kompakte Icons für Karte/Tageskarte: nur vorhandene Ausstattung. */
export function facilityBadges(day: Day): string {
  return (Object.keys(ICON) as Key[])
    .filter((k) => statusOf(day, k) === 'ja')
    .map((k) => ICON[k])
    .join('');
}

export function FacilityIcons({ day }: { day: Day }) {
  return (
    <span className="fac-icons">
      {(Object.keys(ICON) as Key[]).map((k) => {
        const s = statusOf(day, k);
        return (
          <span key={k} className={`fac fac-${s}`} title={label(k, s)}>
            {ICON[k]}
          </span>
        );
      })}
    </span>
  );
}

const NEXT: Record<Availability, Availability> = { unklar: 'ja', ja: 'nein', nein: 'unklar' };

/** Toggles für Dusche, Strom, Frischwasser, Dump-Station (Tippen: ? → ja → nein). */
export function FacilityToggles({ day, disabled, onChange }: { day: Day; disabled?: boolean; onChange: (patch: Partial<Day>) => void }) {
  const set = (k: Key) => {
    const next = NEXT[statusOf(day, k)];
    if (k === 'shower') onChange({ shower: { ...day.shower, status: next } });
    else onChange({ facilities: { ...facilitiesOf(day), [k]: next } });
  };
  return (
    <div className="fac-toggles">
      {(Object.keys(ICON) as Key[]).map((k) => {
        const s = statusOf(day, k);
        return (
          <button key={k} type="button" disabled={disabled} className={`fac-toggle fac-${s}`} onClick={() => set(k)} title="Tippen zum Ändern">
            <span>{ICON[k]}</span>
            <span className="small">{label(k, s)}</span>
          </button>
        );
      })}
    </div>
  );
}
