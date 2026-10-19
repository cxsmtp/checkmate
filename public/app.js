import { THEMES, applyTheme, cityFromTimeZone, paintSkylines, setPhotos, addPhotos, hasPhotosFor, paintPhotos } from './themes.js';
import { computeImpact, regionFor, formatMoney, formatCompact } from './impact.js';

const app = document.getElementById('app');

const LOOK_KEY = 'checkmate-look';
const readLook = () => { try { return localStorage.getItem(LOOK_KEY); } catch { return null; } };
const storeLook = (v) => { try { localStorage.setItem(LOOK_KEY, v); } catch {} };

// Build DOM safely: every string goes in via textContent, never innerHTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
};
async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || Object.values(data.errors ?? {})[0] || `Request failed (${res.status})`), { data, status: res.status });
  return data;
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SCANNERS = [['fusion', 'Fusion'], ['sast', 'SAST'], ['sca', 'SCA'], ['kics', 'IaC Security'], ['secrets', 'Secret Detection'], ['apisec', 'API Security'], ['containers', 'Containers']];
const scannerLabel = (e) => SCANNERS.find(([k]) => k === e)?.[1] ?? e.toUpperCase();
const ENGINE_WORDS = { sast: 'Reading source code for data flows', sca: 'Checking open-source packages', kics: 'Reviewing infrastructure as code', apisec: 'Mapping API endpoints', containers: 'Inspecting container images', microengines: 'Looking for secrets and repo health', ai: 'Fusion is reasoning about the application' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const initialsOf = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---------------------------------------------------------------------------
// Branding and site configuration
// ---------------------------------------------------------------------------
let site = { eventName: 'Checkmate', samples: [], branding: {}, profilesLookup: true, profilesMinChars: 2 };
document.body.prepend(h('div', { class: 'backdrop', 'data-photos': '', 'data-photo-offset': '1', 'aria-hidden': 'true' }));
const siteReady = api('/api/config').then((c) => { site = c; applyBranding(c); setPhotos(c.cityPhotos); }).catch(() => {});

function applyBranding(c) {
  const b = c.branding ?? {};
  const root = document.documentElement;
  root.dataset.theme = readLook() || b.theme || 'auto';
  root.dataset.accent = b.accent || 'ink';
  if (b.accentColor) root.style.setProperty('--brand-accent', b.accentColor), root.setAttribute('data-brand-accent', '');
  document.title = `${b.appName || 'Checkmate'} · ${b.event?.name || ''}`.replace(/ · $/, '');
  document.getElementById('brand-name').textContent = b.appName || 'Checkmate';
  document.getElementById('brand-co').textContent = b.companyName || '';
  // The brand: the uploaded icon (or the mark text) in the square, the logo (if any) in place of the name.
  const mark = document.getElementById('brand-mark');
  mark.replaceChildren(b.iconUrl ? h('img', { src: b.iconUrl, alt: '' }) : (b.markText || '✦'));
  mark.classList.toggle('has-img', Boolean(b.iconUrl));
  mark.classList.toggle('off', !c.connected);
  if (b.logoUrl) document.getElementById('brand-name').replaceChildren(h('img', { src: b.logoUrl, alt: b.appName || b.companyName || '', class: 'brand-logo', style: `max-height:${Math.min(40, b.logoHeight || 32)}px` }));
  document.getElementById('version').textContent = `v${c.version}`;
  document.getElementById('theme-btn').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(root.dataset.theme) + 1) % order.length];
    root.dataset.theme = next; storeLook(next);
    document.getElementById('theme-btn').title = `Look: ${next === 'auto' ? "the device's" : next}`;
  };
  document.getElementById('footer-left').textContent = b.footer || [b.event?.name, b.event?.venue, b.companyName].filter(Boolean).join(' · ');
  const tenant = document.getElementById('tenant-chip');
  tenant.hidden = false;
  tenant.classList.toggle('off', !c.connected);
  tenant.querySelector('span').textContent = c.mode === 'demo' ? 'Demo tenant' : c.connected ? `Checkmarx One · ${c.tenantRegion || 'connected'}` : 'Checkmarx One · not connected';
}

function setStep(step) {
  const order = ['who', 'repo', 'scan', 'outcome'];
  const at = order.indexOf(step === 'profile' ? 'repo' : step);
  document.querySelectorAll('#steps [data-step]').forEach((el) => {
    const i = order.indexOf(el.dataset.step);
    el.className = `tab ${i < at ? 'done' : i === at ? 'now' : ''}`;
  });
  const t = STEP_TITLES[step];
  if (t) setTitle(...t);
}
const STEP_TITLES = {
  who: ['Welcome', 'Two letters of your name or company — your invitation does the rest', 'Your visit'],
  repo: ['You and your team', 'Check the details, pick the repository', 'Your visit'],
  profile: ['How should we scan?', 'What your Checkmarx One tenant offers right now', 'Scan'],
  scan: ['Scanning', 'Checkmarx One is running; Fusion follows', 'Running'],
  outcome: ['Outcome', '', 'Outcome'],
};
function setTitle(title, sub = '', stage = '') {
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;
  const chip = document.getElementById('page-stage');
  chip.textContent = stage; chip.hidden = !stage;
}
/** The Team button in the title bar: the team panel in a dialog, so no page has to carry it. */
function setTeam(s, id, key) {
  const btn = document.getElementById('team-btn');
  if (!s?.customer?.email) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.replaceChildren(...[...btn.childNodes].filter((n) => n.nodeName.toLowerCase() === 'svg'), h('span', {}, 'Team'), h('span', { class: 'count' }, (s.team?.length ?? 0) + 1));
  btn.onclick = () => openDialog('Your team', teamPanel(s, id, key));
}
function openDialog(title, body) {
  document.querySelector('.dialog-back')?.remove();
  const close = () => back.remove();
  const back = h('div', { class: 'dialog-back', onclick: (e) => e.target === back && close() },
    h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { type: 'button', 'aria-label': 'Close', onclick: close }, '×')), body));
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.append(back);
}

// ---------------------------------------------------------------------------
// Where the visitor is: any city in the world. Found from the device's position (asked once),
// else its time zone, or typed; only the city (key, name, country) is kept — never coordinates.
// ---------------------------------------------------------------------------
const PLACE_STORE = 'checkmate-place';
const readPlace = () => { try { const v = JSON.parse(localStorage.getItem(PLACE_STORE) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const storePlace = (v) => { try { localStorage.setItem(PLACE_STORE, JSON.stringify(v)); } catch {} };
let place = null; // { key, name, country, countryCode }
let city = null; // place.key: the theme and photo key

const slugOf = (name, cc = '') => {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const c = String(cc ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return base ? (c ? `${base}-${c}` : base) : '';
};
const localeCountry = () => (navigator.language || '').split(/[-_]/)[1]?.toUpperCase() || '';
const featured = (key) => (THEMES[key] ? { key, name: THEMES[key].name, country: THEMES[key].country, countryCode: THEMES[key].countryCode } : null);
function placeFromName(name) {
  const hit = Object.keys(THEMES).find((k) => THEMES[k].name.toLowerCase() === String(name).trim().toLowerCase() || k === name);
  if (hit) return featured(hit);
  const cc = localeCountry();
  return name ? { key: slugOf(name, cc), name: String(name).trim(), country: '', countryCode: cc } : null;
}
function placeFromTimeZone() {
  const known = cityFromTimeZone();
  if (known) return featured(known);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const [area, ...rest] = zone.split('/');
  if (!rest.length || ['Etc', 'UTC'].includes(area)) return null;
  // Older zone names some browsers still report.
  const OLD = { Calcutta: 'Kolkata', Bombay: 'Mumbai', Saigon: 'Ho Chi Minh City', Rangoon: 'Yangon', Katmandu: 'Kathmandu', Kiev: 'Kyiv', Ulan_Bator: 'Ulaanbaatar' };
  const last = rest.at(-1);
  return placeFromName((OLD[last] ?? last).replace(/_/g, ' '));
}
const greetingOf = (p) => (p ? THEMES[p.key]?.greeting ?? `Welcome to ${p.name}` : 'Welcome');
const landmarksOf = (p) => (p ? THEMES[p.key]?.landmarks ?? p.country ?? '' : '');

const askedPhotos = new Set();
function setPlace(p, { remember = true } = {}) {
  place = p?.key ? p : null;
  city = place?.key ?? null;
  if (remember) storePlace(place ?? { none: true });
  applyTheme(city);
  const chip = document.getElementById('city-chip');
  chip.hidden = false;
  chip.querySelector('span').textContent = place ? place.name : 'Choose your city';
  chip.onclick = () => askForCity();
  document.querySelectorAll('[data-city-name]').forEach((el) => { el.textContent = place ? place.name : 'Your city'; });
  document.querySelectorAll('[data-city-greeting]').forEach((el) => { el.textContent = greetingOf(place); });
  document.querySelectorAll('[data-city-landmarks]').forEach((el) => { el.textContent = landmarksOf(place); });
  paintSkylines(); paintPhotos();
  // Photos of any city: fetched the first time someone from there arrives.
  if (place && !hasPhotosFor(place.key) && !askedPhotos.has(place.key)) {
    askedPhotos.add(place.key);
    api(`/api/places/${encodeURIComponent(place.key)}/photos?name=${encodeURIComponent(place.name)}`).then((list) => list?.length && addPhotos(place.key, list)).catch(() => {});
  }
}
function initialPlace() {
  const stored = readPlace();
  if (stored) return { place: stored.none ? null : stored, asked: true };
  if (site.defaultCity && site.defaultCity !== 'auto') return { place: placeFromName(site.defaultCity), asked: true };
  return { place: placeFromTimeZone(), asked: false };
}
/** The city at the device's position (the browser asks once); the outcome's amounts follow it. */
function locate(onDone = () => {}) {
  if (!window.isSecureContext || !navigator.geolocation) { onDone(null, 'Location needs a secure (https) connection here. Please type your city.'); return; }
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const p = await api(`/api/places/reverse?lat=${coords.latitude.toFixed(3)}&lon=${coords.longitude.toFixed(3)}`);
      if (p?.key) { setPlace(p); redrawOutcome(); }
      onDone(p);
    } catch (e) { onDone(null, 'We could not name your city right now. Please type it.'); }
  }, (err) => onDone(null, err.code === 1 ? 'No problem — type your city instead.' : 'We could not find your location. Please type your city.'), { timeout: 10000, maximumAge: 3_600_000 });
}
const redrawOutcome = () => { if (current?.stage === 'complete' && location.pathname.startsWith('/s/')) route(); };

function askForCity() {
  document.querySelector('.city-modal')?.remove();
  const status = h('p', { class: 'city-status', role: 'status' });
  const close = () => { modal.remove(); document.getElementById('city-chip')?.focus(); };
  const choose = (p) => { setPlace(p); close(); redrawOutcome(); };
  const results = h('div', { class: 'city-options' });
  const showFeatured = () => results.replaceChildren(...Object.keys(THEMES).map((k) => h('button', { type: 'button', class: `city-option ${k === city ? 'suggested' : ''}`, onclick: () => choose(featured(k)) }, THEMES[k].name, h('small', {}, THEMES[k].country))));
  showFeatured();
  const search = h('input', { type: 'search', placeholder: 'Type any city — Riyadh, Mumbai, London, São Paulo…', 'aria-label': 'Your city', autocomplete: 'off' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { showFeatured(); return; }
    timer = setTimeout(async () => {
      const found = await api(`/api/places/search?q=${encodeURIComponent(q)}`).catch(() => null);
      const list = found?.length ? found : [placeFromName(q)];
      results.replaceChildren(...list.map((p) => h('button', { type: 'button', class: 'city-option', onclick: () => choose(p) }, p.name, h('small', {}, p.country || 'Use this name'))));
    }, 250);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) { e.preventDefault(); results.querySelector('button')?.click(); } });
  const locateBtn = h('button', { class: 'primary', type: 'button', onclick: () => {
    locateBtn.disabled = true; status.textContent = 'Finding you…';
    locate((p, why) => { locateBtn.disabled = false; if (p) { status.textContent = `${greetingOf(p)}! Theming everything for ${p.name}.`; setTimeout(close, 800); } else status.textContent = why || 'Please type your city.'; });
  } }, '📍 Use my location');
  const modal = h('div', { class: 'city-modal', role: 'dialog', 'aria-modal': 'true', onclick: (e) => e.target === modal && close() },
    h('div', { class: 'city-dialog' },
      h('h2', {}, 'Where in the world are you?'),
      h('p', {}, 'Any city: the page takes its photography, its local time and its currency for the business case.'),
      h('div', { class: 'row' }, locateBtn, h('button', { class: 'link', type: 'button', onclick: () => choose(null) }, 'No city')),
      search, status, results,
      h('p', { class: 'privacy' }, 'Your position is used once to name the city and is never stored. Only the city is kept, so your team sees the same.')));
  modal.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(modal);
  search.focus();
}

