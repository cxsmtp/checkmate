import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, publicSettings, publicBranding, saveSettings, isLive, assistLive } from './config.js';
import * as store from './store.js';
import * as samples from './samples.js';
import * as profiles from './profiles.js';
import * as auth from './admin-auth.js';
import { audit, recentAudit } from './audit.js';
import { validateRegistration, isEmail } from './validation.js';
import { prepareScan, startScan, runScan, resumeInFlight, reuseSampleScan, usePublishedScan, autoFix } from './scanRunner.js';
import { send, inviteEmail, fixesEmail, boardEmail, resultsLink, verifySmtp } from './mailer.js';
import { boardModel } from '../public/board.js';
import { testConnection, scanUiUrl, findPublishedScan } from './checkmarx.js';
import { parseEnvText, settingsFromEnv, isSecretVariable } from './env-import.js';
import * as assist from './assist.js';
import { impactSettings } from '../public/impact.js';
import * as cities from './cities.js';
import * as places from './places.js';
import { scanOptions as tenantScanOptions } from './checkmarx.js';
import { demoScanOptions } from './demo.js';
import { IntegrityService } from './integrity/service.js';
import { UpdateService } from './updates/service.js';
import { VersionStore } from './updates/store.js';
import { DEFAULT_IMAGE } from './updates/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const publicDir = path.join(appDir, 'public');
const MAX_INVITES = 25;

// ---------------------------------------------------------------------------
// Software integrity and updates (ported from CxMissionZero)
// ---------------------------------------------------------------------------
const supervised = process.env.CHECKMATE_SUPERVISOR === '1';
const githubToken = process.env.GITHUB_READ_TOKEN || '';

export const integrity = new IntegrityService({ appDir, dataDir: config.dataDir, token: githubToken, record: (e) => audit({ type: 'integrity', ...e }) });

export const updates = new UpdateService({
  store: new VersionStore({ dataDir: config.dataDir, builtInDir: process.env.CHECKMATE_BUILTIN_DIR || appDir, builtInVersion: process.env.CHECKMATE_BUILTIN_VERSION || config.version }),
  runningVersion: config.version,
  image: process.env.UPDATE_IMAGE || DEFAULT_IMAGE,
  token: process.env.UPDATE_REGISTRY_TOKEN || githubToken,
  supervised,
  integrity,
  record: (e) => audit({ type: 'update', ...e }),
  beforeSwitch: async () => backup('before-update'),
  switchTo: (message) => process.send?.(message),
});

/** A copy of the small state files before a version switch. */
function backup(reason) {
  const dir = path.join(config.dataDir, 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of ['settings.json', 'samples.json', 'admin.json', 'profiles.json']) {
    const from = path.join(config.dataDir, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
  }
  const all = fs.readdirSync(path.join(config.dataDir, 'backups')).sort();
  for (const old of all.slice(0, -10)) fs.rmSync(path.join(config.dataDir, 'backups', old), { recursive: true, force: true });
  return dir;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(express.json({ limit: '6mb' }));

let draining = false;
app.use((req, res, next) => {
  if (draining) {
    res.set('Retry-After', '3');
    return res.status(503).json({ error: 'Restarting for an update, retry in a few seconds.' });
  }
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Geolocation only for this page: it picks the city theme, in the browser.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    // img-src https: for a logo given as an https address (Settings → Branding).
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(publicDir, { index: false, maxAge: '1h' }));

// --- tiny per-IP rate limiter ------------------------------------------------
const hits = new Map();
function rateLimit(max, windowMs, name) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many requests, please wait a moment.' });
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k);
}, 600_000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- helpers -----------------------------------------------------------------
function authorised(req, res) {
  const session = store.load(req.params.id);
  const key = String(req.query.k ?? req.body?.k ?? '');
  const ok = session && key.length === session.accessKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(session.accessKey));
  if (!ok) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
}

