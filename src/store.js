import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Small JSON-file store: one file per registration. Good enough for an event
// booth; swap for a database if this outlives the event.
const dir = path.resolve(config.dataDir, 'sessions');
fs.mkdirSync(dir, { recursive: true });

const file = (id) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid session id');
  return path.join(dir, `${id}.json`);
};

export function save(session) {
  session.updatedAt = new Date().toISOString();
  const tmp = `${file(session.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, file(session.id));
  return session;
}

export function load(id) {
  try {
    return JSON.parse(fs.readFileSync(file(id), 'utf8'));
  } catch {
    return null;
  }
}

export function update(id, fn) {
  const session = load(id);
  if (!session) throw new Error(`Session ${id} not found`);
  fn(session);
  return save(session);
}

export function listAll() {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