// ---------------------------------------------------------------------------
// 1. Welcome: who are you?
// ---------------------------------------------------------------------------
const draft = { profileId: null, name: '', email: '', company: '', title: '', technicalName: '', technicalEmail: '', team: [], githubUrl: '', branch: '', sampleId: null, repos: [] };

function cityClock() {
  const el = h('span', { class: 'clock' });
  const tick = () => { try { el.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { el.textContent = ''; } };
  tick();
  const t = setInterval(() => (el.isConnected ? tick() : clearInterval(t)), 30_000);
  return el;
}

function postcard() {
  return h('div', { class: 'postcard' },
    h('div', { class: 'sky', 'data-skyline': '', 'aria-hidden': 'true' }),
    h('div', { class: 'photos', 'data-photos': '', 'aria-hidden': 'true' }),
    h('div', { class: 'over' },
      h('div', {}, h('small', { 'data-city-greeting': '' }, greetingOf(place)), h('h3', { 'data-city-name': '' }, place ? place.name : 'Your city'), h('small', { 'data-city-landmarks': '' }, landmarksOf(place))),
      cityClock()),
    h('button', { type: 'button', class: 'change', onclick: () => askForCity() }, place ? 'Change city' : 'Choose your city'));
}

const JOURNEY = [
  ['Find', 'What others miss', 'Fusion reasons across code, services and cloud — and finds the risks rules cannot describe.'],
  ['Prove', 'Only what is exploitable', 'AI Triage confirms what an attacker can actually reach. The noise drops away.'],
  ['Fix', 'Before it ships', 'AI Remediation writes the fix. Your developers review and merge it.'],
  ['Measure', 'In your currency', 'Hours and money saved, worked out for your region.'],
];
function journeyPanel() {
  return h('div', { class: 'panel journey' },
    h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, 'One platform, from finding to fixed'), h('span', { class: `tag ${site.connected ? 'ok' : ''}` }, site.mode === 'live' ? 'Checkmarx One' : 'Checkmarx One · demo')),
    h('ol', {}, JOURNEY.map(([k, t, d], i) => h('li', {}, h('span', { class: 'n' }, i + 1), h('div', {}, h('b', {}, k, h('span', {}, ` · ${t}`)), h('small', {}, d))))));
}