function publicView(s, { admin = false } = {}) {
  const { accessKey, cx, ...rest } = s;
  // Tenant identifiers and links are for the booth team, not visitors.
  const scan = cx ? { status: cx.status, engines: cx.engines, branch: cx.branch, demo: cx.demo, config: cx.config } : undefined;
  return {
    ...rest,
    cx: admin ? { ...cx, url: cx?.projectId && !cx.demo ? scanUiUrl(cx.projectId, cx.scanId) : undefined } : scan,
    mode: isLive() ? 'live' : 'demo',
    // Where these results come from, so the page can say so: the tenant, the scan, when it completed.
    source: cx ? { live: !cx.demo, tenant: cx.demo ? '' : config.connection?.tenant ?? '', region: cx.demo ? '' : config.connection?.regionLabel ?? '', scan: cx.demo ? '' : String(cx.scanId ?? '').slice(0, 8), published: Boolean(cx.published) } : undefined,
    eventName: config.event.name,
    assistEnabled: config.assist.enabled,
    assistSimulated: !assistLive(),
    assistScopes: s.stage === 'complete' ? assist.scopeCounts(s) : undefined,
  };
}

async function inviteAll(session, invitees) {
  const inviter = session.technical?.email ? session.technical : session.customer;
  const results = [];
  for (const invitee of invitees) {
    try {
      const r = await send(inviteEmail({ session, invitee, inviter }));
      results.push({ ...invitee, invitedAt: new Date().toISOString(), delivery: r.delivered ? 'sent' : 'queued' });
    } catch (err) {
      results.push({ ...invitee, delivery: 'failed', error: err.message });
    }
  }
  return results;
}

function mergeInvites(session, results) {
  const team = session.team ?? [];
  for (const r of results) {
    const existing = team.find((t) => t.email === r.email);
    if (existing) Object.assign(existing, r, { name: r.name || existing.name, role: r.role || existing.role });
    else team.push(r);
  }
  session.team = team;
}

function newSession(fields) {
  return store.save({
    id: crypto.randomUUID(),
    accessKey: crypto.randomBytes(24).toString('base64url'),
    createdAt: new Date().toISOString(),
    stage: 'options',
    timeline: [{ stage: 'options', at: new Date().toISOString() }],
    team: [],
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, version: config.version, integrity: integrity.last?.state ?? 'pending' }));

app.get('/api/config', (req, res) =>
  res.json({
    eventName: config.event.name,
    mode: isLive() ? 'live' : 'demo',
    version: config.version,
    samples: samples.publicList(),
    defaultCity: config.defaultCity,
    askLocation: config.askLocation,
    branding: publicBranding(),
    cityPhotos: cities.publicList(),
    profilesLookup: config.profiles.lookup,
    profilesMinChars: config.profiles.minChars,
    connected: Boolean(config.connection) || !isLive(),
    tenantRegion: config.connection?.regionLabel ?? '',
    impact: config.impact.enabled ? impactSettings(config.impact) : null,
  }),
);

// --- Where the visitor is: any city in the world, its photos ------------------------
app.get('/api/places/reverse', rateLimit(60, 60 * 1000, 'places'), wrap(async (req, res) => {
  try { res.json(await places.reverse(req.query.lat, req.query.lon)); }
  catch (e) { res.status(e.status ?? 502).json({ error: e.status ? e.message : 'The city could not be looked up right now.' }); }
}));
app.get('/api/places/search', rateLimit(60, 60 * 1000, 'places'), wrap(async (req, res) => {
  try { res.json(await places.search(req.query.q)); }
  catch { res.status(502).json({ error: 'Cities could not be searched right now.' }); }
}));
app.get('/api/places/:key/photos', rateLimit(60, 60 * 1000, 'place-photos'), wrap(async (req, res) => {
  if (!places.isPlaceKey(req.params.key)) return res.status(400).json({ error: 'Not a city' });
  const name = String(req.query.name ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 80);
  res.json(config.cities.autoFetch ? await cities.ensure(req.params.key, name) : cities.photosFor(req.params.key));
}));

/** What a scan can run on this tenant (engines, Fusion, models), cached briefly: the details screen offers the model. */
let optionsCache = { at: 0, live: null, value: null };
app.get('/api/scan-options', wrap(async (req, res) => {
  const live = isLive();
  if (optionsCache.value && optionsCache.live === live && Date.now() - optionsCache.at < 5 * 60_000) return res.json(optionsCache.value);
  let value;
  try { value = live ? await tenantScanOptions() : demoScanOptions(); }
  catch (e) { value = { ...demoScanOptions(), source: 'defaults', warning: e.message }; }
  const out = { source: value.source, region: value.region, fusion: value.fusion, models: value.models, engines: value.engines.filter((e) => e.default) };
  optionsCache = { at: Date.now(), live, value: out };
  res.json(out);
}));

