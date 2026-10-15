import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const json = (v, fallback) => {
  if (!v) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`Invalid JSON value: ${v}`);
  }
};

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? 'data');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Values from the environment are the defaults; anything saved from the admin
// panel (data/settings.json) is layered on top by applySettings().
export const config = {
  version: pkg.version,
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  trustProxy: env.TRUST_PROXY ?? 'loopback',
  publicBaseUrl: '',
  eventName: '',
  mode: 'demo',
  sampleReuseHours: 24,
  checkmarx: {},
  fusion: {},
  anthropic: {},
  smtp: {},
};

/** Settings an admin may change, with how each is read from the environment. */
export const SETTINGS = {
  eventName: { env: 'EVENT_NAME', default: 'Checkmate' },
  publicBaseUrl: { env: 'PUBLIC_BASE_URL', default: '' },
  mode: { env: 'CX_MODE', default: 'demo', options: ['demo', 'live'] },
  sampleReuseHours: { env: 'SAMPLE_REUSE_HOURS', default: 24, type: 'number' },

  'checkmarx.baseUrl': { env: 'CX_BASE_URL', default: 'https://ast.checkmarx.net' },
  'checkmarx.iamUrl': { env: 'CX_IAM_URL', default: 'https://iam.checkmarx.net' },
  'checkmarx.tenant': { env: 'CX_TENANT', default: '' },
  'checkmarx.apiKey': { env: 'CX_API_KEY', default: '', secret: true },
  'checkmarx.clientId': { env: 'CX_CLIENT_ID', default: '' },
  'checkmarx.clientSecret': { env: 'CX_CLIENT_SECRET', default: '', secret: true },
  'checkmarx.projectPrefix': { env: 'CX_PROJECT_PREFIX', default: 'checkmate-' },
  'checkmarx.defaultBranch': { env: 'CX_DEFAULT_BRANCH', default: 'main' },
  'checkmarx.engines': { env: 'CX_ENGINES', default: 'sast,sca,kics,apisec', type: 'list' },
  'checkmarx.fusionScanConfig': { env: 'CX_FUSION_SCAN_CONFIG', default: [], type: 'json' },
  'checkmarx.pollIntervalMs': { env: 'CX_POLL_INTERVAL_MS', default: 15000, type: 'number' },
  'checkmarx.scanTimeoutMs': { env: 'CX_SCAN_TIMEOUT_MS', default: 45 * 60 * 1000, type: 'number' },
  'checkmarx.githubToken': { env: 'CX_GITHUB_TOKEN', default: '', secret: true },

  'fusion.markers': { env: 'FUSION_RESULT_MARKERS', default: 'fusion,ai-sast,aisast,ai_sast', type: 'list' },

  'anthropic.apiKey': { env: 'ANTHROPIC_API_KEY', default: '', secret: true },
  'anthropic.model': { env: 'ANTHROPIC_MODEL', default: 'claude-opus-5-5' },
  'anthropic.maxFindingsToExplain': { env: 'EXPLAIN_MAX_FINDINGS', default: 40, type: 'number' },

  'smtp.host': { env: 'SMTP_HOST', default: '' },
  'smtp.port': { env: 'SMTP_PORT', default: 587, type: 'number' },
  'smtp.secure': { env: 'SMTP_SECURE', default: false, type: 'boolean' },
  'smtp.user': { env: 'SMTP_USER', default: '' },
  'smtp.pass': { env: 'SMTP_PASS', default: '', secret: true },
  'smtp.from': { env: 'SMTP_FROM', default: 'Checkmarx Checkmate <no-reply@checkmarx.com>' },
  'smtp.notify': { env: 'TEAM_NOTIFY_EMAIL', default: '' },
};

function coerce(def, raw) {
  if (raw === undefined || raw === null || raw === '') return def.type === 'list' ? list(def.default) : def.default;
  switch (def.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Expected a non-negative number, got ${raw}`);
      return n;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 'on';
    case 'list':
      return Array.isArray(raw) ? raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : list(raw);
    case 'json': {
      const v = json(raw, def.default);
      if (!Array.isArray(v)) throw new Error('Expected a JSON array');
      return v;
    }
    default:
      if (def.options && !def.options.includes(String(raw))) throw new Error(`Expected one of ${def.options.join(', ')}`);
      return String(raw).trim();
  }
}

const setPath = (obj, key, value) => {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
};

const settingsFile = () => path.join(config.dataDir, 'settings.json');

export function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** Rebuilds `config` in place from environment defaults and saved settings. */
export function applySettings(saved = readSaved()) {
  for (const [key, def] of Object.entries(SETTINGS)) {
    const raw = key in saved ? saved[key] : env[def.env];
    setPath(config, key, coerce(def, raw));
  }
  config.checkmarx.baseUrl = config.checkmarx.baseUrl.replace(/\/$/, '');
  config.checkmarx.iamUrl = config.checkmarx.iamUrl.replace(/\/$/, '');
  config.publicBaseUrl = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  config.anthropic.enabled = Boolean(config.anthropic.apiKey || env.ANTHROPIC_AUTH_TOKEN);
  return config;
}

/** Validates and persists a patch of settings from the admin panel. Secrets left blank are kept. */
export function saveSettings(patch) {
  const saved = readSaved();
  const errors = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const def = SETTINGS[key];
    if (!def) continue;
    if (def.secret && (value === '' || value === undefined)) continue;
    if (def.secret && value === null) {
      delete saved[key];
      continue;
    }
    try {
      saved[key] = coerce(def, value);
    } catch (e) {
      errors[key] = e.message;
    }
  }
  for (const key of ['checkmarx.baseUrl', 'checkmarx.iamUrl']) {
    const v = saved[key];
    if (v && !isAllowedCheckmarxUrl(v)) errors[key] = 'Must be an https:// address on checkmarx.net (or set CX_ALLOW_CUSTOM_HOST=true for a private deployment).';
  }
  if (saved.publicBaseUrl && !/^https?:\/\/[^\s/]+/.test(saved.publicBaseUrl)) errors.publicBaseUrl = 'Must be a full http(s) address.';
  if (Object.keys(errors).length) return { errors };
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${settingsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, settingsFile());
  applySettings(saved);
  return { ok: true };
}

/** Current settings for the admin panel: secrets are reported as set / not set, never returned. */
export function publicSettings() {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    const value = key.split('.').reduce((o, p) => o?.[p], config);
    out[key] = def.secret ? { set: Boolean(value) } : value;
  }
  return out;
}

/**
 * Credentials are only ever sent to Checkmarx One over HTTPS, so a mistyped or
 * malicious URL in settings cannot leak the API key elsewhere.
 */
export function isAllowedCheckmarxUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (env.CX_ALLOW_CUSTOM_HOST === 'true') return true;
  return url.hostname === 'checkmarx.net' || url.hostname.endsWith('.checkmarx.net');
}

applySettings();