async function renderWelcome() {
  await siteReady;
  setStep('who');
  setTeam(null);
  const start = initialPlace();
  setPlace(start.place, { remember: false });
  // First visit on this device: ask the browser for the position (no dialog of ours).
  if (!start.asked && site.askLocation !== false) locate((p) => { if (!p && start.place) storePlace(start.place); });

  const input = h('input', { type: 'search', placeholder: site.profilesLookup ? 'Type your name or company…' : 'Type your name…', autocomplete: 'off', 'aria-label': 'Your name or company', 'aria-expanded': 'false' });
  const list = h('div', { class: 'who-list', role: 'listbox', hidden: true });
  let items = [];
  let active = -1;
  let timer;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const pickProfile = async (p) => {
    try {
      const full = await api(`/api/profiles/${p.id}/pick`);
      Object.assign(draft, { profileId: full.id, name: full.name, email: full.email, company: full.company, title: full.title, technicalName: full.technical?.name ?? '', technicalEmail: full.technical?.email ?? '', team: full.team ?? [], repos: full.repos ?? [], githubUrl: full.repos?.[0] ?? '' });
      if (full.city && !readPlace()) setPlace(featured(full.city) ?? placeFromName(full.city));
    } catch { Object.assign(draft, { profileId: null, name: p.name, company: p.company, title: p.title }); }
    renderDetails();
  };
  const fresh = () => { Object.assign(draft, { profileId: null, name: input.value.trim(), team: [], repos: [] }); renderDetails(); };
  const render = () => {
    list.replaceChildren(
      ...items.map((p, i) => h('button', { type: 'button', class: 'who-item', role: 'option', 'aria-selected': String(i === active), onmousedown: (e) => e.preventDefault(), onclick: () => pickProfile(p) },
        h('span', { class: 'avatar' }, p.initials), h('span', {}, h('strong', {}, p.name), h('small', {}, [p.title, p.company].filter(Boolean).join(' · '))), p.known ? h('span', { class: 'tag ok' }, 'Welcome back') : h('span', { class: 'tag' }, 'Invited'))),
      h('button', { type: 'button', class: 'who-item', role: 'option', onmousedown: (e) => e.preventDefault(), onclick: fresh }, h('span', { class: 'avatar', style: 'background:var(--surface-3);color:var(--muted)' }, '+'), h('span', {}, h('strong', {}, input.value.trim() ? `Continue as “${input.value.trim()}”` : 'I\'m not on the list'), h('small', {}, 'Takes 30 seconds'))));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    active = -1;
    if (q.length < (site.profilesMinChars || 2) || !site.profilesLookup) { items = []; q ? render() : close(); return; }
    timer = setTimeout(async () => { items = await api(`/api/profiles/search?q=${encodeURIComponent(q)}`).catch(() => []); render(); }, 160);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) { if (e.key === 'Enter') { e.preventDefault(); fresh(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(-1, active - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && active < items.length) pickProfile(items[active]); else fresh(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  const b = site.branding;
  const pickSample = (s) => { Object.assign(draft, { sampleId: s.id, githubUrl: '' }); renderDetails(); };
  app.replaceChildren(
    h('section', { class: 'welcome' },
      h('div', { class: 'welcome-copy' },
        h('span', { class: 'eyebrow' }, [b.event?.name, b.event?.venue].filter(Boolean).join(' · ') || 'Checkmate'),
        h('h1', {}, b.event?.tagline || 'Find the risks that matter. Fix them before they ship.'),
        h('p', { class: 'lede' }, b.callToAction || 'Checkmarx One finds what other tools miss, proves what is exploitable and fixes it with AI — one platform, from code to cloud.'),
        h('div', { class: 'who' },
          svg('svg', { class: 'glyph', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }, svg('circle', { cx: 11, cy: 11, r: 7 }), svg('path', { d: 'M20 20l-3.5-3.5' })),
          input, list),
        h('div', { class: 'who-new' }, h('span', {}, 'Invited? Two letters are enough.'), h('button', { type: 'button', class: 'link', onclick: fresh }, 'I\'m new here →')),
        site.samples?.length ? h('div', { class: 'try' }, h('span', {}, 'No repository with you? See it on one of ours:'), site.samples.slice(0, 4).map((s) => h('button', { type: 'button', class: 'chip-btn', title: s.description, onclick: () => pickSample(s) }, s.hasResults ? '⚡ ' : '', s.name))) : null,
        h('div', { class: 'trust' },
          h('div', {}, h('b', {}, 'Minutes'), h('span', {}, 'from repository to fixes')),
          h('div', {}, h('b', {}, 'Exploitable'), h('span', {}, 'only what an attacker can reach')),
          h('div', {}, h('b', {}, 'Fixed'), h('span', {}, 'patches your developers can merge')))),
      h('div', { class: 'deck' }, postcard(), journeyPanel())));
  paintSkylines(); paintPhotos();
  setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------------------------------
// 2. One screen: you, your team, the repository, and go
// ---------------------------------------------------------------------------
let scanOptions = null;
const scanOptionsReady = () => (scanOptions ? Promise.resolve(scanOptions) : api('/api/scan-options').then((o) => (scanOptions = o)).catch(() => (scanOptions = { models: [], engines: [], fusion: { available: true, default: true } })));

async function renderDetails() {
  setStep('repo');
  const opts = await scanOptionsReady();
  const errBox = h('p', { class: 'error', role: 'alert' });
  const field = (label, name, attrs = {}) => h('label', { class: 'field' }, h('span', {}, label, attrs.optional ? h('span', { class: 'opt' }, ' (optional)') : null), h('input', { name, value: draft[name] ?? '', ...attrs, optional: null }));
  const sameAsMe = h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'same', checked: !draft.technicalEmail || draft.technicalEmail === draft.email }), 'That\'s me');

  // You: a card when the invitation already knows you, the four fields otherwise (or on Edit).
  const known = Boolean(draft.profileId && draft.name && draft.email);
  const youFields = h('div', { class: 'grid two compact', hidden: known }, field('Full name', 'name', { autocomplete: 'name', required: true }), field('Work email', 'email', { type: 'email', autocomplete: 'email', required: true }), field('Company', 'company', { autocomplete: 'organization', optional: true }), field('Title', 'title', { optional: true, placeholder: 'CISO, VP Engineering…' }));
  const youCard = known ? h('div', { class: 'you-card' }, h('span', { class: 'avatar' }, initialsOf(draft.name)), h('div', {}, h('b', {}, draft.name), h('small', {}, [draft.title, draft.company].filter(Boolean).join(' · ')), h('small', { class: 'mono' }, draft.email)), h('button', { type: 'button', class: 'link', onclick: (e) => { youFields.hidden = false; e.currentTarget.remove(); } }, 'Edit')) : null;
  const techFields = h('div', { class: 'grid two compact' }, field('Technical owner', 'technicalName', { placeholder: 'Name' }), field('Their email', 'technicalEmail', { type: 'email', placeholder: 'name@company.com' }));

  const team = [...draft.team.map((t) => ({ ...t }))];
  const teamBox = h('div', { class: 'people' });
  const renderTeam = () => teamBox.replaceChildren(...team.map((t, i) =>
    h('span', { class: 'person' }, h('span', { class: 'avatar' }, initialsOf(t.name || t.email)), h('span', {}, t.name || t.email), h('button', { type: 'button', 'aria-label': `Remove ${t.name || t.email}`, title: t.email, onclick: () => { team.splice(i, 1); renderTeam(); } }, '×'))),
    ...(team.length < 2 ? [h('span', { class: 'muted', style: 'font-size:12.5px;align-self:center' }, `Add ${2 - team.length} more colleague${team.length === 1 ? '' : 's'} who should see the outcome.`)] : []));
  renderTeam();
  const addName = h('input', { placeholder: 'Colleague', 'aria-label': 'Colleague name' });
  const addEmail = h('input', { placeholder: 'name@company.com', type: 'email', 'aria-label': 'Colleague email' });
  const addPerson = () => {
    const email = addEmail.value.trim().toLowerCase();
    if (!email) return;
    if (!team.some((t) => t.email === email)) team.push({ name: addName.value.trim(), email, role: 'Operations' });
    addName.value = ''; addEmail.value = ''; renderTeam(); addName.focus();
  };
  addEmail.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addPerson()));

  // The repository: theirs, one they scanned before, or one of ours (ready at once).
  const repoInput = h('input', { name: 'githubUrl', type: 'url', placeholder: 'https://github.com/org/repo', value: draft.githubUrl });
  const consentBox = h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent' }), 'I\'m authorised to have this repository scanned.');
  const choices = h('div', { class: 'repo-cards' });
  const renderChoices = () => {
    choices.replaceChildren(
      ...draft.repos.map((r) => h('button', { type: 'button', class: 'repo-card', 'aria-pressed': String(!draft.sampleId && repoInput.value === r), onclick: () => { draft.sampleId = null; repoInput.value = r; renderChoices(); } }, h('b', {}, r.replace('https://github.com/', '')), h('small', {}, 'Yours · scanned with you before'))),
      ...site.samples.map((s) => h('button', { type: 'button', class: 'repo-card', 'aria-pressed': String(draft.sampleId === s.id), onclick: () => { draft.sampleId = draft.sampleId === s.id ? null : s.id; if (draft.sampleId) repoInput.value = ''; renderChoices(); } }, h('b', {}, s.name), h('small', {}, s.hasResults ? '⚡ Results ready now' : s.language || 'Sample'))));
    consentBox.hidden = Boolean(draft.sampleId);
  };
  renderChoices();
  repoInput.addEventListener('input', () => { if (repoInput.value) draft.sampleId = null; renderChoices(); });

  // How it scans: Fusion with the deterministic engines, on the model the tenant offers.
  const models = opts.models ?? [];
  let llmModel = models.find((m) => m.default)?.key ?? models[0]?.key ?? '';
  const modelSel = models.length > 1 ? h('select', { 'aria-label': 'Fusion model', onchange: (e) => { llmModel = e.target.value; } }, models.map((m) => h('option', { value: m.key, selected: m.key === llmModel }, m.label))) : null;
  const engines = (opts.engines ?? []).map((e) => e.label);

  setTeam(null);
  const form = h('form', { class: 'details one', novalidate: true });
  form.append(
    h('div', { class: 'panel' },
      h('h3', {}, known ? `Welcome back, ${draft.name.split(' ')[0]}` : 'You and your team'),
      h('p', { class: 'hint' }, known ? 'Your invitation filled this in. Check it and go.' : 'Who you are, and who should see the outcome.'),
      youCard, youFields,
      h('div', { class: 'spread sub' }, h('h4', {}, 'Who can fix it'), sameAsMe), techFields,
      h('h4', { class: 'sub' }, 'Who should see it'), teamBox,
      h('div', { class: 'add-person' }, addName, addEmail, h('button', { type: 'button', onclick: addPerson }, 'Add')),
      h('p', { class: 'error', 'data-error': 'contacts' })),
    h('div', { class: 'panel' },
      h('h3', {}, 'The application'), h('p', { class: 'hint' }, 'A GitHub repository — or one of ours, with results ready now.'),
      h('div', { class: 'grid repo-row' }, h('label', { class: 'field' }, h('span', {}, 'GitHub repository'), repoInput), field('Branch', 'branch', { optional: true, placeholder: 'main' })),
      choices, consentBox, h('p', { class: 'error', 'data-error': 'consent' })),
    h('div', { class: 'panel go' },
      h('span', { class: 'eyebrow' }, 'Checkmarx One'),
      h('h3', {}, 'Find it, prove it, fix it'),
      h('div', { class: 'scan-facts' }, h('span', { class: 'tag fusion' }, '✦ Fusion'), engines.map((e) => h('span', { class: 'tag' }, e))),
      h('p', { class: 'hint' }, 'Fusion reasons about the whole application; the engines cover the known patterns. AI then triages and fixes what is real.'),
      modelSel ? h('label', { class: 'field' }, h('span', {}, 'Fusion model ', h('small', {}, opts.source === 'tenant' ? 'from your tenant' : '')), modelSel) : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'inviteNow', checked: true }), 'Email my team the outcome link.'),
      h('div', { class: 'stack', style: 'margin-top:auto;gap:8px' },
        h('button', { type: 'submit', class: 'golden big' }, 'Find and fix →'),
        h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Usually a few minutes. You can invite more people while it runs.'),
        h('button', { type: 'button', class: 'ghost sm', onclick: () => renderWelcome() }, '← Back'),
        errBox)));

  const syncSame = () => { techFields.hidden = sameAsMe.firstChild.checked; };
  sameAsMe.firstChild.addEventListener('change', syncSame);
  syncSame();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });
    errBox.textContent = '';
    const fd = new FormData(form);
    const same = sameAsMe.firstChild.checked;
    const body = {
      profileId: draft.profileId ?? undefined,
      name: fd.get('name'), email: fd.get('email'), company: fd.get('company'), title: fd.get('title'),
      technicalName: same ? fd.get('name') : fd.get('technicalName'), technicalEmail: same ? fd.get('email') : fd.get('technicalEmail'),
      contacts: team, sampleId: draft.sampleId ?? undefined, githubUrl: fd.get('githubUrl'), branch: fd.get('branch'),
      consent: form.consent.checked, inviteNow: form.inviteNow.checked, theme: city ?? undefined, place: place ?? undefined,
      scan: { fusion: opts.fusion?.available !== false, llmModel: llmModel || undefined },
    };
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/sessions', body);
      history.pushState({}, '', data.url);
      route();
    } catch (err) {
      btn.disabled = false;
      if (err.data?.errors) {
        let first = null;
        for (const [name, msg] of Object.entries(err.data.errors)) {
          const slot = form.querySelector(`[data-error="${name}"]`);
          if (slot) { slot.textContent = msg; continue; }
          const input = form.elements[name];
          if (!input) continue;
          if (input.closest('[hidden]')) input.closest('[hidden]').hidden = false;
          input.classList.add('invalid'); input.after(h('span', { class: 'field-error' }, msg)); first ??= input;
        }
        if (first) first.focus();
        errBox.textContent = 'Please check the highlighted fields.';
      } else errBox.textContent = err.message;
    }
  });

  app.replaceChildren(form);
  paintSkylines(); paintPhotos();
  app.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Session: profile → running → outcome
// ---------------------------------------------------------------------------
let pollTimer = null;
let current = null;
const ui = { scanner: 'all', severities: new Set(), fusionOnly: false, search: '', selected: null, tab: null, assistScope: 'fusion', assistMsg: '', otab: 'overview', impactScope: 'fusion', repos: 1 };

async function renderSession(id, key, { reload = true } = {}) {
  clearTimeout(pollTimer);
  await siteReady;
  if (reload || !current) {
    try { current = await api(`/api/sessions/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`); }
    catch (err) { app.replaceChildren(h('div', { class: 'panel', style: 'max-width:640px;margin:40px auto' }, h('h2', {}, 'Scan not found'), h('p', {}, err.message), h('a', { href: '/' }, 'Start again'))); return; }
  }
  const s = current;
  if (document.documentElement.dataset.cityFor !== s.id) { setPlace(s.place?.key ? s.place : s.theme ? featured(s.theme) ?? { key: s.theme, name: '', country: '', countryCode: '' } : initialPlace().place, { remember: false }); document.documentElement.dataset.cityFor = s.id; }
  const rerender = () => renderSession(id, key, { reload: false });
  setTeam(s, id, key);
  const typed = [...document.querySelectorAll('#invite-form input')].map((i) => i.value);
  const activeName = document.activeElement?.name;

  if (s.stage === 'error') { setStep('scan'); app.replaceChildren(h('div', { class: 'panel error-panel', style: 'max-width:720px;margin:30px auto' }, h('h2', {}, 'The scan could not complete'), h('p', {}, s.error), h('p', { class: 'muted' }, 'The booth team has the details and will follow up with you.'), teamPanel(s, id, key))); }
  else if (s.stage === 'options') { setStep('profile'); app.replaceChildren(h('div', { class: 'panel', style: 'max-width:720px;margin:30px auto;text-align:center' }, h('h2', {}, 'Reading your Checkmarx One tenant…'), h('p', { class: 'muted' }, 'Which engines it licenses, whether Fusion is on, and which models it offers.'))); pollTimer = setTimeout(() => renderSession(id, key), 1500); }
  else if (s.stage === 'profile') { setStep('profile'); app.replaceChildren(renderProfile(s, id, key)); }
  else if (s.stage !== 'complete') { setStep('scan'); app.replaceChildren(theatre(s, id, key)); pollTimer = setTimeout(() => renderSession(id, key), 3000); }
  else { setStep('outcome'); app.replaceChildren(outcomeView(s, id, key, rerender)); if (s.assist?.triage?.status === 'running' || s.assist?.remediation?.status === 'running') pollTimer = setTimeout(() => renderSession(id, key), 2000); }

  document.querySelectorAll('#invite-form input').forEach((i, n) => { i.value = typed[n] ?? ''; });
  if (activeName) document.querySelector(`#invite-form [name="${activeName}"]`)?.focus();
  paintSkylines(); paintPhotos();
}

