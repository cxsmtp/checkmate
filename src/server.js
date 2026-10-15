import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, publicSettings, saveSettings } from './config.js';
import * as store from './store.js';
import * as samples from './samples.js';
import * as auth from './admin-auth.js';
import { audit, recentAudit } from './audit.js';
import { validateRegistration, isEmail } from './validation.js';
import { runScan, resumeInFlight, reuseSampleScan } from './scanRunner.js';
import { send, inviteEmail, resultsLink } from './mailer.js';
import { testConnection, scanUiUrl } from './checkmarx.js';
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

export const integrity = new IntegrityService({
  appDir,
  dataDir: config.dataDir,
  token: githubToken,
  record: (e) => audit({ type: 'integrity', ...e }),
});

export const updates = new UpdateService({
  store: new VersionStore({
    dataDir: config.dataDir,
    builtInDir: process.env.CHECKMATE_BUILTIN_DIR || appDir,
    builtInVersion: process.env.CHECKMATE_BUILTIN_VERSION || config.version,
  }),
  runningVersion: config.version,
  image: process.env.UPDATE_IMAGE || DEFAULT_IMAGE,
  token: process.env.UPDATE_REGISTRY_TOKEN || githubToken,
  supervised,
  integrity,
  record: (e) => audit({ type: 'update', ...e }),
  beforeSwitch: async () => backup('before-update'),
  switchTo: (message) => process.send?.(message),
});

/** A copy of the small state files (settings, samples, admin) before a version switch. */
function backup(reason) {
  const dir = path.join(config.dataDir, 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of ['settings.json', 'samples.json', 'admin.json']) {
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
app.use(express.json({ limit: '100kb' }));

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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(publicDir, { index: false }));

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
  const ok =
    session &&
    key.length === session.accessKey.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(session.accessKey));
  if (!ok) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
}

function publicView(s, { admin = false } = {}) {
  const { accessKey, cx, ...rest } = s;
  // Tenant identifiers and links are for the booth team, not visitors.
  const scan = cx ? { status: cx.status, engines: cx.engines, branch: cx.branch, demo: cx.demo } : undefined;
  return {
    ...rest,
    cx: admin ? { ...cx, url: cx?.projectId && !cx.demo ? scanUiUrl(cx.projectId, cx.scanId) : undefined } : scan,
    mode: config.mode,
    eventName: config.eventName,
  };
}

async function inviteAll(session, invitees) {
  const inviter = session.technical;
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
    stage: 'queued',
    timeline: [{ stage: 'queued', at: new Date().toISOString() }],
    team: [],
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, version: config.version, integrity: integrity.last?.state ?? 'pending' }));

app.get('/api/config', (req, res) =>
  res.json({ eventName: config.eventName, mode: config.mode, version: config.version, samples: samples.publicList() }),
);

app.post('/api/sessions', rateLimit(10, 60 * 60 * 1000, 'register'), wrap(async (req, res) => {
  const { value, errors } = validateRegistration(req.body, { getSample: samples.get });
  if (errors) return res.status(400).json({ errors });

  const session = newSession({
    kind: value.sampleId ? 'sample' : 'customer',
    sampleId: value.sampleId,
    customer: value.customer,
    technical: value.technical,
    repo: value.repo,
    branch: value.branch,
    team: value.pocs.map((p) => ({ ...p, delivery: 'not-invited' })),
  });
  audit({ type: 'registration', outcome: 'info', reason: `${value.customer.email} registered ${value.repo.url}${value.sampleId ? ' (sample)' : ''}` });

  // A sample with a recent scan is shown at once; anything else is scanned now.
  const reusable = value.sampleId && samples.reusable(samples.get(value.sampleId));
  if (!(reusable && reuseSampleScan(session.id, reusable.sessionId))) runScan(session.id);

  if (req.body.inviteNow !== false) {
    inviteAll(session, value.pocs).then((results) => store.update(session.id, (s) => mergeInvites(s, results)));
  }
  if (config.smtp.notify) {
    send({
      to: config.smtp.notify,
      subject: `[${config.eventName}] New registration: ${value.customer.name} — ${value.repo.owner}/${value.repo.repo}`,
      text: `${value.customer.name} <${value.customer.email}> ${value.customer.company ? `(${value.customer.company})` : ''}\nTechnical: ${value.technical.name} <${value.technical.email}>\nOps contacts: ${value.pocs.map((p) => `${p.name} <${p.email}>`).join(', ')}\nRepo: ${value.repo.url}\nResults: ${resultsLink(session)}`,
    }).catch(() => {});
  }

  res.status(201).json({ id: session.id, accessKey: session.accessKey, url: `/s/${session.id}?k=${session.accessKey}` });
}));

app.get('/api/sessions/:id', (req, res) => {
  const session = authorised(req, res);
  if (session) res.json(publicView(session, { admin: auth.isAdmin(req) }));
});

