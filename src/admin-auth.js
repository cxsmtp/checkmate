import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// One admin account (the booth team shares it). The password is stored as a
// scrypt hash; sign-ins are random tokens kept (hashed) in the data volume so
// they survive an update or restart.
const COOKIE = 'cm_admin';
const IDLE_MS = 8 * 60 * 60 * 1000;
const authFile = () => path.join(config.dataDir, 'admin.json');
const sessionsFile = () => path.join(config.dataDir, 'admin-sessions.json');
const firstPasswordFile = () => path.join(config.dataDir, 'first-admin-password.txt');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

export function setPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use at least 12 characters.');
  writeJson(authFile(), { ...hashPassword(password), changedAt: new Date().toISOString() });
  writeJson(sessionsFile(), {}); // a new password signs everyone out
  fs.rmSync(firstPasswordFile(), { force: true });
}

const generatePassword = () => crypto.randomBytes(18).toString('base64url');

/** Creates the admin on first start. Returns the generated password to print once, if any. */
export function ensureAdmin(log = console) {
  if (readJson(authFile(), null)?.hash) return null;
  const password = process.env.ADMIN_PASSWORD || generatePassword();
  writeJson(authFile(), { ...hashPassword(password), createdAt: new Date().toISOString() });
  if (!process.env.ADMIN_PASSWORD) {
    fs.writeFileSync(firstPasswordFile(), `${password}\n`, { mode: 0o600 });
    log.log('==================================================================');
    log.log(' Admin panel: /admin');
    log.log(` Password: ${password}`);
    log.log(' (shown once; also in /data/first-admin-password.txt until changed)');
    log.log('==================================================================');
  }
  return password;
}

/** Resets the admin password from the command line (docker exec ... node scripts/reset-admin.mjs). */
export function resetAdmin() {
  const password = generatePassword();
  writeJson(authFile(), { ...hashPassword(password), changedAt: new Date().toISOString() });
  writeJson(sessionsFile(), {});
  return password;
}

export function verifyPassword(password) {
  const auth = readJson(authFile(), null);
  if (!auth?.hash || typeof password !== 'string') return false;
  const { hash } = hashPassword(password, auth.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(auth.hash, 'hex'));
}

function sessions() {
  const now = Date.now();
  const all = readJson(sessionsFile(), {});
  return Object.fromEntries(Object.entries(all).filter(([, s]) => now - s.lastSeen < IDLE_MS));
}

export function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const all = sessions();
  all[sha256(token)] = { createdAt: Date.now(), lastSeen: Date.now(), ip: req.ip };
  writeJson(sessionsFile(), all);
  setCookie(req, res, token, IDLE_MS / 1000);
}

export function destroySession(req, res) {
  const token = readCookie(req);
  if (token) {
    const all = sessions();
    delete all[sha256(token)];
    writeJson(sessionsFile(), all);
  }
  setCookie(req, res, '', 0);
}

function setCookie(req, res, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge)}${secure}`);
}

function readCookie(req) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

export function isAdmin(req) {
  const token = readCookie(req);
  if (!token) return false;
  const all = sessions();
  const s = all[sha256(token)];
  if (!s) return false;
  if (Date.now() - s.lastSeen > 60_000) {
    s.lastSeen = Date.now();
    writeJson(sessionsFile(), all);
  }
  return true;
}

/**
 * Express middleware for admin APIs: a valid sign-in, plus (for changes) a
 * same-origin JSON request, which with SameSite=Strict cookies blocks CSRF.
 */
export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please sign in to the admin panel.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin && new URL(origin).host !== host) return res.status(403).json({ error: 'Cross-site request refused.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Expected a JSON request.' });
  }
  next();
}

export const firstStart = () => fs.existsSync(firstPasswordFile());
