/**
 * Configure Checkmate from a .env file an administrator uploads on the admin panel:
 * the same variables the container reads at start-up, applied at once (ported from
 * CxMissionZero's src/env-import.js).
 *
 * Only the variables listed in ENV_SETTINGS are applied; anything else (PORT,
 * DATA_DIR, ...) only means something at start-up and is reported as such.
 */
import { SETTINGS } from './config.js';

const MAX_BYTES = 64 * 1024;

/** Parse dotenv text: KEY=VALUE lines, # comments, optional `export`, quoted values. */
export function parseEnvText(text) {
  const source = String(text ?? '');
  if (Buffer.byteLength(source) > MAX_BYTES) {
    throw Object.assign(new Error('That file is too large for a .env file (64 KB at most).'), { status: 400 });
  }
  const vars = {};
  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name] = match;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // A quoted value may run over several lines (a PEM, a long key).
      let rest = value.slice(1);
      while (!rest.includes(quote) && i + 1 < lines.length) rest += `\n${lines[++i]}`;
      const end = rest.indexOf(quote);
      value = end >= 0 ? rest.slice(0, end) : rest;
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    vars[name] = value;
  }
  return vars;
}

/** Variable name → setting key, for every setting that has an environment name. */
export const ENV_SETTINGS = Object.fromEntries(Object.entries(SETTINGS).map(([key, def]) => [def.env, key]));
// Aliases CxMissionZero's sample file uses, so one file configures both utilities.
Object.assign(ENV_SETTINGS, { SMTP_PASSWORD: 'smtp.pass', SMTP_FROM_ADDRESS: 'smtp.from', REPORT_SERVER_URL: 'publicBaseUrl', PUBLIC_URL: 'publicBaseUrl' });

/** Secrets: reported by name only, never echoed back. */
export const SECRET_VARIABLES = new Set(Object.entries(SETTINGS).filter(([, d]) => d.secret).map(([, d]) => d.env).concat(['SMTP_PASSWORD']));
export const isSecretVariable = (name) => SECRET_VARIABLES.has(name);

/**
 * Turn parsed variables into a settings patch. A blank value is skipped (an empty
 * line in a template must not wipe a working setting).
 * Returns {patch, applied: [names], ignored: [names]}.
 */
export function settingsFromEnv(vars) {
  const patch = {};
  const applied = [];
  const ignored = [];
  for (const [name, raw] of Object.entries(vars)) {
    const key = ENV_SETTINGS[name];
    if (!key) {
      ignored.push(name);
      continue;
    }
    const value = String(raw ?? '').trim();
    if (!value) continue;
    patch[key] = value;
    applied.push(name);
  }
  // SMTP_USER doubles as the From address when none is given (as at start-up).
  if (patch['smtp.user'] && !patch['smtp.from'] && patch['smtp.user'].includes('@')) patch['smtp.from'] = patch['smtp.user'];
  return { patch, applied, ignored };
}