// --- 3. Scan profile ---------------------------------------------------------
function renderProfile(s, id, key) {
  const o = s.options;
  const state = { engines: new Set(o.engines.filter((e) => e.default).map((e) => e.key)), fusion: o.fusion.default, llmModel: o.models.find((m) => m.default)?.key ?? o.models[0]?.key ?? '', presetName: o.presets.find((p) => p.default)?.key ?? '' };
  const preview = h('pre', { class: 'config-preview' });
  const renderPreview = () => {
    const cfg = [...state.engines].map((t) => ({ type: t, value: t === 'sast' ? { incremental: 'false', ...(state.presetName ? { presetName: state.presetName } : {}), ...(o.extendedAnalysis ? { extendedAnalysis: 'true' } : {}) } : {} }));
    if (state.fusion) cfg.push({ type: 'ai', value: { fusionEnabled: 'true', ...(state.llmModel ? { llmModel: state.llmModel } : {}) } });
    preview.replaceChildren(h('span', { class: 'k' }, 'POST /api/scans'), '\n', JSON.stringify({ type: 'git', handler: { repoUrl: s.repo.url, branch: s.branch || 'default' }, config: cfg }, null, 2));
  };
  renderPreview();
  const engineBox = h('div', { class: 'engine-grid' }, o.engines.map((e) => h('label', { class: 'engine' }, h('input', { type: 'checkbox', checked: state.engines.has(e.key), onchange: (ev) => { ev.target.checked ? state.engines.add(e.key) : state.engines.delete(e.key); renderPreview(); } }), h('span', {}, e.label, h('small', {}, ENGINE_WORDS[e.key] || '')))));
  const fusionSwitch = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: state.fusion, disabled: !o.fusion.available, onchange: (ev) => { state.fusion = ev.target.checked; modelSeg.hidden = !state.fusion; renderPreview(); } }), h('span', { class: 'track' }), h('b', {}, state.fusion ? 'On' : 'Off'));
  fusionSwitch.querySelector('input').addEventListener('change', (ev) => { fusionSwitch.querySelector('b').textContent = ev.target.checked ? 'On' : 'Off'; });
  const modelSeg = h('div', { class: 'seg', hidden: !state.fusion, role: 'radiogroup', 'aria-label': 'Model' }, o.models.length ? o.models.map((m) => h('label', {}, h('input', { type: 'radio', name: 'model', value: m.key, checked: m.key === state.llmModel, onchange: () => { state.llmModel = m.key; renderPreview(); } }), h('span', {}, m.label), h('span', { class: 'k' }, m.key))) : h('p', { class: 'hint' }, 'The tenant uses its default model.'));
  const presetSel = o.presets.length ? h('select', { onchange: (ev) => { state.presetName = ev.target.value; renderPreview(); } }, h('option', { value: '' }, 'Project default'), o.presets.map((p) => h('option', { value: p.key, selected: p.key === state.presetName }, p.label))) : null;
  const msg = h('p', { class: 'error' });
  const run = h('button', { type: 'button', class: 'golden big', onclick: async () => {
    run.disabled = true; msg.textContent = '';
    try { await api(`/api/sessions/${id}/start`, { k: key, engines: [...state.engines], fusion: state.fusion, llmModel: state.llmModel, presetName: state.presetName }); renderSession(id, key); }
    catch (e) { run.disabled = false; msg.textContent = e.message; }
  } }, 'Run the scan with Fusion →');

  setTitle(`How should we scan ${s.repo.owner}/${s.repo.repo}?`, o.source === 'tenant' ? `Fetched from your Checkmarx One tenant · ${o.region}` : o.source === 'demo' ? 'Demo tenant: the options a tenant typically offers' : 'Tenant defaults', 'Scan');
  return h('div', { class: 'profile-grid' },
    h('div', { class: 'panel' },
      h('h4', {}, 'Engines'), h('p', { class: 'hint' }, 'What your tenant licenses. The defaults are what we recommend for a first look.'),
      o.warning ? h('p', { class: 'error' }, `Could not read the tenant: ${o.warning}. Showing defaults.`) : null,
      engineBox,
      presetSel ? h('label', { class: 'field', style: 'margin-top:14px' }, h('span', {}, 'SAST preset'), presetSel) : null,
      h('div', { class: 'repo-line' }, h('h4', {}, 'Repository'), h('p', { class: 'mono' }, s.repo.url), h('p', { class: 'muted' }, `Branch ${s.branch || 'default'} · for ${s.customer.company || s.customer.name}`))),
    h('div', { class: 'panel fusion-card' },
      h('div', { class: 'spread' }, h('span', { class: 'tag fusion' }, '✦ Fusion'), fusionSwitch),
      h('h3', {}, 'Reason about the whole application'),
      h('p', { class: 'hint' }, 'Fusion reads how code, services and cloud resources connect, finds what rules cannot describe, and rescores every finding by its real exploitable path.'),
      h('h4', { style: 'margin-top:6px' }, 'Model'), modelSeg),
    h('div', { class: 'panel go' },
      h('h4', {}, 'What will be sent'), preview,
      h('div', { class: 'stack', style: 'margin-top:auto;gap:8px' }, run, h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Usually 3–10 minutes. Invite your team (title bar) while it runs.'), msg)));
}

// --- 4. The theatre ------------------------------------------------------------
function theatre(s, id, key) {
  const started = new Date(s.createdAt).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const engines = s.cx?.engines?.length ? s.cx.engines : (s.profile?.engines ?? []).map((name) => ({ name, status: 'Queued' })).concat(s.profile?.fusion ? [{ name: 'ai', status: 'Queued' }] : []);
  const stageWords = { queued: 'Queued on Checkmarx One', 'creating-project': 'Creating the project and application', 'starting-scan': 'Starting the scan', scanning: 'Engines are running', correlating: 'Fusion is correlating across the application', 'fetching-results': 'Collecting results', explaining: 'Writing the outcome' };
  const fs = s.fusionStage;
  const pct = s.stage === 'correlating' ? (fs?.stage ?? 5) : ['fetching-results', 'explaining'].includes(s.stage) ? 100 : 0;
  setTitle(`Scanning ${s.repo.owner}/${s.repo.repo}`, stageWords[s.stage] ?? s.stage, 'Running');
  const r = 50, c = 2 * Math.PI * r;
  const ring = svg('svg', { class: 'ring', viewBox: '0 0 120 120' },
    svg('circle', { class: 'track', cx: 60, cy: 60, r }),
    svg('circle', { class: 'bar', cx: 60, cy: 60, r, 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - pct / 100), transform: 'rotate(-90 60 60)' }),
    svg('text', { x: 60, y: 68, 'text-anchor': 'middle' }, `${pct}%`));
  return h('div', { class: 'theatre' },
    h('div', { class: 'stack' },
      h('div', { class: 'panel' },
        h('div', { class: 'spread' }, h('div', {}, h('span', { class: 'eyebrow' }, stageWords[s.stage] ?? s.stage), h('h2', {}, `Scanning ${s.repo.owner}/${s.repo.repo}`)), h('span', { class: 'elapsed' }, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} elapsed`)),
        h('div', { class: 'engines-live' }, engines.map((e) => h('div', { class: `eng-row ${String(e.status).toLowerCase()}` }, h('span', { class: 'dot' }), h('span', {}, h('b', {}, e.name === 'ai' ? 'Fusion' : scannerLabel(e.name === 'microengines' ? 'secrets' : e.name)), h('span', { class: 'muted' }, ` — ${ENGINE_WORDS[e.name] || ''}`)), h('span', { class: 'st' }, e.status))))),
      s.profile?.fusion ? h('div', { class: 'panel fusion-card' },
        h('div', { class: 'fusion-live' }, ring, h('div', {}, h('span', { class: 'tag fusion' }, '✦ Fusion correlation'), h('h3', {}, fs?.description || (s.stage === 'correlating' ? 'Starting…' : 'Waits for the engines to finish')), h('p', { class: 'narrative' }, 'Fusion maps the application\'s microservices and cloud resources, then follows each finding to see whether an attacker can really reach it. Scores go ', h('b', {}, 'up'), ' for exploitable paths and ', h('b', {}, 'down'), ' for dead ends — so the list you get is the one worth your time.')))) : null,
      h('div', { class: 'panel tight' }, h('h4', {}, 'This scan'), h('div', { class: 'scan-facts' }, (s.profile?.engines ?? []).map((e) => h('span', { class: 'tag' }, scannerLabel(e === 'microengines' ? 'secrets' : e))), s.profile?.fusion ? h('span', { class: 'tag fusion' }, `✦ Fusion · ${s.profile.llmModel || 'default model'}`) : null, s.profile?.presetName ? h('span', { class: 'tag' }, s.profile.presetName) : null))),
    h('div', { class: 'summary-side' }, postcard(), h('div', { class: 'panel tight' }, h('h4', {}, 'While you wait'), h('p', { class: 'hint', style: 'margin:0' }, 'Invite the people who should see the outcome: Team, in the title bar. They get a private link to this page.'))));
}

// --- 5. The outcome ------------------------------------------------------------
function dial(score, band) {
  const r = 86, c = 2 * Math.PI * r, span = c * 0.75;
  const cls = `band-${String(band).toLowerCase()}`;
  return svg('svg', { class: `dial ${cls}`, viewBox: '0 0 220 220', role: 'img', 'aria-label': `Exposure ${score} of 100, ${band}` },
    svg('circle', { class: 'track', cx: 110, cy: 110, r, 'stroke-dasharray': `${span} ${c}`, transform: 'rotate(135 110 110)' }),
    svg('circle', { class: 'arc', cx: 110, cy: 110, r, stroke: 'currentColor', 'stroke-dasharray': `${(span * score) / 100} ${c}`, transform: 'rotate(135 110 110)' }),
    svg('text', { class: 'n', x: 110, y: 122, 'text-anchor': 'middle' }, score),
    svg('text', { class: 'l', x: 110, y: 150, 'text-anchor': 'middle' }, `${band} exposure`));
}

function outcomeView(s, id, key, rerender) {
  const o = s.outcome ?? {};
  const c = o.counts ?? { bySeverity: {} };
  const all = [...s.fusionOnly, ...s.others];
  const corr = all.filter((f) => f.correlation).sort((a, b) => Math.abs(b.correlation.newRisk - b.correlation.oldRisk) - Math.abs(a.correlation.newRisk - a.correlation.oldRisk));
  const map = s.fusionMap;
  const go = (t) => { ui.otab = t; rerender(); app.scrollTo({ top: 0 }); };
  setTitle(`${s.repo.owner}/${s.repo.repo}`, `${fmtDate(s.completedAt)}${s.reusedFrom ? ' · the most recent scan of this sample repository' : ''}`, 'Outcome');
  const a = s.assist ?? {};
  const busy = a.triage?.status === 'running' || a.remediation?.status === 'running';
  const fixes = Object.values(a.remediation?.items ?? {}).filter((i) => i.status === 'done').length;
  const tabs = [
    ['overview', 'Overview'],
    s.assistEnabled !== false ? ['loop', busy ? '✦ Fix with AI · running' : fixes ? `✦ Fix with AI · ${fixes} fixed` : '✦ Fix with AI'] : null,
    site.impact ? ['impact', 'Business impact'] : null,
    corr.length || map ? ['fusion', 'What Fusion saw'] : null,
    ['results', 'All results', all.length],
  ].filter(Boolean);
  const tab = tabs.some(([k]) => k === ui.otab) ? ui.otab : 'overview';
  const nav = h('nav', { class: 'ptabs', 'aria-label': 'Outcome' }, tabs.map(([k, l, n]) =>
    h('button', { type: 'button', class: `ptab ${k === tab ? 'active' : ''} ${k === 'loop' ? 'gold' : ''}`, onclick: () => go(k) }, l, n != null ? h('span', { class: 'count' }, n) : null)));

  let body;
  // What fixing the Fusion gaps is worth, in the visitor's currency (the Business impact tab has the detail).
  const im = site.impact && s.fusionOnly.length ? impactFor(s, 'fusion', 1) : null;
  if (tab === 'overview') body = h('div', { class: 'overview' },
    h('section', { class: 'panel outcome-hero' },
      dial(o.exposure?.score ?? 0, o.exposure?.band ?? 'Low'),
      h('div', {},
        h('h1', {}, o.headline),
        h('p', { class: 'verdict' }, o.verdict),
        h('div', { class: 'scan-facts' }, (o.scanned?.engines ?? []).map((e) => h('span', { class: 'tag' }, scannerLabel(e === 'microengines' ? 'secrets' : e))), o.scanned?.fusion ? h('span', { class: 'tag fusion' }, `✦ Fusion · ${o.scanned.llmModel || 'default model'}`) : null, o.correlation?.status === 'completed' ? h('span', { class: 'tag accent' }, `${o.correlation.changed} risk scores re-scored`) : o.correlation?.status === 'unavailable' ? h('span', { class: 'tag warn' }, 'Correlation unavailable') : null),
        h('div', { class: 'row', style: 'margin-top:14px' },
          s.assistEnabled !== false ? h('button', { type: 'button', class: 'golden', onclick: () => fixAll(s, id, key, 'fusion', go) }, (s.assist?.remediation?.summary?.fixed ? '✦ See the fixes →' : `✦ Fix ${c.fusionOnly ? `the ${c.fusionOnly}` : 'them'} with AI →`)) : null,
          h('button', { type: 'button', onclick: () => { ui.fusionOnly = true; ui.scanner = 'all'; go('results'); } }, `See the ${c.fusionOnly ?? 0} Fusion-only findings`)))),
    storyStrip(s, im, go),
    h('div', { class: 'grid two' },
      h('div', { class: 'panel' }, h('h4', {}, 'Where rule-based scanning was blind'), o.blindSpots?.length ? h('div', { class: 'blind' }, o.blindSpots.slice(0, 4).map((t) => h('div', { class: 'blind-row' }, h('span', {}, h('b', {}, t.label), h('span', { class: 'muted' }, ` · worst ${titleCase(t.worst)}`)), h('span', { class: 'tag accent' }, `${t.fusionOnly} Fusion-only`), h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((t.fusionOnly / Math.max(1, c.fusionOnly)) * 100)}%` }))))) : h('p', { class: 'muted' }, 'Nothing Fusion-only on this scan: the rules covered it.')),
      h('div', { class: 'panel' }, h('h4', {}, 'First moves'), h('ol', { class: 'moves' }, (o.firstMoves ?? []).slice(0, 5).map((m) => h('li', {}, m))))));
  else if (tab === 'loop') body = loopPanel(s, id, key, rerender);
  else if (tab === 'impact') body = impactPanel(s, rerender, go);
  else if (tab === 'fusion') body = h('div', { class: 'grid two' },
    h('div', { class: 'panel scroll-panel' }, h('h4', {}, 'What Fusion re-scored, and why'), corr.length ? h('div', { class: 'corr' }, corr.map((f) => h('button', { type: 'button', class: 'corr-row', style: 'text-align:left;min-height:0;cursor:pointer', onclick: () => { ui.selected = f.id; ui.tab = 'fusion'; ui.fusionOnly = false; ui.severities = new Set(); go('results'); } }, h('span', { class: `delta ${f.correlation.direction}` }, `${f.correlation.oldRisk.toFixed(1)} → ${f.correlation.newRisk.toFixed(1)}`), h('span', {}, h('b', {}, f.explanation?.plainTitle || f.title), h('small', {}, f.correlation.reason))))) : h('p', { class: 'muted' }, o.correlation?.error || 'No risk-score changes for this scan.')),
    map ? h('div', { class: 'panel scroll-panel' }, h('h4', {}, 'The application Fusion mapped'), h('p', { class: 'hint' }, `${map.summary?.microservices?.count ?? map.microservices?.length ?? 0} services · ${map.summary?.cloudResources?.count ?? map.resources?.length ?? 0} cloud resources · ${map.summary?.cloudResources?.access?.Public ?? 0} public`), h('div', { class: 'map' }, (map.resources ?? []).map((r) => h('div', { class: `res ${String(r.access).toLowerCase()}` }, h('b', {}, r.name), h('small', {}, r.type), h('span', { class: `tag ${String(r.access).toLowerCase() === 'public' ? 'bad' : ''}` }, r.access || 'Private')))), (map.microservices ?? []).length ? h('div', { class: 'scan-facts', style: 'margin-top:12px' }, map.microservices.map((m) => h('span', { class: 'tag' }, m.name))) : null) : null);
  else body = resultsView(s, id, key, rerender);
  return h('div', { class: `outcome tab-${tab}` }, nav, body);
}


