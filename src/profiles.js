import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, isLive } from './config.js';
import { isEmail } from './validation.js';

/**
 * The directory of people expected at the event (and everyone who registers):
 * name, company, title, email, their team, their city. Visitors type two letters of
 * their name or company and pick themselves; their team's addresses come with them.
 * Kept in <data>/profiles.json; imported from CSV or added by hand in the admin panel.
 */
const file = () => path.join(config.dataDir, 'profiles.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(list) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function normalise(input = {}) {
  const team = (Array.isArray(input.team) ? input.team : [])
    .map((t) => ({ name: clean(t?.name), email: clean(t?.email, 254).toLowerCase(), role: clean(t?.role, 60) }))
    .filter((t) => isEmail(t.email))
    .slice(0, 10);
  return {
    name: clean(input.name),
    email: clean(input.email, 254).toLowerCase(),
    company: clean(input.company),
    title: clean(input.title),
    phone: clean(input.phone, 40),
    city: clean(input.city, 20),
    technical: input.technical ? { name: clean(input.technical.name), email: clean(input.technical.email, 254).toLowerCase() } : null,
    team,
    repos: (Array.isArray(input.repos) ? input.repos : []).map((r) => clean(r, 300)).filter(Boolean).slice(0, 10),
    notes: clean(input.notes, 500),
    tags: (Array.isArray(input.tags) ? input.tags : clean(input.tags, 200).split(',')).map((t) => clean(t, 30)).filter(Boolean).slice(0, 10),
  };
}

export function validate(input) {
  const p = normalise(input);
  const errors = {};
  if (!p.name) errors.name = 'Name is required.';
  if (!isEmail(p.email)) errors.email = 'A valid email is required.';
  if (p.technical && p.technical.email && !isEmail(p.technical.email)) errors.technicalEmail = 'Technical contact email is not valid.';
  return Object.keys(errors).length ? { errors } : { value: p };
}

export const list = () => readAll();
export const get = (id) => readAll().find((p) => p.id === id) ?? null;
export const byEmail = (email) => readAll().find((p) => p.email === String(email ?? '').toLowerCase()) ?? null;

export function create(input, source = 'admin') {
  const { value, errors } = validate(input);
  if (errors) return { errors };
  const all = readAll();
  if (all.some((p) => p.email === value.email)) return { errors: { email: 'A profile with this email already exists.' } };
  const profile = { id: crypto.randomUUID(), ...value, source, createdAt: new Date().toISOString(), visits: 0 };
  writeAll([...all, profile]);
  return { profile };
}

export function update(id, input) {
  const all = readAll();
  const existing = all.find((p) => p.id === id);
  if (!existing) return { notFound: true };
  const { value, errors } = validate({ ...existing, ...input, technical: input.technical ?? existing.technical, team: input.team ?? existing.team });
  if (errors) return { errors };
  if (all.some((p) => p.id !== id && p.email === value.email)) return { errors: { email: 'Another profile already has this email.' } };
  Object.assign(existing, value, { updatedAt: new Date().toISOString() });
  writeAll(all);
  return { profile: existing };
}

