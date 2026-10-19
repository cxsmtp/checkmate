import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { CITY_THEMES } from './validation.js';
import { deriveConnection, ConnectionError } from './cxone/endpoints.js';

/**
 * Settings: environment variables are the defaults; what an administrator saves
 * (the admin panel, or an uploaded .env file) is layered on top and kept in
 * <data>/settings.json with owner-only permissions. applySettings() rebuilds the
 * live `config` object, which every module reads at call time.
 */

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? 'data');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  version: pkg.version,
  port: Number(env.PORT ?? 3333),
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  trustProxy: env.TRUST_PROXY ?? 'loopback',
  publicBaseUrl: '',
  mode: 'demo',
  sampleReuseHours: 24,
  defaultCity: 'auto',
  askLocation: true,
  event: {},
  branding: {},
  checkmarx: {},
  scan: {},
  fusion: {},
  profiles: {},
  assist: {},
  cities: {},
  impact: {},
  smtp: {},
  /** The connection worked out from the API key (tenant, region, URLs); null until a key is set. */
  connection: null,
  connectionError: '',
};

export const ENGINES = ['sast', 'sca', 'kics', 'apisec', 'containers', 'microengines'];
export const LOOKS = ['command-center', 'classic'];
export const ACCENTS = ['ink', 'lagoon', 'sage', 'plum', 'ochre', 'city'];

