export interface SharedMapLocation {
  url: string;
  name?: string;
  lat?: number;
  lng?: number;
}

function allowed(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (hostname === 'maps.app.goo.gl') return true;
  if (hostname === 'goo.gl') return url.pathname.startsWith('/maps/');
  if (/^maps\.google\.(?:com|de|co\.nz)$/.test(hostname) && url.pathname === '/') return true;
  return /^(?:(?:www|maps)\.)?google\.(?:com|de|co\.nz)$/.test(hostname) && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
}

export async function resolveMapShare(input: string): Promise<SharedMapLocation> {
  if (input.length > 2048) throw Object.assign(new Error('Link ist zu lang'), { status: 400 });
  let url: URL;
  try { url = new URL(input); } catch { throw Object.assign(new Error('Ungültiger Kartenlink'), { status: 400 }); }
  if (!allowed(url)) throw Object.assign(new Error('Nur Google-Maps-Links werden aufgelöst'), { status: 400 });
  const original = url.toString();
  for (let count = 0; count < 4 && (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl'); count++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const target = response.headers.get('location');
    await response.body?.cancel();
    if (!target || response.status < 300 || response.status >= 400) break;
    const next = new URL(target, url);
    if (!allowed(next)) throw Object.assign(new Error('Ungültiges Weiterleitungsziel'), { status: 400 });
    url = next;
  }
  let text: string;
  try { text = decodeURIComponent(url.toString()); } catch { throw Object.assign(new Error('Ungültiger Kartenlink'), { status: 400 }); }
  const match = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text) ?? /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(text) ?? /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(url.searchParams.get('q') ?? '');
  const lat = match ? Number(match[1]) : undefined;
  const lng = match ? Number(match[2]) : undefined;
  const place = /\/maps\/place\/([^/]+)/.exec(url.pathname)?.[1];
  const name = place ? decodeURIComponent(place).replace(/\+/g, ' ') : undefined;
  return { url: original, name, ...(lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {}) };
}