import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMapShare } from './maps-share';

test('resolves Google Maps links without following redirects to other hosts', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/Lake+Hayes/@-44.9,168.8,14z/data=!3d-44.95!4d168.81' } });
    const result = await resolveMapShare('https://maps.app.goo.gl/example');
    assert.equal(result.name, 'Lake Hayes');
    assert.equal(result.lat, -44.95);
    assert.equal(result.lng, 168.81);
    const direct = await resolveMapShare('https://maps.google.com/?q=-44.9,168.8');
    assert.equal(direct.lat, -44.9);
    assert.equal(direct.lng, 168.8);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } });
    await assert.rejects(resolveMapShare('https://maps.app.goo.gl/example'), /Weiterleitungsziel/);
    await assert.rejects(resolveMapShare('https://maps.google.com.evil.example/maps'), /Google-Maps/);
    await assert.rejects(resolveMapShare('https://user@maps.google.com/maps'), /Google-Maps/);
  } finally { globalThis.fetch = originalFetch; }
});