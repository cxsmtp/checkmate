/**
 * Real photography of each city, so the page feels like home wherever the booth is — any city
 * in the world: the five drawn ones have their own landmark searches, every other city is
 * searched by its name the first time a visitor from there arrives.
 *
 * Photos live in <data>/cities/<city>/<n>.jpg with an index (photos.json) that keeps
 * each one's credit. They come from two places: an administrator uploads them
 * (Branding → City photography), or they are fetched from Wikimedia Commons — only
 * images under a Creative Commons / public-domain licence, landscape, at least
 * 1600 px wide — with author and licence recorded for the credit line.
 * Nothing is fetched when the network is closed; the drawn skyline stays as the fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CITY_THEMES } from './validation.js';

const SEARCHES = {
  dubai: ['Dubai skyline Burj Khalifa', 'Dubai Marina skyline night', 'Burj Al Arab', 'Dubai Frame'],
  'new-york': ['Manhattan skyline', 'Brooklyn Bridge Manhattan', 'Empire State Building skyline', 'Statue of Liberty skyline'],
  boston: ['Boston skyline', 'Boston Back Bay skyline', 'Zakim Bridge Boston', 'Boston Harbor skyline'],
  singapore: ['Singapore skyline Marina Bay', 'Marina Bay Sands night', 'Gardens by the Bay Supertree Grove', 'Singapore Merlion skyline'],
  melbourne: ['Melbourne skyline Yarra', 'Flinders Street Station Melbourne', 'Melbourne CBD skyline night', 'Princes Bridge Melbourne'],
};
const LICENCE_OK = /^(cc[ -]by([ -]sa)?([ -]\d\.\d)?|cc0|public domain|pd)/i;
const MAX_PER_CITY = 6;
const MAX_BYTES = 4 * 1024 * 1024;
const UA = `Checkmate/${config.version} (event booth experience; contact: ${config.smtp?.notify || 'admin'})`;

const dir = () => path.join(config.dataDir, 'cities');
const indexFile = () => path.join(dir(), 'photos.json');
const readIndex = () => { try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return {}; } };
function writeIndex(idx) {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${indexFile()}.tmp`, JSON.stringify(idx, null, 2), { mode: 0o600 });
  fs.renameSync(`${indexFile()}.tmp`, indexFile());
}
const cityOk = (key) => typeof key === 'string' && /^[a-z0-9][a-z0-9-]{1,60}$/.test(key);
const MAX_CITIES = 300;
const searchesFor = (city, name) => SEARCHES[city] ?? (name ? [`${name} skyline`, `${name} city centre`, `${name} landmark`, name] : []);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** What the page needs: per city, the photo addresses and credits (never file paths). */
const photosOf = (idx, c) => (idx[c] ?? []).map((p, i) => ({ src: `/city-photos/${c}/${i}?v=${p.addedAt ? Date.parse(p.addedAt) : 0}`, credit: p.credit ?? '', source: p.pageUrl ?? '' }));
export function publicList() {
  const idx = readIndex();
  const keys = [...new Set([...CITY_THEMES, ...Object.keys(idx)])];
  return Object.fromEntries(keys.map((c) => [c, photosOf(idx, c)]));
}
/** One city's photos (the page asks when a visitor's city is not one it already has). */
export const photosFor = (city) => (cityOk(city) ? photosOf(readIndex(), city) : []);
/** The city names behind the keys, for the admin list. */
export const names = () => Object.fromEntries(Object.entries(readIndex()).map(([k, v]) => [k, v?.[0]?.city ?? '']));
export const list = () => readIndex();

/** The file behind /city-photos/:city/:n, or null. */
export function file(city, n) {
  if (!cityOk(city)) return null;
  const p = readIndex()[city]?.[Number(n)];
  if (!p) return null;
  const abs = path.join(dir(), city, p.file);
  return fs.existsSync(abs) ? { path: abs, type: p.type } : null;
}