/** Type-ahead: who are you? Names and companies only; addresses come with the pick. */
app.get('/api/profiles/search', rateLimit(240, 60 * 1000, 'profile-search'), (req, res) => {
  if (!config.profiles.lookup) return res.json([]);
  res.json(profiles.search(String(req.query.q ?? '').slice(0, 80)));
});
app.get('/api/profiles/:id/pick', rateLimit(60, 60 * 1000, 'profile-pick'), (req, res) => {
  if (!config.profiles.lookup) return res.status(404).json({ error: 'Not available' });
  const p = profiles.forRegistration(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.post('/api/sessions', rateLimit(15, 60 * 60 * 1000, 'register'), wrap(async (req, res) => {
  const { value, errors } = validateRegistration(req.body, { getSample: samples.get });
  if (errors) return res.status(400).json({ errors });

  const session = newSession({
    kind: value.sampleId ? 'sample' : 'customer',
    sampleId: value.sampleId,
    profileId: value.profileId,
    customer: value.customer,
    technical: value.technical,
    repo: value.repo,
    branch: value.branch,
    theme: value.theme,
    place: value.place,
    team: value.pocs.map((p) => ({ ...p, delivery: 'not-invited' })),
  });
  audit({ type: 'registration', outcome: 'info', reason: `${value.customer.email} registered ${value.repo.url}${value.sampleId ? ' (sample)' : ''}` });
  try {
    profiles.rememberRegistration(value);
  } catch (e) {
    console.warn(`Profile not remembered: ${e.message}`);
  }

  // A sample with a recent scan is shown at once; anything else goes to the scan-profile step.
  // With the visitor's choice made on the same screen (the model), the scan starts at once.
  const reusable = value.sampleId && samples.reusable(samples.get(value.sampleId));
  if (reusable && reuseSampleScan(session.id, reusable.sessionId)) autoFix(session.id);
  else {
    const choice = scanChoice(req.body?.scan);
    prepareScan(session.id).then((s) => { if (choice && s?.stage === 'profile') startScan(session.id, choice); }).catch((e) => console.warn(`Scan not started: ${e.message}`));
  }

  if (req.body.inviteNow !== false) {
    inviteAll(session, value.pocs).then((results) => store.update(session.id, (s) => mergeInvites(s, results)));
  }
  if (config.smtp.notify) {
    send({
      to: config.smtp.notify,
      subject: `[${config.event.name}] New registration: ${value.customer.name} — ${value.repo.owner}/${value.repo.repo}`,
      text: `${value.customer.name} <${value.customer.email}> ${value.customer.company ? `(${value.customer.company})` : ''}\nTechnical: ${value.technical.name} <${value.technical.email}>\nOps contacts: ${value.pocs.map((p) => `${p.name} <${p.email}>`).join(', ')}\nRepo: ${value.repo.url}\nResults: ${resultsLink(session)}`,
    }).catch(() => {});
  }

  res.status(201).json({ id: session.id, accessKey: session.accessKey, url: `/s/${session.id}?k=${session.accessKey}` });
}));

app.get('/api/sessions/:id', (req, res) => {
  const session = authorised(req, res);
  if (session) res.json(publicView(session, { admin: auth.isAdmin(req) }));
});

/** The visitor's scan choice, cleaned; null when none was sent (the scan-profile step then asks). */
function scanChoice(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    engines: Array.isArray(body.engines) ? body.engines.map(String).slice(0, 10) : undefined,
    fusion: typeof body.fusion === 'boolean' ? body.fusion : undefined,
    llmModel: typeof body.llmModel === 'string' ? body.llmModel.slice(0, 40) : undefined,
    presetName: typeof body.presetName === 'string' ? body.presetName.slice(0, 120) : undefined,
  };
}

/** The visitor's scan profile: engines, Fusion, the LLM model, the preset. */
app.post('/api/sessions/:id/start', wrap(async (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  if (session.stage !== 'profile') return res.status(409).json({ error: 'This scan has already started.' });
  const updated = startScan(session.id, scanChoice(req.body));
  audit({ type: 'scan', outcome: 'info', reason: `Scan started for ${session.repo.url}: ${updated.profile.engines.join(', ')}${updated.profile.fusion ? `, Fusion (${updated.profile.llmModel || 'default model'})` : ''}` });
  res.json(publicView(updated));
}));

app.post('/api/sessions/:id/invites', rateLimit(30, 60 * 60 * 1000, 'invite'), wrap(async (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  const raw = Array.isArray(req.body.invitees) ? req.body.invitees : [];
  const invitees = raw
    .map((i) => ({ name: String(i?.name ?? '').trim().slice(0, 120), email: String(i?.email ?? '').trim().toLowerCase().slice(0, 254), role: String(i?.role ?? '').trim().slice(0, 60) }))
    .filter((i) => i.email);
  const bad = invitees.filter((i) => !isEmail(i.email));
  if (!invitees.length || bad.length) return res.status(400).json({ error: `Please enter valid email addresses${bad.length ? `: ${bad.map((b) => b.email).join(', ')}` : ''}.` });
  if (!session.customer?.email) return res.status(400).json({ error: 'Invitations are not available for this scan.' });

  const known = new Set((session.team ?? []).map((t) => t.email));
  const newOnes = invitees.filter((i) => !known.has(i.email)).length;
  if ((session.team?.length ?? 0) + newOnes > MAX_INVITES) return res.status(400).json({ error: `Up to ${MAX_INVITES} team members can be invited.` });

  const results = await inviteAll(session, invitees);
  const updated = store.update(session.id, (s) => mergeInvites(s, results));
  res.json({ team: updated.team, results });
}));

// --- Closing the loop: AI Triage and AI Remediation, one click each ------------
const assistScope = (req) => (assist.SCOPES[req.body?.scope] ? req.body.scope : 'fusion');
app.post('/api/sessions/:id/assist/triage', rateLimit(30, 60 * 60 * 1000, 'assist'), (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  if (!config.assist.enabled) return res.status(404).json({ error: 'AI assist is switched off.' });
  try {
    res.status(202).json(publicView(assist.startTriage(session.id, assistScope(req))));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
app.post('/api/sessions/:id/assist/remediate', rateLimit(30, 60 * 60 * 1000, 'assist'), (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  if (!config.assist.enabled) return res.status(404).json({ error: 'AI assist is switched off.' });
  try {
    res.status(202).json(publicView(assist.startRemediation(session.id, assistScope(req))));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
app.post('/api/sessions/:id/assist/fix', rateLimit(30, 60 * 60 * 1000, 'assist'), (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  if (!config.assist.enabled) return res.status(404).json({ error: 'AI assist is switched off.' });
  try {
    res.status(202).json(publicView(assist.startFixAll(session.id, assistScope(req))));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
/** The fixes, as a developer brief, to the technical owner (and anyone else named). */
app.post('/api/sessions/:id/assist/send', rateLimit(20, 60 * 60 * 1000, 'assist-send'), wrap(async (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  const list = assist.fixes(session);
  if (!list.length) return res.status(400).json({ error: 'There are no fixes to send yet.' });
  const extra = Array.isArray(req.body?.to) ? req.body.to.map((e) => String(e).trim().toLowerCase()).filter(isEmail).slice(0, 10) : [];
  const to = [...new Set([session.technical?.email, ...extra].filter(Boolean))];
  if (!to.length) return res.status(400).json({ error: 'No developer address to send to.' });
  const results = [];
  for (const addr of to) {
    try { await send(fixesEmail({ session, to: addr, fixes: list })); results.push({ to: addr, ok: true }); }
    catch (e) { results.push({ to: addr, ok: false, error: e.message }); }
  }
  const updated = store.update(session.id, (s) => { s.assist ??= {}; (s.assist.sent ??= []).push({ at: new Date().toISOString(), to, count: list.length, ok: results.every((r) => r.ok) }); });
  audit({ type: 'assist', outcome: 'info', reason: `Fixes for ${session.repo.url} sent to ${to.join(', ')} (${list.length})` });
  res.json({ results, assist: updated.assist });
}));

/** The board brief, emailed to the visitor, the technical owner and the team. */
app.post('/api/sessions/:id/board/send', rateLimit(10, 60 * 60 * 1000, 'board-send'), wrap(async (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  if (session.stage !== 'complete') return res.status(409).json({ error: 'The results are not ready yet.' });
  const p = req.body?.place && typeof req.body.place === 'object' ? { key: String(req.body.place.key ?? '').slice(0, 60), name: String(req.body.place.name ?? '').slice(0, 80), countryCode: String(req.body.place.countryCode ?? '').slice(0, 2) } : null;
  const b = boardModel({ session: publicView(session), settings: impactSettings(config.impact), place: p, locale: String(req.body?.locale ?? '').slice(0, 20), appName: config.branding.appName });
  const to = [...new Set([session.customer?.email, session.technical?.email, ...(session.team ?? []).map((t) => t.email)].filter(isEmail))].slice(0, 12);
  if (!to.length) return res.status(400).json({ error: 'No address to send to.' });
  const results = [];
  for (const addr of to) {
    try { await send(boardEmail({ to: addr, session, b })); results.push({ to: addr, ok: true }); }
    catch (e) { results.push({ to: addr, ok: false, error: e.message }); }
  }
  audit({ type: 'assist', outcome: 'info', reason: `Board brief for ${session.repo.url} sent to ${to.join(', ')}` });
  res.json({ results });
}));

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const admin = express.Router();

admin.post('/login', rateLimit(10, 15 * 60 * 1000, 'login'), (req, res) => {
  if (!auth.verifyPassword(req.body?.password)) {
    audit({ type: 'admin', outcome: 'failure', reason: `Failed admin sign-in from ${req.ip}` });
    return res.status(401).json({ error: 'Wrong password.' });
  }
  auth.createSession(req, res);
  audit({ type: 'admin', outcome: 'info', reason: `Admin signed in from ${req.ip}` });
  res.json({ signedIn: true, mustChangePassword: auth.firstStart() });
});

admin.get('/me', (req, res) => res.json({ signedIn: auth.isAdmin(req), mustChangePassword: auth.isAdmin(req) && auth.firstStart() }));

admin.use(auth.requireAdmin);

admin.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ signedIn: false });
});

admin.post('/password', (req, res) => {
  if (!auth.verifyPassword(req.body?.current)) return res.status(400).json({ error: 'The current password is wrong.' });
  try {
    auth.setPassword(req.body?.next);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  audit({ type: 'admin', outcome: 'changed', reason: 'Admin password changed' });
  auth.createSession(req, res);
  res.json({ ok: true });
});

// --- settings, branding, .env import -----------------------------------------
admin.get('/settings', (req, res) => res.json(publicSettings()));
admin.put('/settings', (req, res) => {
  const result = saveSettings(req.body);
  if (result.errors) return res.status(400).json(result);
  audit({ type: 'settings', outcome: 'changed', reason: `Settings changed: ${Object.keys(req.body ?? {}).join(', ')}` });
  prepareSamples().catch(() => {});
  res.json(publicSettings());
});
admin.post('/settings/test', wrap(async (req, res) => {
  try {
    res.json(await testConnection());
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}));
admin.post('/settings/test-smtp', wrap(async (req, res) => {
  try {
    const result = await verifySmtp();
    if (isEmail(req.body?.to)) await send({ to: req.body.to, subject: `${config.event.name}: test email`, text: 'The mail server is set up correctly.', html: '<p>The mail server is set up correctly.</p>' });
    res.json(result);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}));

/** Configure from an uploaded .env file (as in CxMissionZero): applied, then the connection is checked. */
admin.post('/settings/import-env', wrap(async (req, res) => {
  let vars;
  try {
    vars = parseEnvText(req.body?.text);
  } catch (e) {
    return res.status(e.status ?? 400).json({ error: e.message });
  }
  const { patch, applied, ignored } = settingsFromEnv(vars);
  if (!applied.length) return res.status(400).json({ error: 'No setting this page understands was found in that file (or every value was blank).', applied, ignored });
  const result = saveSettings(patch);
  if (result.errors) return res.status(400).json({ error: `Some values are not valid: ${Object.entries(result.errors).map(([k, v]) => `${k}: ${v}`).join('; ')}`, errors: result.errors, applied, ignored });
  audit({ type: 'settings', outcome: 'changed', reason: `Settings imported from a .env file: ${applied.join(', ')}`, details: { applied, ignored, secrets: applied.filter(isSecretVariable) } });
  const check = { cxone: null, smtp: null };
  if (config.checkmarx.apiKey && config.connection) check.cxone = await testConnection().then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: e.message }));
  else if (config.checkmarx.apiKey) check.cxone = config.connection ? { ok: true, tenant: config.connection.tenant, region: config.connection.regionLabel, note: isLive() ? '' : 'Key accepted; Mode is set to demo.' } : { ok: false, error: config.connectionError };
  prepareSamples().catch(() => {});
  if (config.smtp.host) check.smtp = await verifySmtp().then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
  res.json({ applied, ignored, check, settings: publicSettings() });
}));

// --- city photography ---------------------------------------------------------
admin.get('/cities', (req, res) => res.json({ photos: cities.publicList(), names: cities.names() }));
admin.post('/cities/:city/fetch', wrap(async (req, res) => {
  try {
    const r = await cities.fetchFromCommons(req.params.city, { count: Number(req.body?.count) || 3, name: String(req.body?.name ?? '').slice(0, 80) });
    audit({ type: 'branding', outcome: 'changed', reason: `City photos fetched for ${req.params.city}: ${r.added} added` });
    res.json({ ...r, photos: cities.publicList() });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message });
  }
}));
admin.post('/cities/:city/photos', (req, res) => {
  try {
    cities.upload(req.params.city, req.body?.dataUrl, req.body?.credit, String(req.body?.name ?? '').slice(0, 80));
    audit({ type: 'branding', outcome: 'changed', reason: `City photo uploaded for ${req.params.city}` });
    res.status(201).json(cities.publicList());
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
admin.delete('/cities/:city/photos/:n', (req, res) => {
  if (!cities.remove(req.params.city, req.params.n)) return res.status(404).json({ error: 'Not found' });
  res.json(cities.publicList());
});

// --- samples -----------------------------------------------------------------
admin.get('/samples', (req, res) => res.json(samples.list().map((x) => {
  const runId = x.scanning?.sessionId ?? x.latest?.sessionId;
  const run = runId && store.load(runId);
  return { ...x, run: run ? { stage: run.stage, error: run.error ?? '', published: Boolean(run.cx?.published), scanId: run.cx?.scanId ?? '', project: run.cx?.projectName ?? '' } : null };
})));
admin.post('/samples', (req, res) => {
  const { sample, errors } = samples.create(req.body);
  if (errors) return res.status(400).json({ errors });
  audit({ type: 'samples', outcome: 'changed', reason: `Sample added: ${sample.url}` });
  if (sample.enabled && config.samplesAutoScan) scanSample(sample).catch((err) => console.warn(`Sample ${sample.name}: ${err.message}`));
  res.status(201).json(samples.get(sample.id));
});
admin.put('/samples/:id', (req, res) => {
  const { sample, errors, notFound } = samples.update(req.params.id, req.body);
  if (notFound) return res.status(404).json({ error: 'Not found' });
  if (errors) return res.status(400).json({ errors });
  if (config.samplesAutoScan && samples.needsScan(sample)) scanSample(sample).catch((err) => console.warn(`Sample ${sample.name}: ${err.message}`));
  res.json(samples.get(sample.id));
});
admin.delete('/samples/:id', (req, res) => {
  if (!samples.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
admin.post('/samples/:id/scan', wrap(async (req, res) => {
  const sample = samples.get(req.params.id);
  if (!sample) return res.status(404).json({ error: 'Not found' });
  const session = await scanSample(sample, { force: true });
  audit({ type: 'samples', outcome: 'info', reason: `Scan started for sample ${sample.url}` });
  res.status(202).json({ id: session.id, url: `/s/${session.id}?k=${session.accessKey}` });
}));

/**
 * Sample repositories keep their results ready: a scan starts as soon as one is added (or its
 * repository changes), when the tenant connects, and when the results are older than the refresh
 * window. One scan per sample at a time.
 */
async function scanSample(sample, { force = false } = {}) {
  const running = sample.scanning?.sessionId && store.load(sample.scanning.sessionId);
  if (!force && running && !['complete', 'error'].includes(running.stage)) return running;
  const [, owner, name] = new URL(sample.url).pathname.split('/');
  const base = { kind: 'sample-refresh', sampleId: sample.id, repo: { owner, repo: name, url: sample.url }, branch: sample.branch, customer: { name: 'Booth team', email: '', company: sample.name } };
  // Live: results already published on the tenant are shown at once (Fusion scans first) …
  if (isLive() && !force && !samples.reusable(sample)) {
    try {
      const found = await findPublishedScan({ projectName: sample.cxProject, repoUrl: sample.url });
      if (found) {
        const published = newSession(base);
        samples.markScanning(sample.id, published.id);
        await usePublishedScan(published.id, found);
        console.log(`Sample ${sample.name}: published results of ${found.project.name} (scan ${found.scan.id.slice(0, 8)}) are ready.`);
        const fresh = samples.get(sample.id);
        if (!samples.needsScan(fresh)) return store.load(published.id);
      }
    } catch (err) {
      console.warn(`Sample ${sample.name}: published results not read: ${err.message}`);
    }
  }
  // … and a fresh scan runs on the tenant (or in the demo).
  const session = newSession(base);
  samples.markScanning(sample.id, session.id);
  await prepareScan(session.id);
  startScan(session.id, {});
  return session;
}

export async function prepareSamples(log = console) {
  if (!config.samplesAutoScan) return;
  for (const sample of samples.list().filter((s) => samples.needsScan(s))) {
    const running = sample.scanning?.sessionId && store.load(sample.scanning.sessionId);
    if (running && !['complete', 'error'].includes(running.stage)) continue;
    try {
      await scanSample(sample);
      log.log?.(`Sample ${sample.name}: scan started so its results are ready for visitors.`);
    } catch (err) {
      log.warn?.(`Sample ${sample.name}: could not start a scan: ${err.message}`);
    }
  }
}

// --- profiles ----------------------------------------------------------------
admin.get('/profiles', (req, res) => res.json(profiles.list()));
admin.get('/profiles.csv', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="checkmate-profiles-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(profiles.exportCsv());
});
admin.post('/profiles', (req, res) => {
  const { profile, errors } = profiles.create(req.body);
  if (errors) return res.status(400).json({ errors });
  audit({ type: 'profiles', outcome: 'changed', reason: `Profile added: ${profile.email}` });
  res.status(201).json(profile);
});
admin.post('/profiles/import', (req, res) => {
  const result = profiles.importCsv(String(req.body?.text ?? '').slice(0, 2_000_000));
  if (result.error) return res.status(400).json(result);
  audit({ type: 'profiles', outcome: 'changed', reason: `Profiles imported: ${result.added} added, ${result.updated} updated, ${result.skipped.length} skipped` });
  res.json(result);
});
admin.put('/profiles/:id', (req, res) => {
  const { profile, errors, notFound } = profiles.update(req.params.id, req.body);
  if (notFound) return res.status(404).json({ error: 'Not found' });
  if (errors) return res.status(400).json({ errors });
  res.json(profile);
});
admin.delete('/profiles/:id', (req, res) => {
  if (!profiles.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
  audit({ type: 'profiles', outcome: 'changed', reason: `Profile removed: ${req.params.id}` });
  res.json({ ok: true });
});

// --- registrations -----------------------------------------------------------
admin.get('/sessions', (req, res) => {
  const all = store
    .listAll()
    .map((s) => ({
      id: s.id,
      kind: s.kind ?? 'customer',
      createdAt: s.createdAt,
      stage: s.stage,
      error: s.error,
      customer: s.customer,
      technical: s.technical,
      team: (s.team ?? []).map(({ name, email, role, delivery }) => ({ name, email, role, delivery })),
      repo: s.repo?.url,
      branch: s.branch,
      theme: s.theme ?? null,
      profile: s.profile ?? null,
      fusionOnly: s.summary?.fusionOnly ?? null,
      total: s.summary?.total ?? null,
      exposure: s.outcome?.exposure ?? null,
      reused: Boolean(s.reusedFrom),
      link: `/s/${s.id}?k=${s.accessKey}`,
      cxUrl: s.cx?.projectId && !s.cx.demo ? scanUiUrl(s.cx.projectId, s.cx.scanId) : null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(all);
});

admin.get('/sessions.csv', (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = [['Created', 'Name', 'Email', 'Company', 'Title', 'Technical name', 'Technical email', 'Team', 'Repository', 'Stage', 'Fusion only', 'Total findings', 'Exposure']];
  for (const s of store.listAll().filter((x) => x.kind !== 'sample-refresh')) {
    rows.push([s.createdAt, s.customer?.name, s.customer?.email, s.customer?.company, s.customer?.title, s.technical?.name, s.technical?.email, (s.team ?? []).map((t) => `${t.name} <${t.email}>`).join('; '), s.repo?.url, s.stage, s.summary?.fusionOnly, s.summary?.total, s.outcome?.exposure?.band]);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="checkmate-registrations-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\r\n'));
});

admin.post('/sessions/:id/rescan', (req, res) => {
  const session = store.load(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (!['complete', 'error'].includes(session.stage)) return res.status(409).json({ error: 'A scan is already running for this registration.' });
  store.update(session.id, (s) => { s.stage = 'options'; s.error = undefined; });
  prepareScan(session.id).then(() => startScan(session.id, session.profile ?? {}));
  res.status(202).json({ ok: true });
});

admin.get('/audit', (req, res) => res.json(recentAudit(200)));

// --- updates & integrity -----------------------------------------------------
admin.get('/updates', (req, res) => res.json({ ...updates.status(), integrity: integrity.last }));
admin.post('/updates/check', wrap(async (req, res) => res.json({ ...(await updates.check()), integrity: integrity.last })));
admin.post('/updates/install', (req, res) => {
  try {
    res.json(updates.install(String(req.body?.ref ?? 'latest'), { by: 'admin' }));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
admin.post('/updates/switch', wrap(async (req, res) => {
  try {
    res.json(await updates.switch(String(req.body?.version ?? ''), { by: 'admin' }));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
}));
admin.post('/updates/restart', (req, res) => {
  try {
    res.json(updates.restart('admin'));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
admin.put('/updates/settings', (req, res) => {
  const patch = {};
  if (typeof req.body?.auto === 'boolean') patch.auto = req.body.auto;
  if (req.body?.windowHour === null || (Number.isInteger(req.body?.windowHour) && req.body.windowHour >= 0 && req.body.windowHour <= 23)) patch.windowHour = req.body.windowHour;
  updates.saveSettings(patch);
  audit({ type: 'update', outcome: 'changed', reason: `Auto-update ${patch.auto === undefined ? 'settings changed' : patch.auto ? 'turned on' : 'turned off'}` });
  res.json(updates.status());
});
admin.post('/integrity/check', wrap(async (req, res) => res.json(await integrity.check({ reason: 'admin' }))));

app.use('/api/admin', admin);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
app.get(['/', '/s/:id'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/city-photos/:city/:n', (req, res) => {
  const f = cities.file(req.params.city, req.params.n);
  if (!f) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type(f.type).sendFile(f.path);
});
/** The browser tab's icon: the uploaded one, or Checkmate's own. */
app.get('/app-icon', (req, res) => {
  const icon = config.branding.iconUrl;
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(icon || '');
  if (m) {
    res.set('Content-Type', m[1]);
    return res.send(Buffer.from(m[2], 'base64'));
  }
  if (/^https:/i.test(icon)) return res.redirect(icon);
  res.sendFile(path.join(publicDir, 'favicon.svg'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export function start() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  auth.ensureAdmin();
  samples.list();
  if (!isLive()) {
    const n = profiles.seedDemo();
    if (n) console.log(`Demo mode: ${n} fictional profiles added so the type-ahead can be rehearsed (admin → Profiles).`);
  }
  resumeInFlight();
  assist.resumeAssist();
  if (config.cities.autoFetch) cities.autoFetch();
  // Sample repositories: results ready before the first visitor, refreshed in the background.
  setTimeout(() => prepareSamples().catch(() => {}), 5_000).unref();
  setInterval(() => prepareSamples().catch(() => {}), 30 * 60_000).unref();

  const server = app.listen(config.port, config.host, () => {
    console.log(`${config.branding.appName} v${config.version} running on http://${config.host}:${config.port} (mode: ${isLive() ? 'live' : 'demo'}${config.mode === 'auto' ? ' (automatic)' : ''}${supervised ? ', launcher' : ''}; AI Triage & Remediation: ${assistLive() ? 'live' : 'simulated'})`);
    if (!config.connection) console.log(`Checkmarx One is not connected: ${config.connectionError || 'paste the API key under /admin → Settings, or upload a .env file.'}`);
    if (config.connection) console.log(`Checkmarx One: tenant ${config.connection.tenant} (${config.connection.regionLabel}).`);
    if (!config.smtp.host) console.log(`SMTP not configured: emails are written to ${config.dataDir}/outbox.`);
    process.send?.({ type: 'ready' });
  });

  integrity.start();
  const minutes = Math.max(1, Number(process.env.UPDATE_CHECK_MINUTES) || 5);
  const tick = () => updates.autoUpdate().catch((e) => console.warn(`[update] ${e.message}`));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, minutes * 60_000).unref();

  const stop = (signal) => {
    if (draining) return;
    draining = true;
    console.log(`${signal}: finishing requests and stopping.`);
    server.close(() => {
      console.log('Stopped cleanly.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), (Number(process.env.SHUTDOWN_DRAIN_SECONDS) || 8) * 1000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
