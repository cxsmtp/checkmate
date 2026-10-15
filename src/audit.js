import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Append-only record of admin actions, updates and integrity results.
const file = () => path.join(config.dataDir, 'audit.jsonl');

export function audit(event) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(file(), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
    const { size } = fs.statSync(file());
    if (size > 2 * 1024 * 1024) {
      const keep = fs.readFileSync(file(), 'utf8').trim().split('\n').slice(-5000);
      fs.writeFileSync(file(), `${keep.join('\n')}\n`, { mode: 0o600 });
    }
  } catch (e) {
    console.warn(`Audit log write failed: ${e.message}`);
  }
}

export function recentAudit(limit = 100) {
  try {
    return fs
      .readFileSync(file(), 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}