/** One click: AI Triage, then AI Remediation on what is real (simulated unless switched on in admin). */
async function fixAll(s, id, key, scope, go) {
  ui.assistScope = scope;
  if (s.assist?.remediation?.status === 'done' || s.assist?.triage?.status === 'running' || s.assist?.remediation?.status === 'running') { go('loop'); return; }
  try {
    current = await api(`/api/sessions/${id}/assist/fix`, { k: key, scope });
    ui.otab = 'loop';
    renderSession(id, key, { reload: false });
    pollTimer = setTimeout(() => renderSession(id, key), 1500);
  } catch (e) { ui.assistMsg = e.message; go('loop'); }
}

/** The story at a glance: found → proven → fixed → saved. */
function storyStrip(s, im, go) {
  const a = s.assist ?? {};
  const tri = a.triage ?? {};
  const rem = a.remediation ?? {};
  const fixed = Object.values(rem.items ?? {}).filter((i) => i.status === 'done').length;
  const real = tri.summary ? tri.summary.vulnerable + (tri.summary.uncertain ?? 0) : null;
  const stage = (k, big, small, state, onclick) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : undefined, class: `story-stage ${state}`, onclick }, h('span', { class: 'loop-k' }, k), h('b', {}, big), h('small', {}, small));
  return h('div', { class: 'story' },
    stage('Found only by Fusion', String(s.summary?.fusionOnly ?? 0), `risks your rules could not see · ${s.summary?.total ?? 0} findings in all`, 'done', () => { ui.fusionOnly = true; ui.scanner = 'all'; go('results'); }),
    h('span', { class: 'loop-arrow' }, '→'),
    stage('Proven exploitable', real === null ? (tri.status === 'running' ? '…' : '—') : String(real), real === null ? (tri.status === 'running' ? 'AI Triage is reasoning…' : 'AI Triage, one click') : `${tri.summary.notExploitable} set aside as not exploitable`, tri.status === 'running' ? 'running' : real !== null ? 'done' : '', () => go('loop')),
    h('span', { class: 'loop-arrow' }, '→'),
    stage('Fixed by AI', rem.status === 'idle' || !rem.status ? '—' : String(fixed), rem.status === 'running' ? 'AI Remediation is writing fixes…' : fixed ? 'patches ready for your developers' : 'AI Remediation, same click', rem.status === 'running' ? 'running' : fixed ? 'done' : '', () => go('loop')),
    h('span', { class: 'loop-arrow' }, '→'),
    im ? stage('Saved', formatCompact(im.money.net, im.currency, im.locale), `${im.hours.total} engineering hours back`, 'money', () => go('impact')) : stage('Saved', '—', 'Business impact', '', null));
}

// --- Business impact: what finding and fixing these gaps is worth -------------------
// The arithmetic is CxMissionZero's (Impact page, Cx Credits Calculator): public/impact.js.
function impactFor(s, scope, repos) {
  const findings = scope === 'fusion' ? s.fusionOnly : allFindings(s);
  const region = regionFor(place ?? city, navigator.language, site.impact ?? {});
  return computeImpact({ findings, verdicts: s.assist?.triage?.items ?? {}, loc: s.loc, repos, settings: site.impact ?? {}, region });
}

