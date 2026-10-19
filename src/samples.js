import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, isLive } from './config.js';
import { parseGithubUrl } from './validation.js';

// Pre-selected repositories visitors can pick when they have no repo of their
// own. Managed from the admin panel; stored in the data volume.
const file = () => path.join(config.dataDir, 'samples.json');

const DEFAULTS = [
  { name: 'OWASP Juice Shop', url: 'https://github.com/cxsmtp/juice-shop', branch: 'master', language: 'TypeScript / Node.js', description: 'Modern web shop full of real-world flaws: broken access control, injection, insecure auth.' },
  { name: 'OWASP WebGoat', url: 'https://github.com/cxsmtp/WebGoat', branch: 'main', language: 'Java / Spring', description: 'Deliberately insecure Java application used for security training.' },
  { name: 'OWASP NodeGoat', url: 'https://github.com/cxsmtp/NodeGoat', branch: 'master', language: 'JavaScript / Node.js', description: 'Node.js app showing how the OWASP Top 10 applies to JavaScript.' },
];

function write(list) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

export function list() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    const seeded = DEFAULTS.map((s, i) => ({ id: crypto.randomUUID(), order: i, enabled: true, ...s }));
    write(seeded);
    return seeded;
  }
}

export const get = (id) => list().find((s) => s.id === id) ?? null;

/** What visitors see on the registration page. */
export const publicList = () =>
  list()
    .filter((s) => s.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ id, name, url, branch, language, description, latest }) => ({ id, name, url, branch, language, description, hasResults: Boolean(latest?.completedAt) }));

export function validate(input = {}) {
  const errors = {};
  const repo = parseGithubUrl(input.url);
  const name = String(input.name ?? '').trim().slice(0, 80);
  const branch = String(input.branch ?? '').trim().slice(0, 200);
  if (!name) errors.name = 'Name is required.';
  if (!repo) errors.url = 'Use a GitHub repository URL like https://github.com/org/repo.';
  if (branch && !/^[\w./-]+$/.test(branch)) errors.branch = 'Branch name contains invalid characters.';
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      name,
      url: repo.url,
      branch,
      language: String(input.language ?? '').trim().slice(0, 60),
      description: String(input.description ?? '').trim().slice(0, 240),
      enabled: input.enabled !== false,
      order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
    },
  };
}

export function create(input) {
  const { value, errors } = validate(input);
  if (errors) return { errors };
  const all = list();
  const sample = { id: crypto.randomUUID(), ...value, order: value.order || all.length };
  write([...all, sample]);
  return { sample };
}

export function update(id, input) {
  const all = list();
  const existing = all.find((s) => s.id === id);
  if (!existing) return { notFound: true };
  const { value, errors } = validate({ ...existing, ...input });
  if (errors) return { errors };
  // A different repository or branch means earlier results no longer apply.
  const latest = value.url === existing.url && value.branch === existing.branch ? existing.latest : undefined;
  Object.assign(existing, value, { latest });
  write(all);
  return { sample: existing };
}

export function remove(id) {
  const all = list();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  write(next);
  return true;
}

/** Remembers the newest completed scan of a sample, so the next visitor can reuse it. */
export function recordScan(id, sessionId, completedAt, live = false) {
  const all = list();
  const sample = all.find((s) => s.id === id);
  if (!sample) return;
  sample.latest = { sessionId, completedAt, live: Boolean(live) };
  write(all);
}

/** A completed scan of this sample that is recent enough to reuse, or null. */
export function reusable(sample) {
  if (!sample?.latest?.completedAt || !config.sampleReuseHours) return null;
  // A demo result is never reused for a live visitor, nor a live one in the demo.
  if (Boolean(sample.latest.live) !== isLive()) return null;
  const age = Date.now() - new Date(sample.latest.completedAt).getTime();
  return age <= config.sampleReuseHours * 3_600_000 ? sample.latest : null;
}