/** Every setting an administrator may change, with its environment default. */
export const SETTINGS = {
  // Event
  'event.name': { env: 'EVENT_NAME', default: 'Checkmate' },
  'event.tagline': { env: 'EVENT_TAGLINE', default: 'See what your scanner is missing.' },
  'event.venue': { env: 'EVENT_VENUE', default: '' },
  publicBaseUrl: { env: 'PUBLIC_BASE_URL', default: '' },
  // auto: real Checkmarx One scans as soon as the API key connects, the demo otherwise.
  mode: { env: 'CX_MODE', default: 'auto', options: ['auto', 'live', 'demo'] },
  sampleReuseHours: { env: 'SAMPLE_REUSE_HOURS', default: 24, type: 'number' },
  defaultCity: { env: 'DEFAULT_CITY', default: 'auto', options: ['auto', ...CITY_THEMES] },
  askLocation: { env: 'ASK_LOCATION', default: true, type: 'boolean' },

  // Branding (as in CxMissionZero: the organisation's name, logo, accent and look)
  'branding.appName': { env: 'BRAND_APP_NAME', default: 'Checkmate' },
  'branding.companyName': { env: 'BRAND_COMPANY', default: 'Checkmarx' },
  'branding.logoUrl': { env: 'BRAND_LOGO_URL', default: '', type: 'image' },
  'branding.iconUrl': { env: 'BRAND_ICON_URL', default: '', type: 'image' },
  'branding.logoHeight': { env: 'BRAND_LOGO_HEIGHT', default: 36, type: 'number' },
  'branding.accentColor': { env: 'BRAND_ACCENT', default: '', type: 'color' },
  'branding.look': { env: 'BRAND_LOOK', default: 'command-center', options: LOOKS },
  'branding.theme': { env: 'BRAND_THEME', default: 'auto', options: ['auto', 'light', 'dark'] },
  'branding.accent': { env: 'BRAND_ACCENT_NAME', default: 'ink', options: ACCENTS },
  'branding.callToAction': { env: 'BRAND_CTA', default: 'Bring your repository. In minutes, see what rule-based scanning never showed you.' },
  'branding.footer': { env: 'BRAND_FOOTER', default: '' },

  // Checkmarx One: the key is enough; the tenant, IAM and API URLs are derived from it
  'checkmarx.apiKey': { env: 'CX_API_KEY', default: '', secret: true },
  'checkmarx.baseUrl': { env: 'CX_BASE_URL', default: '' },
  'checkmarx.iamUrl': { env: 'CX_IAM_URL', default: '' },
  'checkmarx.tenant': { env: 'CX_TENANT', default: '' },
  'checkmarx.projectPrefix': { env: 'CX_PROJECT_PREFIX', default: 'checkmate-' },
  'checkmarx.defaultBranch': { env: 'CX_DEFAULT_BRANCH', default: 'main' },
  'checkmarx.pollIntervalMs': { env: 'CX_POLL_INTERVAL_MS', default: 15000, type: 'number' },
  'checkmarx.scanTimeoutMs': { env: 'CX_SCAN_TIMEOUT_MS', default: 45 * 60 * 1000, type: 'number' },
  'checkmarx.githubToken': { env: 'CX_GITHUB_TOKEN', default: '', secret: true },
  'checkmarx.allowCustomHost': { env: 'CX_ALLOW_CUSTOM_HOST', default: false, type: 'boolean' },

  // What a Checkmate scan runs. Keys verified against the tenant's own configuration
  // (scan.config.ai.fusionEnabled, scan.config.ai.llmModel, scan.config.sast.extendedAnalysis).
  'scan.engines': { env: 'CX_ENGINES', default: 'sast,sca,kics,apisec', type: 'list' },
  'scan.fusion': { env: 'CX_FUSION', default: true, type: 'boolean' },
  'scan.llmModel': { env: 'CX_FUSION_LLM_MODEL', default: '' },
  'scan.extendedAnalysis': { env: 'CX_SAST_EXTENDED_ANALYSIS', default: true, type: 'boolean' },
  'scan.presetName': { env: 'CX_SAST_PRESET', default: '' },
  'scan.letVisitorChoose': { env: 'SCAN_LET_VISITOR_CHOOSE', default: true, type: 'boolean' },
  // Extra scan config entries (JSON array of {type, value}) merged last, for anything not above.
  'scan.extraConfig': { env: 'CX_FUSION_SCAN_CONFIG', default: [], type: 'json' },

  // How a Fusion result is recognised in /api/results (see src/fusion.js)
  'fusion.markers': { env: 'FUSION_RESULT_MARKERS', default: 'fusion,ai-sast,aisast,ai_sast', type: 'list' },
  'fusion.queryIdZero': { env: 'FUSION_QUERY_ID_ZERO', default: true, type: 'boolean' },
  // Application-level Fusion (Dispatcher and Results services). Their base paths are probed
  // when blank; set them when the tenant's are known. Correlation can be turned off.
  'fusion.correlate': { env: 'FUSION_CORRELATE', default: true, type: 'boolean' },
  'fusion.dispatcherPath': { env: 'FUSION_DISPATCHER_PATH', default: '' },
  'fusion.resultsPath': { env: 'FUSION_RESULTS_PATH', default: '' },
  'fusion.timeoutMs': { env: 'FUSION_TIMEOUT_MS', default: 20 * 60 * 1000, type: 'number' },

  // Closing the loop: Checkmarx One AI Triage and AI Remediation from the outcome page
  'assist.enabled': { env: 'ASSIST_ENABLED', default: true, type: 'boolean' },
  // simulated: the same stages on the real findings, no AI credits spent; live: Checkmarx One AI Triage and Remediation.
  'assist.mode': { env: 'ASSIST_MODE', default: 'simulated', options: ['simulated', 'live'] },
  'assist.pollIntervalMs': { env: 'ASSIST_POLL_INTERVAL_MS', default: 8000, type: 'number' },
  'assist.timeoutMs': { env: 'ASSIST_TIMEOUT_MS', default: 30 * 60 * 1000, type: 'number' },

  // Business impact on the outcome page (the arithmetic of CxMissionZero's Impact page and Cx Credits Calculator)
  'impact.enabled': { env: 'IMPACT_ENABLED', default: true, type: 'boolean' },
  'impact.triageMinutes': { env: 'IMPACT_TRIAGE_MINUTES', default: 20, type: 'number' },
  'impact.fixMinutes': { env: 'IMPACT_FIX_MINUTES', default: 120, type: 'number' },
  'impact.fpPercent': { env: 'IMPACT_FP_PERCENT', default: 30, type: 'number' },
  'impact.releaseMultiplier': { env: 'IMPACT_RELEASE_MULTIPLIER', default: 6, type: 'number' },
  // 0 / empty: the region's fully loaded hourly rate and currency (the visitor's city)
  'impact.hourlyRate': { env: 'IMPACT_HOURLY_RATE', default: 0, type: 'number' },
  'impact.currency': { env: 'IMPACT_CURRENCY', default: '', type: 'currency' },
  // 0: credits are counted, not priced
  'impact.creditPrice': { env: 'IMPACT_CREDIT_PRICE', default: 0, type: 'number' },
  'impact.fusionCreditsPer10k': { env: 'IMPACT_FUSION_CREDITS_PER_10K', default: 0, type: 'number' },

  // Real city photography (Wikimedia Commons, Creative Commons / public domain) fetched at start when missing
  'cities.autoFetch': { env: 'CITY_PHOTOS_AUTO', default: true, type: 'boolean' },

  // Profiles: the invitee directory visitors pick themselves from
  'profiles.lookup': { env: 'PROFILES_LOOKUP', default: true, type: 'boolean' },
  'profiles.minChars': { env: 'PROFILES_MIN_CHARS', default: 2, type: 'number' },

  // Email
  'smtp.host': { env: 'SMTP_HOST', default: '' },
  'smtp.port': { env: 'SMTP_PORT', default: 587, type: 'number' },
  'smtp.secure': { env: 'SMTP_SECURE', default: false, type: 'boolean' },
  'smtp.requireAuth': { env: 'SMTP_REQUIRE_AUTH', default: true, type: 'boolean' },
  'smtp.rejectUnauthorized': { env: 'SMTP_REJECT_UNAUTHORIZED', default: true, type: 'boolean' },
  'smtp.user': { env: 'SMTP_USER', default: '' },
  'smtp.pass': { env: 'SMTP_PASS', default: '', secret: true },
  'smtp.from': { env: 'SMTP_FROM', default: '' },
  'smtp.fromName': { env: 'SMTP_FROM_NAME', default: 'Checkmate' },
  'smtp.notify': { env: 'TEAM_NOTIFY_EMAIL', default: '' },
};