export function remove(id) {
  const all = readAll();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

/**
 * A registration keeps the directory current: the visitor and their team are
 * remembered for next time (new people added, known ones updated, never replaced wholesale).
 */
export function rememberRegistration({ customer, technical, pocs, repo, theme }) {
  const all = readAll();
  const now = new Date().toISOString();
  let me = all.find((p) => p.email === customer.email);
  if (!me) {
    me = { id: crypto.randomUUID(), ...normalise({ ...customer, technical, team: pocs, city: theme }), source: 'registration', createdAt: now, visits: 0 };
    all.push(me);
  } else {
    if (customer.company) me.company = customer.company;
    if (technical?.email) me.technical = { name: technical.name, email: technical.email };
    for (const poc of pocs) if (!me.team.some((t) => t.email === poc.email)) me.team.push({ name: poc.name, email: poc.email, role: poc.role });
    if (theme) me.city = theme;
  }
  me.visits = (me.visits ?? 0) + 1;
  me.lastSeenAt = now;
  if (repo?.url && !me.repos.includes(repo.url)) me.repos = [repo.url, ...me.repos].slice(0, 10);
  // Colleagues become profiles too, so they can pick themselves next time.
  for (const poc of pocs) {
    if (!all.some((p) => p.email === poc.email)) {
      all.push({ id: crypto.randomUUID(), ...normalise({ name: poc.name, email: poc.email, company: customer.company, title: poc.role, team: [{ name: customer.name, email: customer.email, role: 'Colleague' }], city: theme }), source: 'team', createdAt: now, visits: 0 });
    }
  }
  writeAll(all);
  return me;
}

/** What a visitor's browser may see while typing: enough to recognise yourself, no addresses. */
const publicCard = (p) => ({ id: p.id, name: p.name, company: p.company, title: p.title, initials: initials(p.name), city: p.city, known: p.visits > 0 });

export function search(q, limit = 8) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (needle.length < Math.max(1, config.profiles.minChars)) return [];
  const words = needle.split(/\s+/);
  // The fictional demo profiles never show up at a live event.
  const scored = readAll()
    .filter((p) => !(p.source === 'demo' && isLive()))
    .map((p) => {
      const name = p.name.toLowerCase();
      const company = p.company.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (name.startsWith(w)) score += 6;
        else if (name.split(/\s+/).some((part) => part.startsWith(w))) score += 5;
        else if (company.startsWith(w)) score += 4;
        else if (company.includes(w)) score += 2;
        else if (p.email.startsWith(w)) score += 3;
        else return null;
      }
      return { p, score: score + (p.visits ? 0.5 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit);
  return scored.map(({ p }) => publicCard(p));
}

/** The profile a visitor picked: what the form needs, with the team's addresses. */
export function forRegistration(id) {
  const p = get(id);
  if (!p) return null;
  const { name, email, company, title, technical, team, repos, city } = p;
  return { id, name, email, company, title, technical, team, repos, city };
}

// ---------------------------------------------------------------------------
// CSV import: name,email,company,title,technical_name,technical_email,team (a;b),city,tags
// ---------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  name: ['name', 'full name', 'fullname', 'attendee'],
  email: ['email', 'e-mail', 'mail', 'work email'],
  company: ['company', 'organisation', 'organization', 'account', 'customer'],
  title: ['title', 'job title', 'role', 'position', 'designation'],
  technical_name: ['technical_name', 'technical contact', 'tech name', 'technical'],
  technical_email: ['technical_email', 'technical contact email', 'tech email'],
  team: ['team', 'team emails', 'colleagues', 'invitees', 'poc', 'contacts'],
  city: ['city', 'location', 'theme'],
  tags: ['tags', 'segment', 'track'],
  phone: ['phone', 'mobile'],
  notes: ['notes', 'comment', 'comments'],
};

export function importCsv(text, { source = 'csv' } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, updated: 0, skipped: [], error: 'The file needs a header row and at least one person.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (field) => header.findIndex((h) => HEADER_ALIASES[field].includes(h));
  const idx = Object.fromEntries(Object.keys(HEADER_ALIASES).map((f) => [f, col(f)]));
  if (idx.name < 0 || idx.email < 0) return { added: 0, updated: 0, skipped: [], error: 'The header must include at least "name" and "email".' };
  const cellOf = (row, f) => (idx[f] >= 0 ? row[idx[f]] ?? '' : '');
  const all = readAll();
  let added = 0;
  let updated = 0;
  const skipped = [];
  for (const [n, row] of rows.slice(1).entries()) {
    const teamCells = cellOf(row, 'team').split(/[;|\n]+/).map((s) => s.trim()).filter(Boolean);
    const team = teamCells.map((entry) => {
      const m = entry.match(/^(.*?)\s*<([^>]+)>$/) || entry.match(/^(.*?)\s*\(([^)]+)\)$/);
      return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: entry };
    });
    const input = {
      name: cellOf(row, 'name'),
      email: cellOf(row, 'email'),
      company: cellOf(row, 'company'),
      title: cellOf(row, 'title'),
      phone: cellOf(row, 'phone'),
      city: cellOf(row, 'city').toLowerCase().replace(/\s+/g, '-'),
      notes: cellOf(row, 'notes'),
      tags: cellOf(row, 'tags'),
      technical: cellOf(row, 'technical_email') ? { name: cellOf(row, 'technical_name'), email: cellOf(row, 'technical_email') } : null,
      team,
    };
    const { value, errors } = validate(input);
    if (errors) {
      skipped.push({ line: n + 2, reason: Object.values(errors)[0] });
      continue;
    }
    const existing = all.find((p) => p.email === value.email);
    if (existing) {
      Object.assign(existing, { ...value, team: mergeTeam(existing.team, value.team), updatedAt: new Date().toISOString() });
      updated += 1;
    } else {
      all.push({ id: crypto.randomUUID(), ...value, source, createdAt: new Date().toISOString(), visits: 0 });
      added += 1;
    }
  }
  writeAll(all);
  return { added, updated, skipped, total: all.length };
}