app.post('/api/sessions/:id/invites', rateLimit(30, 60 * 60 * 1000, 'invite'), wrap(async (req, res) => {
  const session = authorised(req, res);
  if (!session) return;
  const raw = Array.isArray(req.body.invitees) ? req.body.invitees : [];
  const invitees = raw
    .map((i) => ({
      name: String(i?.name ?? '').trim().slice(0, 120),
      email: String(i?.email ?? '').trim().toLowerCase().slice(0, 254),
      role: String(i?.role ?? '').trim().slice(0, 60),
    }))
    .filter((i) => i.email);
  const bad = invitees.filter((i) => !isEmail(i.email));
  if (!invitees.length || bad.length) return res.status(400).json({ error: `Please enter valid email addresses${bad.length ? `: ${bad.map((b) => b.email).join(', ')}` : ''}.` });
  if (!session.technical) return res.status(400).json({ error: 'Invitations are not available for this scan.' });

  const known = new Set((session.team ?? []).map((t) => t.email));
  const newOnes = invitees.filter((i) => !known.has(i.email)).length;
  if ((session.team?.length ?? 0) + newOnes > MAX_INVITES) return res.status(400).json({ error: `Up to ${MAX_INVITES} team members can be invited.` });

  const results = await inviteAll(session, invitees);
  const updated = store.update(session.id, (s) => mergeInvites(s, results));
  res.json({ team: updated.team, results });
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

admin.get('/settings', (req, res) => res.json(publicSettings()));
admin.put('/settings', (req, res) => {
  const result = saveSettings(req.body);
  if (result.errors) return res.status(400).json(result);
  audit({ type: 'settings', outcome: 'changed', reason: `Settings changed: ${Object.keys(req.body ?? {}).join(', ')}` });
  res.json(publicSettings());
});
admin.post('/settings/test', wrap(async (req, res) => {
  try {
    res.json(await testConnection());
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}));

admin.get('/samples', (req, res) => res.json(samples.list()));
admin.post('/samples', (req, res) => {
  const { sample, errors } = samples.create(req.body);
  if (errors) return res.status(400).json({ errors });
  audit({ type: 'samples', outcome: 'changed', reason: `Sample added: ${sample.url}` });
  res.status(201).json(sample);
});
admin.put('/samples/:id', (req, res) => {
  const { sample, errors, notFound } = samples.update(req.params.id, req.body);
  if (notFound) return res.status(404).json({ error: 'Not found' });
  if (errors) return res.status(400).json({ errors });
  audit({ type: 'samples', outcome: 'changed', reason: `Sample updated: ${sample.url}` });
  res.json(sample);
});
admin.delete('/samples/:id', (req, res) => {
  if (!samples.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
  audit({ type: 'samples', outcome: 'changed', reason: `Sample removed: ${req.params.id}` });
  res.json({ ok: true });
});
admin.post('/samples/:id/scan', (req, res) => {
  const sample = samples.get(req.params.id);
  if (!sample) return res.status(404).json({ error: 'Not found' });
  const repo = (({ url }) => {
    const [, owner, name] = new URL(url).pathname.split('/');
    return { owner, repo: name, url };
  })(sample);
  const session = newSession({ kind: 'sample-refresh', sampleId: sample.id, repo, branch: sample.branch, customer: { name: 'Booth team', email: '', company: sample.name } });
  runScan(session.id);
  audit({ type: 'samples', outcome: 'info', reason: `Scan started for sample ${sample.url}` });
  res.status(202).json({ id: session.id, url: `/s/${session.id}?k=${session.accessKey}` });
});

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
      fusionOnly: s.summary?.fusionOnly ?? null,
      total: s.summary?.total ?? null,
      reused: Boolean(s.reusedFrom),
      link: `/s/${s.id}?k=${s.accessKey}`,
      cxUrl: s.cx?.projectId && !s.cx.demo ? scanUiUrl(s.cx.projectId, s.cx.scanId) : null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(all);
});

admin.get('/sessions.csv', (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = [['Created', 'Name', 'Email', 'Company', 'Technical name', 'Technical email', 'Team', 'Repository', 'Stage', 'Fusion only', 'Total findings']];
  for (const s of store.listAll().filter((x) => x.kind !== 'sample-refresh')) {
    rows.push([s.createdAt, s.customer?.name, s.customer?.email, s.customer?.company, s.technical?.name, s.technical?.email, (s.team ?? []).map((t) => `${t.name} <${t.email}>`).join('; '), s.repo?.url, s.stage, s.summary?.fusionOnly, s.summary?.total]);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="checkmate-registrations-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\r\n'));
});

admin.get('/audit', (req, res) => res.json(recentAudit(200)));

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

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export function start() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  auth.ensureAdmin();
  samples.list(); // seeds the defaults on first start
  resumeInFlight();

  const server = app.listen(config.port, config.host, () => {
    console.log(`Checkmate v${config.version} running on http://${config.host}:${config.port} (mode: ${config.mode}${supervised ? ', launcher' : ''})`);
    if (!config.anthropic.enabled) console.log('No Anthropic API key: using built-in plain-language explanations.');
    if (!config.smtp.host) console.log(`SMTP not configured: emails are written to ${config.dataDir}/outbox.`);
    process.send?.({ type: 'ready' });
  });

  integrity.start();
  const minutes = Math.max(1, Number(process.env.UPDATE_CHECK_MINUTES) || 5);
  const tick = () => updates.autoUpdate().catch((e) => console.warn(`[update] ${e.message}`));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, minutes * 60_000).unref();

  // Stop cleanly (update, restart, docker stop): finish requests, then exit.
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