/** A logo or icon: an https address, or an uploaded image as a data URL (up to ~300 KB). */
export function isSafeImageUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|svg\+xml|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value.length <= 400_000;
  try {
    return new URL(value).protocol === 'https:' && value.length <= 2000;
  } catch {
    return false;
  }
}

function coerce(def, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (def.type === 'list') return list(def.default);
    return typeof def.default === 'object' ? structuredClone(def.default) : def.default;
  }
  switch (def.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Expected a non-negative number, got ${raw}`);
      return n;
    }
    case 'boolean':
      return raw === true || /^(1|true|yes|on)$/i.test(String(raw));
    case 'list':
      return (Array.isArray(raw) ? raw : list(raw)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    case 'json': {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(v)) throw new Error('Expected a JSON array');
      return v;
    }
    case 'image':
      if (!isSafeImageUrl(raw)) throw new Error('Must be an https address or an uploaded PNG, JPG, SVG or WebP of up to 300 KB.');
      return String(raw).trim();
    case 'currency': {
      const c = String(raw).trim().toUpperCase();
      if (c && !/^[A-Z]{3}$/.test(c)) throw new Error('Must be a three-letter currency code such as AED, USD or SGD (empty: the visitor\'s region).');
      return c;
    }
    case 'color': {
      const c = String(raw).trim();
      if (c && !/^#[0-9a-f]{6}$/i.test(c)) throw new Error('Must be a hex colour such as #5b2be0.');
      return c;
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
const getPath = (obj, key) => key.split('.').reduce((o, p) => o?.[p], obj);

const settingsFile = () => path.join(config.dataDir, 'settings.json');

export function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** Only https addresses on checkmarx.net, unless a private deployment is allowed. */
export function isAllowedCheckmarxUrl(value, allowCustom = config.checkmarx.allowCustomHost) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Plain http only to this machine, and only when custom hosts are allowed (a local stand-in while testing).
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowCustom && url.protocol === 'http:' && loopback)) return false;
  if (allowCustom) return true;
  return url.hostname === 'checkmarx.net' || url.hostname.endsWith('.checkmarx.net');
}

/** Rebuilds `config` in place from environment defaults and saved settings. */
export function applySettings(saved = readSaved()) {
  for (const [key, def] of Object.entries(SETTINGS)) {
    const raw = key in saved ? saved[key] : env[def.env];
    try {
      setPath(config, key, coerce(def, raw));
    } catch {
      setPath(config, key, coerce(def, undefined));
    }
  }
  config.publicBaseUrl = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  config.eventName = config.event.name;
  // The connection: tenant, IAM and API URLs from the key's issuer claim, overridable for single-tenant deployments.
  config.connection = null;
  config.connectionError = '';
  const cx = config.checkmarx;
  if (cx.apiKey) {
    try {
      const connection = deriveConnection(cx.apiKey, { baseUrl: cx.baseUrl, iamUrl: cx.iamUrl, tenant: cx.tenant });
      for (const [label, url] of [['IAM URL', connection.iamUrl], ['API URL', connection.baseUrl]]) {
        if (!isAllowedCheckmarxUrl(url, cx.allowCustomHost)) throw new ConnectionError(`The Checkmarx One ${label} must be on checkmarx.net (or allow a custom host under Settings): ${url}`);
      }
      config.connection = connection;
    } catch (e) {
      config.connectionError = e.message;
    }
  }
  return config;
}

/** Validates and persists a patch of settings. Secrets left blank are kept; null removes one. */
export function saveSettings(patch) {
  const saved = readSaved();
  const errors = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const def = SETTINGS[key];
    if (!def) continue;
    if (def.secret && (value === '' || value === undefined)) continue;
    if (value === null) {
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
    if (v && !isAllowedCheckmarxUrl(v, saved['checkmarx.allowCustomHost'] ?? config.checkmarx.allowCustomHost)) errors[key] = 'Must be an https address on checkmarx.net (or allow a custom host first).';
  }
  if (saved.publicBaseUrl && !/^https?:\/\/[^\s/]+/.test(saved.publicBaseUrl)) errors.publicBaseUrl = 'Must be a full http(s) address.';
  if (Object.keys(errors).length) return { errors };
  writeSaved(saved);
  return { ok: true, connectionError: config.connectionError };
}

function writeSaved(saved) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${settingsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, settingsFile());
  applySettings(saved);
}

/** Settings for the admin panel: secrets are reported as set / not set, never returned. */
/** Whether scans run on the Checkmarx One tenant (live) or are simulated (demo). */
export const isLive = () => config.mode === 'live' || (config.mode === 'auto' && Boolean(config.connection));
/** Whether AI Triage and Remediation call Checkmarx One (only when switched on, and only with live scans). */
export const assistLive = () => isLive() && config.assist.mode === 'live';

export function publicSettings() {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    const value = getPath(config, key);
    out[key] = def.secret ? { set: Boolean(value) } : value;
  }
  out.connection = config.connection
    ? { tenant: config.connection.tenant, region: config.connection.regionLabel, baseUrl: config.connection.baseUrl, iamUrl: config.connection.iamUrl, expiresAt: config.connection.expiresAt }
    : null;
  out.connectionError = config.connectionError;
  out.effectiveMode = isLive() ? 'live' : 'demo';
  out.assistLive = assistLive();
  return out;
}

/** What every visitor's browser gets: branding and event, nothing operational. */
export function publicBranding() {
  const b = config.branding;
  return {
    appName: b.appName,
    companyName: b.companyName,
    logoUrl: b.logoUrl,
    iconUrl: b.iconUrl,
    logoHeight: b.logoHeight,
    accentColor: b.accentColor,
    look: b.look,
    theme: b.theme,
    accent: b.accent,
    callToAction: b.callToAction,
    footer: b.footer,
    event: config.event,
  };
}

applySettings();
