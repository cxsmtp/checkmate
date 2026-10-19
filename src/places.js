/**
 * Where the visitor is, anywhere in the world: the browser's position turned into a city and its
 * country (OpenStreetMap Nominatim, reverse geocoding at city level), and a city typed by name
 * (Nominatim search). Coordinates are used for the lookup only and never stored; the answer is
 * cached in memory, rounded to about 10 km, so a booth asks once per place.
 */
import { config } from './config.js';

const UA = () => `Checkmate/${config.version} (event booth experience)`;
const cache = new Map();
const MAX_CACHE = 500;

/** A stable key for a city: "kuala-lumpur-my". The five drawn cities keep their own keys. */
export function placeKey(name, countryCode = '') {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const cc = String(countryCode ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return base ? (cc ? `${base}-${cc}` : base) : '';
}
export const isPlaceKey = (key) => typeof key === 'string' && /^[a-z0-9][a-z0-9-]{1,60}$/.test(key);

const FEATURED = {
  dubai: { name: 'Dubai', countryCode: 'ae' },
  'new-york': { name: 'New York', countryCode: 'us' },
  boston: { name: 'Boston', countryCode: 'us' },
  singapore: { name: 'Singapore', countryCode: 'sg' },
  melbourne: { name: 'Melbourne', countryCode: 'au' },
};
/** The drawn city a place is, if any ("Dubai", "ae" → "dubai"). */
export function featuredKey(name, countryCode) {
  const n = String(name ?? '').toLowerCase();
  return Object.entries(FEATURED).find(([, f]) => f.name.toLowerCase() === n && (!countryCode || f.countryCode === String(countryCode).toLowerCase()))?.[0] ?? null;
}

function place(name, country, countryCode) {
  const cc = String(countryCode ?? '').toUpperCase().slice(0, 2);
  return { key: featuredKey(name, cc) ?? placeKey(name, cc), name: String(name).slice(0, 80), country: String(country ?? '').slice(0, 80), countryCode: cc };
}

async function nominatim(path, params, timeoutMs = 8000) {
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  for (const [k, v] of Object.entries({ format: 'jsonv2', 'accept-language': 'en', ...params })) url.searchParams.set(k, String(v));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA(), Accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const remember = (key, value) => {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
};

/** The city at a position: { key, name, country, countryCode }, or null when nothing is there. */
export async function reverse(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) throw Object.assign(new Error('Not a position'), { status: 400 });
  const ck = `r:${la.toFixed(1)},${lo.toFixed(1)}`;
  if (cache.has(ck)) return cache.get(ck);
  const body = await nominatim('reverse', { lat: la, lon: lo, zoom: 10, addressdetails: 1 });
  const a = body?.address ?? {};
  const name = a.city || a.town || a.municipality || a.village || a.county || a.state || '';
  return remember(ck, name ? place(name, a.country, a.country_code) : null);
}

/** Cities matching what was typed, most relevant first. */
export async function search(q) {
  const query = String(q ?? '').trim().slice(0, 80);
  if (query.length < 2) return [];
  const ck = `s:${query.toLowerCase()}`;
  if (cache.has(ck)) return cache.get(ck);
  const rows = await nominatim('search', { q: query, limit: 8, addressdetails: 1, featureType: 'city' });
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const a = r.address ?? {};
    const name = a.city || a.town || a.municipality || a.village || r.name;
    if (!name) continue;
    const p = place(name, a.country, a.country_code);
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
  }
  return remember(ck, out.slice(0, 6));
}