function impactPanel(s, rerender, go) {
  const im = impactFor(s, ui.impactScope, ui.repos);
  const m = (n) => formatMoney(n, im.currency, im.locale);
  const big = (n) => formatCompact(n, im.currency, im.locale);
  const st = im.settings;
  const verdictNote = im.triaged ? `AI Triage verdicts on ${im.triaged}${im.findings > im.triaged ? `, ${st.fpPercent}% assumed false positives on the other ${im.findings - im.triaged}` : ''}` : `${st.fpPercent}% assumed false positives until AI Triage runs`;
  const segment = (name, value, options, onPick) => h('div', { class: 'seg scope', role: 'radiogroup', 'aria-label': name }, options.map(([k, l, n]) =>
    h('label', { class: value === k ? 'on' : '' }, h('input', { type: 'radio', name, value: k, checked: value === k, onchange: () => { onPick(k); rerender(); } }), h('span', {}, l), n != null ? h('span', { class: 'k' }, n) : null)));
  const card = (label, value, note, cls = '') => h('div', { class: `impact-card ${cls}` }, h('span', { class: 'loop-k' }, label), h('b', {}, value), h('small', {}, note));
  const regionName = place?.name || (city ? THEMES[city]?.name : '') || '';
  const scale = im.repos > 1 ? ` across ${im.repos} repositories like this one` : '';
  const what = ui.impactScope === 'fusion' ? `the ${s.fusionOnly.length} gap${s.fusionOnly.length === 1 ? '' : 's'} only Fusion found` : `all ${allFindings(s).length} findings`;

  return h('section', { class: 'panel impact' },
    h('div', { class: 'spread', style: 'align-items:flex-start' },
      h('div', {}, h('span', { class: 'eyebrow' }, 'Business impact'), h('h2', {}, `Finding and fixing ${what} now`), h('p', { class: 'hint', style: 'max-width:72ch;margin:4px 0 0' }, 'What it is worth to triage and fix these before release with Checkmarx One AI, instead of by hand — and before they reach production, where the same fix costs several times more.')),
      h('span', { class: 'tag' }, `${im.currency}${regionName ? ` · ${regionName} rates` : ''}`)),
    h('div', { class: 'impact-controls' },
      segment('impact-scope', ui.impactScope, [['fusion', '✦ Fusion gaps', s.fusionOnly.length], ['all', 'Everything found', allFindings(s).length]], (k) => { ui.impactScope = k; }),
      segment('impact-repos', ui.repos, [[1, 'This repository'], [10, '× 10'], [50, '× 50'], [250, '× 250']], (k) => { ui.repos = Number(k); })),
    h('div', { class: 'impact-hero' },
      h('div', { class: 'impact-total' },
        h('span', { class: 'loop-k' }, im.money.cost === null ? 'Saved' : 'Saved, after credits'),
        h('b', {}, big(im.money.net)),
        h('small', {}, `${im.hours.total.toLocaleString()} engineering hours (${im.hours.days.toLocaleString()} days) back${scale}`)),
      h('div', { class: 'impact-cards' },
        card('Engineering time', m(im.money.timeValue), `${im.hours.triage.toLocaleString()} h triage + ${im.hours.fix.toLocaleString()} h fixing at ${m(im.rate)} an hour`),
        card('Avoided after release', m(im.money.avoided), `the same ${im.truePositives.toLocaleString()} fixes at ${st.releaseMultiplier}× once in production`),
        card('Real risks closed', im.truePositives.toLocaleString(), verdictNote, 'risk'),
        card('Checkmarx One credits', im.credits.total.toLocaleString(), im.money.cost === null ? `${im.credits.triage} triage · ${im.credits.remediation} remediation${im.credits.fusion ? ` · ${im.credits.fusion} Fusion` : ''}` : `${m(im.money.cost)}${im.roi ? ` · ${im.roi}× return` : ''}`))),
    h('details', { class: 'impact-how' },
      h('summary', {}, 'How it is worked out'),
      h('ul', {},
        h('li', {}, `Triage by hand: ${st.triageMinutes} min a finding; a fix by hand: ${st.fixMinutes} min (the CxMissionZero Impact defaults).`),
        h('li', {}, `Engineering hour: ${m(im.rate)}, fully loaded${im.rateFrom === 'region' ? ` — the ${im.currency} regional rate` : ' — set by your team'}.`),
        h('li', {}, `Real findings: ${verdictNote}; false positives cost their triage only.`),
        h('li', {}, `After release a fix costs ${st.releaseMultiplier}× (find, hotfix, retest, redeploy); the saving counts the extra ${st.releaseMultiplier - 1}×.`),
        h('li', {}, `Credits (Cx Credits Calculator): 1 per finding triaged, 3 per finding remediated${im.loc ? `, Fusion ${st.fusionCreditsPer10k || '—'} per 10K lines × ${Math.ceil(im.loc / 10000)} units (${im.loc.toLocaleString()} lines scanned)` : ''}${im.money.cost === null ? '; not priced' : `, ${m(st.creditPrice)} each`}.`))),
    h('div', { class: 'row', style: 'margin-top:12px' },
      s.assistEnabled !== false ? h('button', { type: 'button', class: 'golden', onclick: () => { ui.assistScope = ui.impactScope === 'fusion' ? 'fusion' : 'all'; go('loop'); } }, '✦ Make it real: triage and fix with AI →') : null));
}

// --- Closing the loop: AI Triage → AI Remediation → developers ---------------------
const VERDICT = {
  VULNERABLE: ['Vulnerable', 'bad'], CONFIRMED: ['Confirmed', 'bad'], URGENT: ['Urgent', 'bad'], UNCERTAIN: ['Uncertain', 'warn'],
  PROPOSED_NOT_EXPLOITABLE: ['Probably not exploitable', 'ok'], NOT_EXPLOITABLE: ['Not exploitable', 'ok'], RISK_ACCEPTED: ['Risk accepted', ''], FAILED: ['Triage failed', 'bad'],
};
const verdictTag = (v, extra = '') => { const [label, cls] = VERDICT[v?.verdict] ?? [v?.verdict || '—', '']; return h('span', { class: `tag ${cls} ${extra}` }, label, v?.confidence ? h('small', { style: 'opacity:.75;font-weight:500' }, ` ${Math.round(Number(v.confidence) * 100)}%`) : null); };
const SCOPE_LABEL = { fusion: '✦ Fusion-only', 'critical-high': 'Critical & high', all: 'Everything' };

function loopPanel(s, id, key, rerender) {
  const a = s.assist ?? {};
  const tri = a.triage ?? { status: 'idle' };
  const rem = a.remediation ?? { status: 'idle' };
  const counts = s.assistScopes ?? {};
  const findings = allFindings(s);
  const triItems = Object.values(tri.items ?? {});
  const remItems = Object.values(rem.items ?? {});
  const triDone = triItems.filter((i) => i.status === 'done' || i.status === 'failed').length;
  const remDone = remItems.filter((i) => i.status === 'done' || i.status === 'failed').length;
  const fixes = remItems.filter((i) => i.status === 'done');
  const busy = tri.status === 'running' || rem.status === 'running';
  const n = counts[ui.assistScope] ?? 0;
  const msg = h('p', { class: 'error', style: 'margin:0' }, ui.assistMsg);
  const call = async (what, btn) => {
    btn.disabled = true; ui.assistMsg = '';
    try { current = await api(`/api/sessions/${id}/assist/${what}`, { k: key, scope: ui.assistScope }); renderSession(id, key, { reload: false }); if (current.assist) pollTimer = setTimeout(() => renderSession(id, key), 1500); }
    catch (e) { ui.assistMsg = e.message; btn.disabled = false; msg.textContent = e.message; }
  };
  const sendBtn = h('button', { type: 'button', class: 'primary', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Sending…';
    try { const r = await api(`/api/sessions/${id}/assist/send`, { k: key }); const ok = r.results.filter((x) => x.ok).map((x) => x.to); b.textContent = ok.length ? `Sent to ${ok.join(', ')}` : 'Could not send'; if (!ok.length) b.disabled = false; }
    catch (err) { b.textContent = 'Send fixes to developers'; b.disabled = false; msg.textContent = err.message; }
  } }, a.sent?.length ? `Send again (last sent ${fmtDate(a.sent.at(-1).at)})` : `Send ${fixes.length} fix${fixes.length === 1 ? '' : 'es'} to ${s.technical?.name || 'the developers'}`);

  // Live ticker: what AI is doing right now
  const latest = (items, kind) => Object.entries(items).filter(([, i]) => i.status !== 'queued').slice(-4).reverse().map(([fid, i]) => {
    const f = findings.find((x) => x.id === fid);
    return h('li', { class: i.status }, h('i'), h('span', {}, f?.explanation?.plainTitle || f?.title || fid), i.status === 'running' ? h('em', {}, kind === 'triage' ? 'reasoning about reachability…' : 'writing the fix…') : kind === 'triage' ? verdictTag(i) : i.status === 'done' ? h('span', { class: 'tag ok' }, `Fix ready · ${i.files} file${i.files === 1 ? '' : 's'}`) : h('span', { class: 'tag bad' }, i.error || 'Failed'));
  });
  const stage = (label, big, small, state) => h('div', { class: `loop-stage ${state}` }, h('span', { class: 'loop-k' }, label), h('b', {}, big), h('small', {}, small));
  const triSummary = tri.summary ? `${tri.summary.vulnerable} vulnerable · ${tri.summary.notExploitable} not exploitable${tri.summary.uncertain ? ` · ${tri.summary.uncertain} uncertain` : ''}` : tri.status === 'running' ? `${triDone} of ${tri.requested} verdicts in` : 'one click';
  const remSummary = rem.summary ? `${rem.summary.fixed} fix${rem.summary.fixed === 1 ? '' : 'es'} · ${rem.summary.files} file${rem.summary.files === 1 ? '' : 's'} changed` : rem.status === 'running' ? `${remDone} of ${rem.requested} fixes written` : 'one click';

  return h('section', { class: 'panel loop' },
    h('div', { class: 'spread', style: 'align-items:flex-start' },
      h('div', {}, h('span', { class: 'eyebrow' }, 'Close the loop'), h('h2', {}, 'Found. Triaged. Fixed.'), h('p', { class: 'hint', style: 'max-width:70ch' }, 'Finding new classes of issues is half the story. Checkmarx One AI triages every finding for real exploitability and writes the fix — the same tenant, one click each, no tickets in between.')),
      h('span', { class: `tag ${s.assistSimulated ? '' : 'fusion'}` }, s.assistSimulated ? 'Checkmarx One AI · simulation' : 'Checkmarx One AI')),
    h('div', { class: 'loop-strip' },
      stage('Found', `${c0(s)}`, `${s.summary?.fusionOnly ?? 0} only by Fusion · ${s.summary?.total ?? 0} in all`, 'done'),
      h('span', { class: 'loop-arrow' }, '→'),
      stage('Triaged by AI', tri.status === 'idle' ? '—' : `${triDone}`, triSummary, tri.status === 'running' ? 'running' : tri.status === 'done' ? 'done' : ''),
      h('span', { class: 'loop-arrow' }, '→'),
      stage('Fixed by AI', rem.status === 'idle' ? '—' : `${fixes.length}`, remSummary, rem.status === 'running' ? 'running' : rem.status === 'done' ? 'done' : ''),
      h('span', { class: 'loop-arrow' }, '→'),
      stage('With developers', a.sent?.length ? `${a.sent.at(-1).count}` : '—', a.sent?.length ? `sent to ${a.sent.at(-1).to.length} inbox${a.sent.at(-1).to.length === 1 ? '' : 'es'}` : fixes.length ? 'ready to send' : 'after the fixes', a.sent?.length ? 'done' : '')),
    h('div', { class: 'loop-controls' },
      h('div', { class: 'seg scope', role: 'radiogroup', 'aria-label': 'Scope' }, Object.entries(SCOPE_LABEL).map(([k, l]) => h('label', { class: ui.assistScope === k ? 'on' : '' }, h('input', { type: 'radio', name: 'assist-scope', value: k, checked: ui.assistScope === k, disabled: busy, onchange: () => { ui.assistScope = k; rerender(); } }), h('span', {}, l), h('span', { class: 'k' }, counts[k] ?? 0)))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'golden big', disabled: busy || !n, onclick: (e) => call('fix', e.currentTarget) }, tri.status === 'running' ? `Triaging ${triDone}/${tri.requested}…` : rem.status === 'running' ? `Fixing ${remDone}/${rem.requested}…` : `✦ Triage & fix ${n} with AI`),
        h('button', { type: 'button', class: 'ghost sm', disabled: busy || !n, onclick: (e) => call('triage', e.currentTarget) }, 'Triage only'),
        h('button', { type: 'button', class: 'ghost sm', disabled: busy || !n, onclick: (e) => call('remediate', e.currentTarget) }, 'Fix only'),
        fixes.length && !busy ? sendBtn : null),
      msg),
    busy || triItems.length || remItems.length ? h('div', { class: 'grid two loop-live' },
      triItems.length ? h('div', {}, h('h4', {}, tri.status === 'running' ? 'AI Triage — live' : 'AI Triage'), h('div', { class: 'progress' }, h('i', { style: `width:${Math.round((triDone / Math.max(1, tri.requested)) * 100)}%` })), h('ul', { class: 'ticker' }, latest(tri.items, 'triage')), tri.error ? h('p', { class: 'error' }, tri.error) : null) : null,
      remItems.length ? h('div', {}, h('h4', {}, rem.status === 'running' ? 'AI Remediation — live' : 'AI Remediation'), h('div', { class: 'progress' }, h('i', { style: `width:${Math.round((remDone / Math.max(1, rem.requested)) * 100)}%` })), h('ul', { class: 'ticker' }, latest(rem.items, 'remediation')), rem.error ? h('p', { class: 'error' }, rem.error) : null) : null) : null,
    fixes.length ? h('p', { class: 'hint', style: 'margin:12px 0 0' }, 'Each fix is in the result drawer under ⚡ AI fix, as a patch that applies with git apply. Sending emails them all to the technical owner as one developer brief.') : null,
    fixes.length && site.impact ? (() => { const im = impactFor(s, ui.assistScope === 'fusion' ? 'fusion' : 'all', 1); return h('button', { type: 'button', class: 'saved-line', onclick: () => { ui.otab = 'impact'; ui.impactScope = ui.assistScope === 'fusion' ? 'fusion' : 'all'; rerender(); } }, h('b', {}, formatCompact(im.money.net, im.currency, im.locale)), ` saved by fixing these now · ${im.hours.total} engineering hours back · see the business impact →`); })() : null);
}
const c0 = (s) => s.summary?.total ?? 0;

