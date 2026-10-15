import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import * as store from './store.js';
import { validateRegistration, isEmail } from './validation.js';
import { runScan, resumeInFlight } from './scanRunner.js';
import { send, inviteEmail, resultsLink } from './mailer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_INVITES = 25;

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(here, '..', 'public'), { index: false }));

// --- tiny per-IP rate limiter for registrations / invites -------------------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many requests, please wait a moment.' });
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

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

function publicView(s) {
  const { accessKey, ...rest } = s;
  return { ...rest, mode: config.mode, eventName: config.eventName };
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

// --- routes ------------------------------------------------------------------
app.get('/api/config', (req, res) => res.json({ eventName: config.eventName, mode: config.mode }));

app.post('/api/sessions', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const { value, errors } = validateRegistration(req.body);
  if (errors) return res.status(400).json({ errors });

  const session = store.save({
    id: crypto.randomUUID(),
    accessKey: crypto.randomBytes(24).toString('base64url'),
    createdAt: new Date().toISOString(),
    stage: 'queued',
    timeline: [{ stage: 'queued', at: new Date().toISOString() }],
    customer: value.customer,
    technical: value.technical,
    repo: value.repo,
    branch: value.branch,
    team: value.pocs.map((p) => ({ ...p, delivery: 'not-invited' })),
  });

  // Fire-and-forget: the page polls for progress.
  runScan(session.id, req.app.get('logger') ?? console);

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
});

app.get('/api/sessions/:id', (req, res) => {
  const session = authorised(req, res);
  if (session) res.json(publicView(session));
});

app.post('/api/sessions/:id/invites', rateLimit(30, 60 * 60 * 1000), async (req, res) => {
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

  const known = new Set((session.team ?? []).map((t) => t.email));
  const newOnes = invitees.filter((i) => !known.has(i.email)).length;
  if ((session.team?.length ?? 0) + newOnes > MAX_INVITES) return res.status(400).json({ error: `Up to ${MAX_INVITES} team members can be invited.` });

  const results = await inviteAll(session, invitees);
  const updated = store.update(session.id, (s) => mergeInvites(s, results));
  res.json({ team: updated.team, results });
});

app.get(['/', '/s/:id'], (req, res) => res.sendFile(path.join(here, '..', 'public', 'index.html')));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  resumeInFlight();
  app.listen(config.port, () => {
    console.log(`${config.eventName} scanner listening on ${config.publicBaseUrl} (mode: ${config.mode})`);
    if (!config.anthropic.enabled) console.log('ANTHROPIC_API_KEY not set: using built-in plain-language explanations.');
    if (!config.smtp.host) console.log(`SMTP not configured: emails are written to ${config.dataDir}/outbox.`);
  });
}