function add(city, { buffer, type, credit, pageUrl, source, name = '' }) {
  if (!cityOk(city)) throw Object.assign(new Error('Unknown city'), { status: 400 });
  if (!EXT[type]) throw Object.assign(new Error('Use a JPEG, PNG or WebP image.'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('Please use an image of up to 4 MB.'), { status: 400 });
  const idx = readIndex();
  if (!idx[city] && Object.keys(idx).length >= MAX_CITIES) throw Object.assign(new Error(`Photos are kept for up to ${MAX_CITIES} cities; remove some under Branding.`), { status: 400 });
  idx[city] ??= [];
  if (idx[city].length >= MAX_PER_CITY) throw Object.assign(new Error(`Up to ${MAX_PER_CITY} photos per city.`), { status: 400 });
  fs.mkdirSync(path.join(dir(), city), { recursive: true, mode: 0o700 });
  const cityName = name;
  const fileName = `${Date.now()}-${idx[city].length}.${EXT[type]}`;
  fs.writeFileSync(path.join(dir(), city, fileName), buffer, { mode: 0o600 });
  idx[city].push({ file: fileName, city: String(cityName ?? '').slice(0, 80), type, credit: String(credit ?? '').slice(0, 300), pageUrl: /^https:\/\/commons\.wikimedia\.org\//.test(pageUrl ?? '') ? pageUrl : '', source, addedAt: new Date().toISOString() });
  writeIndex(idx);
  return idx[city].length - 1;
}

/** An uploaded photo (data URL) for a city. */
export function upload(city, dataUrl, credit = '', name = '') {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw Object.assign(new Error('Upload a JPEG, PNG or WebP image.'), { status: 400 });
  return add(city, { buffer: Buffer.from(m[2], 'base64'), type: m[1], credit, source: 'upload', name });
}

export function remove(city, n) {
  if (!cityOk(city)) return false;
  const idx = readIndex();
  const p = idx[city]?.[Number(n)];
  if (!p) return false;
  try { fs.unlinkSync(path.join(dir(), city, p.file)); } catch {}
  idx[city].splice(Number(n), 1);
  writeIndex(idx);
  return true;
}

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------
const strip = (html) => String(html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

async function commons(query, signal) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '25', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1920', iiextmetadatafilter: 'LicenseShortName|Artist|LicenseUrl|ImageDescription' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}`);
  const body = await res.json();
  return Object.values(body?.query?.pages ?? {})
    .map((p) => ({ page: p, info: p.imageinfo?.[0] }))
    .filter(({ info }) => info && info.mime === 'image/jpeg' && info.width >= 1600 && info.width / info.height >= 1.3 && info.width / info.height <= 2.6)
    .map(({ page, info }) => ({
      title: page.title,
      licence: strip(info.extmetadata?.LicenseShortName?.value),
      artist: strip(info.extmetadata?.Artist?.value),
      url: info.thumburl || info.url,
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      size: info.size,
    }))
    .filter((c) => LICENCE_OK.test(c.licence));
}

/**
 * Fetches up to `count` licensed photos of a city from Wikimedia Commons, one per
 * landmark search, skipping ones already held. Returns {added, tried, errors}.
 */
export async function fetchFromCommons(city, { count = 3, timeoutMs = 25_000, log = console, name = '' } = {}) {
  if (!cityOk(city)) throw Object.assign(new Error('Unknown city'), { status: 400 });
  const cityName = name || readIndex()[city]?.[0]?.city || '';
  if (!searchesFor(city, cityName).length) throw Object.assign(new Error('Give the city\'s name to search for its photos.'), { status: 400 });
  const have = new Set((readIndex()[city] ?? []).map((p) => p.pageUrl).filter(Boolean));
  const result = { city, added: 0, tried: 0, errors: [] };
  for (const query of searchesFor(city, cityName)) {
    if (result.added >= count || (readIndex()[city]?.length ?? 0) >= MAX_PER_CITY) break;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      result.tried += 1;
      const candidates = (await commons(query, ac.signal)).filter((c) => !have.has(c.pageUrl));
      const pick = candidates[0];
      if (!pick) continue;
      const res = await fetch(pick.url, { headers: { 'User-Agent': UA }, signal: ac.signal });
      if (!res.ok) throw new Error(`download answered ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) continue;
      add(city, { buffer, type: 'image/jpeg', credit: `${pick.artist || 'Wikimedia Commons'} · ${pick.licence}`, pageUrl: pick.pageUrl, source: 'commons', name: cityName });
      have.add(pick.pageUrl);
      result.added += 1;
    } catch (e) {
      result.errors.push(`${query}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (result.added) log.log?.(`City photos: ${result.added} added for ${city} from Wikimedia Commons.`);
  else if (result.errors.length) log.warn?.(`City photos: none fetched for ${city} (${result.errors[0]}). The drawn skyline is used until photos are added under Branding.`);
  return result;
}

/** At start: cities without photos get them in the background, one city at a time. */
export function autoFetch(log = console) {
  const idx = readIndex();
  const missing = CITY_THEMES.filter((c) => !(idx[c]?.length));
  if (!missing.length) return;
  (async () => {
    for (const city of missing) await fetchFromCommons(city, { log }).catch((e) => log.warn?.(`City photos for ${city}: ${e.message}`));
  })();
}

/**
 * A visitor's city without photos yet: fetch them once (concurrent asks for the same city share
 * one fetch; a city that found none is not retried for an hour).
 */
const inflight = new Map();
const recentMiss = new Map();
export function ensure(city, name, log = console) {
  if (!cityOk(city)) return Promise.resolve([]);
  const have = photosFor(city);
  if (have.length) return Promise.resolve(have);
  if (!name && !SEARCHES[city]) return Promise.resolve([]);
  if (Date.now() - (recentMiss.get(city) ?? 0) < 3_600_000) return Promise.resolve([]);
  if (!inflight.has(city)) {
    inflight.set(city, fetchFromCommons(city, { name, count: 3, log })
      .then((r) => { if (!r.added) recentMiss.set(city, Date.now()); return photosFor(city); })
      .catch(() => { recentMiss.set(city, Date.now()); return []; })
      .finally(() => inflight.delete(city)));
  }
  return inflight.get(city);
}