// --- Results, as Checkmarx One lays them out -----------------------------------
const allFindings = (s) => [...s.fusionOnly, ...s.others];
function filtered(s) {
  const q = ui.search.trim().toLowerCase();
  return allFindings(s).filter((f) => (ui.scanner === 'all' || f.engine === ui.scanner) && (!ui.severities.size || ui.severities.has(f.severity)) && (!ui.fusionOnly || f.fusionOnly) && (!q || `${f.title} ${f.explanation?.plainTitle} ${f.file} ${f.packageName} ${f.cwe} ${f.cve}`.toLowerCase().includes(q)));
}
function resultsView(s, id, key, rerender) {
  const findings = allFindings(s);
  const list = filtered(s);
  const selected = findings.find((f) => f.id === ui.selected) ?? null;
  const counts = Object.fromEntries(SCANNERS.map(([k]) => [k, findings.filter((f) => f.engine === k).length]));
  const ran = SCANNERS.filter(([k]) => k !== 'fusion' && counts[k]).map(([, l]) => l);
  return h('section', {},
    h('nav', { class: 'cx-tabs', 'aria-label': 'Scanners' }, [['all', 'All results', findings.length], ...SCANNERS.filter(([k]) => counts[k]).map(([k, l]) => [k, l, counts[k]])].map(([k, l, n]) =>
      h('button', { type: 'button', class: `cx-tab ${ui.scanner === k ? 'active' : ''} ${k === 'fusion' ? 'fusion' : ''}`, onclick: () => { ui.scanner = k; rerender(); } }, k === 'fusion' ? '✦ ' : '', l, h('span', { class: 'count' }, n)))),
    h('div', { class: `cx-workspace ${selected ? 'with-drawer' : ''}` },
      h('aside', { class: 'filters' },
        h('div', { class: 'filter-group' }, h('input', { type: 'search', placeholder: 'Search vulnerabilities', value: ui.search, 'aria-label': 'Search', oninput: (e) => { ui.search = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { rerender(); document.querySelector('.filters input[type=search]')?.focus(); }, 250); } })),
        h('div', { class: 'filter-group' }, h('h4', {}, 'Severity'), SEVERITIES.map((sev) => { const n = findings.filter((f) => f.severity === sev).length; return n ? h('label', { class: 'filter-check' }, h('input', { type: 'checkbox', checked: ui.severities.has(sev), onchange: (e) => { e.target.checked ? ui.severities.add(sev) : ui.severities.delete(sev); rerender(); } }), h('span', { class: `sev ${sev.toLowerCase()}` }, h('i'), titleCase(sev)), h('span', { class: 'count' }, n)) : null; })),
        h('div', { class: 'filter-group' }, h('h4', {}, 'Detection'), h('label', { class: 'filter-check' }, h('input', { type: 'checkbox', checked: ui.fusionOnly, onchange: (e) => { ui.fusionOnly = e.target.checked; rerender(); } }), 'Found only by Fusion', h('span', { class: 'count' }, s.summary.fusionOnly)), h('p', { class: 'filter-note' }, `${s.summary.confirmedByFusion ?? 0} rule-based finding(s) also confirmed by Fusion.`))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'cx' },
        h('thead', {}, h('tr', {}, ['Severity', 'Vulnerability', 'Scanner', 'Language', 'Location', 'Risk', 'AI', 'State'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, list.length ? list.map((f) => row(f, rerender, s)) : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'No results match these filters.'))))),
      selected ? drawer(selected, ran, rerender) : null));
}
function row(f, rerender, s) {
  const v = s?.assist?.triage?.items?.[f.id];
  const fx = s?.assist?.remediation?.items?.[f.id];
  const location = f.file ? `${f.file.replace(/^\/[^/]+\//, '')}${f.line ? `:${f.line}` : ''}` : f.packageName ? f.packageName.replace(/^[A-Za-z]+-/, '') : '—';
  const open = () => { ui.selected = f.id; ui.tab = null; rerender(); };
  return h('tr', { class: `${f.fusionOnly ? 'fusion-row' : ''} ${ui.selected === f.id ? 'selected' : ''}`, tabindex: 0, onclick: open, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) },
    h('td', {}, h('span', { class: `sev ${f.severity.toLowerCase()}` }, h('i'), titleCase(f.severity))),
    h('td', {}, h('div', { class: 'vuln-name' }, f.explanation?.plainTitle || f.title, f.fusionOnly ? h('span', { class: 'tag fusion' }, '✦ Fusion only') : null, f.confirmedByFusion ? h('span', { class: 'tag ok' }, '✓ Both engines') : null), f.explanation?.plainTitle && f.explanation.plainTitle !== f.title ? h('div', { class: 'vuln-q' }, f.title) : null),
    h('td', {}, scannerLabel(f.engine)), h('td', {}, f.language || '—'), h('td', { class: 'loc' }, location),
    h('td', {}, f.correlation ? h('span', { class: `tag ${f.correlation.direction === 'raised' ? 'bad' : f.correlation.direction === 'lowered' ? 'ok' : ''}` }, `${f.correlation.direction === 'raised' ? '▲' : f.correlation.direction === 'lowered' ? '▼' : '•'} ${f.correlation.newRisk.toFixed(1)}`) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'ai-cell' }, v && v.status !== 'queued' ? (v.status === 'running' ? h('span', { class: 'tag busy' }, h('i'), 'Triaging') : verdictTag(v)) : null, fx && fx.status !== 'queued' ? (fx.status === 'running' ? h('span', { class: 'tag busy' }, h('i'), 'Fixing') : fx.status === 'done' ? h('span', { class: 'tag ok' }, '⚡ Fix ready') : h('span', { class: 'tag bad' }, 'Fix failed')) : null, !v && !fx ? h('span', { class: 'muted' }, '—') : null),
    h('td', {}, titleCase(f.state || 'TO_VERIFY')));
}
function drawer(f, ran, rerender) {
  const ex = f.explanation ?? {};
  const v = current?.assist?.triage?.items?.[f.id];
  const fx = current?.assist?.remediation?.items?.[f.id];
  const tabs = [fx && fx.status !== 'queued' ? ['fix', '⚡ AI fix'] : null, v && v.status !== 'queued' ? ['triage', '✦ AI Triage'] : null, f.fusionOnly || f.correlation ? ['fusion', '✦ Fusion insight'] : null, ['plain', 'Plain language'], f.nodes?.length ? ['vector', 'Attack vector'] : null, ['details', 'Details']].filter(Boolean);
  const tab = tabs.some(([k]) => k === ui.tab) ? ui.tab : tabs[0][0];
  const sec = (title, text) => (text ? h('div', { class: 'dsec' }, h('h4', {}, title), h('p', {}, text)) : null);
  let body;
  if (tab === 'fusion') body = [
    f.fusionOnly ? h('div', { class: 'never' }, h('b', {}, 'Never reported by rule-based scanning'), h('p', {}, 'Every other engine ran on this code and none of them flagged it:'), h('div', { class: 'misses' }, (ran.length ? ran : ['SAST', 'SCA', 'IaC Security']).map((e) => h('span', {}, '✕ ', e)), h('span', { class: 'hit' }, '✓ Fusion'))) : null,
    sec('What Fusion determined', f.fusionInsight || ex.whatItMeans),
    f.correlation ? h('div', { class: 'dsec' }, h('h4', {}, 'Risk score, after correlation'), h('div', { class: 'corr-row', style: 'margin-top:4px' }, h('span', { class: `delta ${f.correlation.direction}` }, `${f.correlation.oldRisk.toFixed(1)} → ${f.correlation.newRisk.toFixed(1)}`), h('span', {}, h('b', {}, f.correlation.direction === 'raised' ? 'Raised: an exploitable path exists' : f.correlation.direction === 'lowered' ? 'Lowered: no exploitable path found' : 'Unchanged'), h('small', {}, f.correlation.reason), f.correlation.with ? h('small', {}, `Correlated with ${f.correlation.with}`) : null))) : null,
    f.fusionOnly ? sec('Why the deterministic engines did not report it', ex.whyMissed || ex.whyFusionFoundIt) : null,
    f.fusionOnly && ex.whyCaught ? sec('Why Checkmarx Fusion found it', ex.whyCaught) : null,
    f.fusionOnly && ex.evidence?.length ? h('ul', { class: 'evidence' }, ex.evidence.map((e) => h('li', {}, e))) : null,
    sec('Business impact', ex.businessImpact), sec('How to fix', ex.howToFix),
    ex.urgency ? h('p', { class: 'urgency' }, ex.urgency) : null, f.nodes?.length ? h('div', { class: 'dsec' }, h('h4', {}, 'Where it happens'), vector(f, 4)) : null];
  else if (tab === 'triage') body = v.status === 'running' ? [h('p', { class: 'muted' }, 'Checkmarx One AI is reasoning about whether this is reachable and exploitable…')] : [
    h('div', { class: 'dsec' }, h('h4', {}, 'Verdict'), h('div', { class: 'row' }, verdictTag(v, 'lg'), v.reachability ? h('span', { class: 'tag' }, titleCase(v.reachability)) : null, v.exploitability ? h('span', { class: 'tag' }, titleCase(v.exploitability)) : null)),
    sec('Why', v.reason), v.status === 'failed' && v.error ? h('p', { class: 'error' }, v.error) : null,
    h('p', { class: 'hint' }, 'AI Triage reads the data flow end to end and judges whether an attacker can reach and exploit it — the verdict and its reasoning are written back to the finding in Checkmarx One.')];
  else if (tab === 'fix') body = fx.status === 'running' ? [h('p', { class: 'muted' }, 'Checkmarx One AI Remediation is writing the fix…')] : fx.status === 'failed' ? [h('p', { class: 'error' }, fx.error || 'AI Remediation failed.')] : [
    sec('The fix', fx.summary), sec('How', fx.how), sec('Why this way', fx.why),
    fx.prUrl ? h('p', {}, h('a', { href: fx.prUrl, target: '_blank', rel: 'noopener' }, 'Open the pull request ↗')) : null,
    ...(fx.changes ?? []).map((ch) => h('div', { class: 'dsec' }, h('h4', {}, ch.path), ch.analysis ? h('p', { class: 'hint' }, ch.analysis) : null, patchView(ch.diff))),
    fx.tests?.length ? h('p', { class: 'hint' }, `Tests written with the fix: ${fx.tests.join(', ')}`) : null,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'sm', onclick: (e) => { navigator.clipboard?.writeText((fx.changes ?? []).map((c) => `--- a/${c.path}\n+++ b/${c.path}\n${c.diff}`).join('\n')).then(() => { e.target.textContent = 'Copied'; }); } }, 'Copy patch'), h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Applies with git apply in the repository.'))];
  else if (tab === 'plain') body = [sec('What it means', ex.whatItMeans), sec('Business impact', ex.businessImpact), sec('How to fix', ex.howToFix), ex.urgency ? h('p', { class: 'urgency' }, ex.urgency) : null];
  else if (tab === 'vector') body = [vector(f)];
  else body = h('dl', { class: 'info' }, [['Vulnerability', f.title], ['Scanner', scannerLabel(f.engine)], ['Severity', f.severity], ['CWE', f.cwe && `CWE-${f.cwe}`], ['CVE', f.cve], ['CVSS', f.cvss], ['Language', f.language], ['Package', f.packageName], ['Fixed in', f.recommendedVersion], ['File', f.file && `${f.file}${f.line ? `:${f.line}` : ''}`], ['Expected', f.expected], ['Actual', f.actual], ['State', f.state], ['Status', f.status], ['First detected', f.firstFoundAt && fmtDate(f.firstFoundAt)], ['Description', f.description]].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  return h('aside', { class: `drawer ${f.fusionOnly ? 'fusion' : ''}`, 'aria-label': 'Result details' },
    h('header', {}, h('div', {}, h('span', { class: `sev ${f.severity.toLowerCase()}` }, h('i'), titleCase(f.severity)), f.fusionOnly ? h('span', { class: 'tag fusion' }, '✦ Fusion only') : null, f.confirmedByFusion ? h('span', { class: 'tag ok' }, '✓ Both engines') : null), h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => { ui.selected = null; rerender(); } }, '×')),
    h('h2', {}, ex.plainTitle || f.title), h('p', { class: 'sub' }, scannerLabel(f.engine), f.cwe ? ` · CWE-${f.cwe}` : '', f.cve ? ` · ${f.cve}` : ''),
    h('div', { class: 'dtabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), class: k === tab ? 'active' : '', onclick: () => { ui.tab = k; rerender(); } }, l))),
    h('div', {}, body));
}
function patchView(diff) {
  return h('pre', { class: 'patch' }, String(diff).split('\n').map((l) => h('span', { class: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : '' }, l, '\n')));
}
function vector(f, limit = Infinity) {
  const nodes = f.nodes.slice(0, limit);
  return h('ol', { class: 'vector' }, nodes.map((n, i) => h('li', { class: i === 0 ? 'source' : i === f.nodes.length - 1 ? 'sink' : '' }, h('span', { class: 'role' }, i === 0 ? 'Source' : i === f.nodes.length - 1 ? 'Sink' : `Step ${i + 1}`), h('span', { class: 'nm' }, n.name || n.method || '—'), h('span', { class: 'lc' }, `${String(n.file).replace(/^\/[^/]+\//, '')}${n.line ? `:${n.line}` : ''}`))), f.nodes.length > nodes.length ? h('li', { class: 'muted', style: 'font-size:12px' }, `+ ${f.nodes.length - nodes.length} more steps (Attack vector tab)`) : null);
}

