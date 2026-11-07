import assert from 'node:assert/strict';
import test from 'node:test';
import type { TripState } from '@neugier/shared';
import { applyOpsLocal, camperPosition, plannedCamperStop, tripDate } from '@neugier/shared';

test('location expires at midnight in the trip timezone and falls back to the current planned day', () => {
  const state: TripState = {
    trip: { id: 'trip', name: 'Test', region: 'Neuseeland', startDate: '2027-01-01', endDate: '2027-01-02', currency: 'EUR', members: [], notes: '' },
    liveLocation: { lat: -36, lng: 174, capturedAt: '2027-01-01T10:59:00Z' },
    days: [{ id: 'day', date: '2027-01-02', title: '', times: '', notes: '', shower: { status: 'unklar', note: '' } }],
    stops: [{ id: 'camp', dayId: 'day', order: 0, scope: 'main', kind: 'campsite', name: 'Camp', notes: '', time: '', duration: '', links: [], booking: '', lat: -40, lng: 175 }],
    expenses: [], memories: [], comments: [],
  };
  assert.equal(tripDate(state.trip, new Date('2027-01-01T10:59:00Z')), '2027-01-01');
  assert.equal(tripDate(state.trip, new Date('2027-01-01T11:00:00Z')), '2027-01-02');
  assert.equal(camperPosition(state, '2027-01-01')?.live, true);
  assert.deepEqual(camperPosition(state, '2027-01-02'), { lat: -40, lng: 175, title: 'Geplant: Camp', live: false });
  assert.equal(camperPosition(state, '2027-01-03'), null);
  assert.deepEqual(applyOpsLocal(state, []).liveLocation, state.liveLocation);
  state.stops[0].lat = undefined;
  state.stops[0].lng = undefined;
  assert.equal(camperPosition(state, '2027-01-02'), null);
  assert.equal(plannedCamperStop(state, '2027-01-02')?.name, 'Camp');
});