function mergeTeam(a = [], b = []) {
  const out = [...a];
  for (const t of b) if (!out.some((x) => x.email === t.email)) out.push(t);
  return out.slice(0, 10);
}

export function exportCsv() {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = [['name', 'email', 'company', 'title', 'technical_name', 'technical_email', 'team', 'city', 'tags', 'visits', 'last_seen']];
  for (const p of readAll()) rows.push([p.name, p.email, p.company, p.title, p.technical?.name, p.technical?.email, p.team.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join('; '), p.city, p.tags.join(', '), p.visits, p.lastSeenAt]);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/**
 * Demo mode only: a handful of clearly fictional profiles so the booth flow can be
 * rehearsed before the real invitee list is imported. Never written in live mode,
 * and never when a directory already exists.
 */
const DEMO_PROFILES = [
  { name: 'Ada Lovelace', email: 'ada@acme.example', company: 'Acme Retail', title: 'CISO', city: 'new-york', technical: { name: 'Charles Babbage', email: 'charles@acme.example' }, team: [{ name: 'Ops One', email: 'ops1@acme.example', role: 'Operations' }, { name: 'Ops Two', email: 'ops2@acme.example', role: 'Operations' }], repos: ['https://github.com/acme/webshop'], tags: ['demo'] },
  { name: 'Grace Hopper', email: 'grace@harbor.example', company: 'Harbor Logistics', title: 'VP Engineering', city: 'boston', technical: { name: 'Jean Bartik', email: 'jean@harbor.example' }, team: [{ name: 'Platform on-call', email: 'platform@harbor.example', role: 'Operations' }, { name: 'SecOps', email: 'secops@harbor.example', role: 'Operations' }], repos: [], tags: ['demo'] },
  { name: 'Hedy Lamarr', email: 'hedy@spectrum.example', company: 'Spectrum Telecom', title: 'Chief Technology Officer', city: 'dubai', technical: null, team: [{ name: 'NOC', email: 'noc@spectrum.example', role: 'Operations' }, { name: 'AppSec', email: 'appsec@spectrum.example', role: 'Operations' }], repos: [], tags: ['demo'] },
  { name: 'Katherine Johnson', email: 'katherine@orbital.example', company: 'Orbital Bank', title: 'Head of Application Security', city: 'singapore', technical: { name: 'Dorothy Vaughan', email: 'dorothy@orbital.example' }, team: [{ name: 'Fraud Ops', email: 'fraud-ops@orbital.example', role: 'Operations' }, { name: 'SRE', email: 'sre@orbital.example', role: 'Operations' }], repos: [], tags: ['demo'] },
  { name: 'Mary Jackson', email: 'mary@southern.example', company: 'Southern Energy', title: 'CIO', city: 'melbourne', technical: null, team: [{ name: 'Grid Ops', email: 'grid-ops@southern.example', role: 'Operations' }, { name: 'IT Security', email: 'itsec@southern.example', role: 'Operations' }], repos: [], tags: ['demo'] },
];

export function seedDemo() {
  if (fs.existsSync(file())) return 0;
  const now = new Date().toISOString();
  writeAll(DEMO_PROFILES.map((p) => ({ id: crypto.randomUUID(), ...normalise(p), source: 'demo', createdAt: now, visits: 0 })));
  return DEMO_PROFILES.length;
}