// --- Team ------------------------------------------------------------------------
function teamPanel(s, id, key) {
  if (!s.customer?.email) return null;
  const status = { sent: 'Invited', queued: 'Invite queued', failed: 'Invite failed', 'not-invited': 'Not invited yet' };
  const msg = h('p', { class: 'invite-msg', role: 'status' });
  async function invite(invitees, btn) {
    btn.disabled = true; msg.textContent = '';
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(id)}/invites`, { k: key, invitees });
      document.getElementById('invite-form')?.reset();
      await renderSession(id, key);
      const failed = data.results.filter((r) => r.delivery === 'failed').map((r) => r.email);
      const m = document.querySelector('.invite-msg');
      if (m) m.textContent = failed.length ? `Could not email ${failed.join(', ')}.` : `${data.results.some((r) => r.delivery === 'queued') ? 'Invitation queued for' : 'Invitation sent to'} ${invitees.map((i) => i.email).join(', ')}.`;
    } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  }
  const form = h('form', { id: 'invite-form', class: 'invite-form', novalidate: true }, h('input', { name: 'inviteName', placeholder: 'Name', 'aria-label': 'Colleague name' }), h('input', { name: 'inviteEmail', type: 'email', placeholder: 'name@company.com', 'aria-label': 'Colleague email', required: true }), h('button', { class: 'primary sm', type: 'submit' }, 'Invite'));
  form.addEventListener('submit', (e) => { e.preventDefault(); const email = form.inviteEmail.value.trim(); if (!email) { msg.textContent = 'Enter an email address.'; return; } invite([{ name: form.inviteName.value.trim(), email }], form.querySelector('button')); });
  const pending = (s.team ?? []).filter((t) => t.delivery !== 'sent' && t.delivery !== 'queued');
  return h('div', { class: 'panel tight team' },
    h('h4', {}, 'Your team'),
    h('ul', {}, h('li', {}, h('div', {}, h('b', {}, s.customer.name), h('small', {}, s.customer.email)), h('span', { class: 'tag accent' }, 'You')),
      s.technical?.email && s.technical.email !== s.customer.email ? h('li', {}, h('div', {}, h('b', {}, s.technical.name), h('small', {}, s.technical.email)), h('span', { class: 'tag' }, 'Technical')) : null,
      (s.team ?? []).map((t) => h('li', {}, h('div', {}, h('b', {}, t.name || t.email), t.name ? h('small', {}, t.email) : null, h('small', { class: `status ${t.delivery}` }, status[t.delivery] ?? t.delivery)), h('button', { class: 'link', type: 'button', onclick: (e) => invite([{ name: t.name, email: t.email, role: t.role }], e.target) }, t.delivery === 'sent' || t.delivery === 'queued' ? 'Resend' : 'Invite')))),
    pending.length > 1 ? h('button', { class: 'sm', type: 'button', onclick: (e) => invite(pending.map(({ name, email, role }) => ({ name, email, role })), e.target) }, `Invite all ${pending.length}`) : null,
    h('h4', { style: 'margin-top:12px' }, 'Invite someone else'), form, msg);
}

// ---------------------------------------------------------------------------
function route() {
  const m = location.pathname.match(/^\/s\/([a-f0-9-]{36})$/);
  const key = new URLSearchParams(location.search).get('k');
  if (m && key) renderSession(m[1], key);
  else renderWelcome();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.selected && current) { ui.selected = null; const m = location.pathname.match(/^\/s\/([a-f0-9-]{36})$/); if (m) renderSession(m[1], new URLSearchParams(location.search).get('k'), { reload: false }); } });
window.addEventListener('popstate', route);
route();
