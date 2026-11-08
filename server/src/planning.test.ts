import assert from 'node:assert/strict';
import test from 'node:test';
import type { Day, Stop } from '@neugier/shared';
import { dayRoute, daysUntilNextShower, isFlightStop, mapMarkerScale } from '@neugier/shared';

test('counts calendar days until the next planned shower', () => {
  const day = (date: string, status: Day['shower']['status']): Day => ({ id: date, date, title: '', times: '', notes: '', shower: { status, note: '' } });
  const days = [day('2027-01-03', 'ja'), day('2026-12-31', 'unklar'), day('2027-01-01', 'nein')];
  assert.equal(daysUntilNextShower(days, [], '2026-12-31'), 3);
  assert.equal(daysUntilNextShower(days, [], '2027-01-03'), 0);
  assert.equal(daysUntilNextShower(days, [], '2027-01-04'), null);
  const stop = { dayId: '2027-01-01', kind: 'shower' } as Stop;
  assert.equal(daysUntilNextShower(days, [stop], '2026-12-31'), 1);
});

test('a flight between days prevents reusing an old overnight stop', () => {
  const day = (date: string): Day => ({ id: date, date, title: '', times: '', notes: '', shower: { status: 'unklar', note: '' } });
  const days = [day('2027-01-16'), day('2027-01-17'), day('2027-01-18')];
  const camp = { id: 'camp', dayId: days[0].id, kind: 'campsite', scope: 'main', name: 'Christchurch', order: 0 } as Stop;
  const flight = { id: 'flight', dayId: days[1].id, kind: 'transport', name: 'Rückflug ab Christchurch', order: 0 } as Stop;
  assert.equal(isFlightStop(flight), true);
  assert.equal(dayRoute({ days, stops: [camp, flight] }, days[2]).start, undefined);
  assert.equal(dayRoute({ days, stops: [camp, flight] }, days[1]).start?.id, camp.id);
});

test('overview markers shrink when zoomed out and remain bounded', () => {
  assert.equal(mapMarkerScale(3), 0.45);
  assert.ok(mapMarkerScale(8) > mapMarkerScale(5));
  assert.equal(mapMarkerScale(18), 1);
});