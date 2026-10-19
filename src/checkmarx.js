import { config, ENGINES } from './config.js';
import { CxClient, CxApiError } from './cxone/client.js';

/**
 * Checkmarx One for Checkmate: one client per connection (built from the API key,
 * see src/cxone/endpoints.js), the tenant's scan options, projects, scans and results.
 * Settings are read at call time so a key saved in the admin panel applies at once.
 */

let cached = { tokenUrl: null, client: null };

export function client() {
  if (!config.connection) throw new CxApiError(config.connectionError || 'Checkmarx One is not connected: paste the API key under Admin → Settings.', { status: 503 });
  const c = config.connection;
  if (cached.tokenUrl !== c.tokenUrl || cached.key !== c.apiKey) cached = { tokenUrl: c.tokenUrl, key: c.apiKey, client: new CxClient(c) };
  return cached.client;
}

/** Signs in and reads one project; used by "Test connection" and the .env import. */
export async function testConnection() {
  const cx = client();
  const [page, identity] = await Promise.all([cx.request('/api/projects', { query: { limit: 1 } }), cx.identity()]);
  return {
    ok: true,
    tenant: config.connection.tenant,
    region: config.connection.regionLabel,
    projects: page?.totalCount ?? page?.filteredTotalCount ?? null,
    as: identity.user || identity.clientId || '',
  };
}

// ---------------------------------------------------------------------------
// What the tenant offers: engines, Fusion, LLM models, presets.
// Read from the tenant's own configuration entries, so the page offers exactly
// what this tenant can run (verified on the Fusion Hub project: scan.config.ai.*).
// ---------------------------------------------------------------------------
const ENGINE_LABEL = { sast: 'SAST', sca: 'SCA (open source)', kics: 'IaC Security', apisec: 'API Security', containers: 'Container Security', microengines: 'Secrets & repo health', aisc: 'AI Supply Chain' };
const MODEL_LABEL = { 'mythos-5.1': 'Mythos 5.1 — deepest reasoning', 'opus-5.5': 'Opus 5.5 — best balance', 'opus-5.0': 'Opus 5.0', 'opus-4.7': 'Opus 4.7', 'haiku-4.5': 'Haiku 4.5 — fastest' };
const entryValue = (entries, key) => entries.find((e) => e.key === key);
const listParams = (entry) => String(entry?.valuetypeparams ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Tenant-level configuration entries (what every project inherits). */
export async function tenantConfig() {
  const cx = client();
  const entries = await cx.request('/api/configuration/tenant').catch(() => []);
  return Array.isArray(entries) ? entries : [];
}

/**
 * The options a visitor can choose from, built from the tenant configuration:
 *  - engines the tenant licenses (scan.config.general.scannersSelection's choices)
 *  - whether Fusion / AI usage is allowed, and the LLM models the tenant lists
 *  - SAST presets (/api/queries/presets)
 */
export async function scanOptions() {
  const cx = client();
  const [entries, presets] = await Promise.all([
    tenantConfig(),
    cx.request('/api/queries/presets', { query: { limit: 200 } }).catch(() => []),
  ]);
  const scanners = listParams(entryValue(entries, 'scan.config.general.scannersSelection'));
  const engineKeys = ENGINES.filter((e) => !scanners.length || scanners.includes(e) || (e === 'microengines' && scanners.some((s) => /2ms|scorecard|microEngines/i.test(s))));
  const modelEntry = entryValue(entries, 'scan.config.ai.llmModel');
  const models = listParams(modelEntry);
  const aiAllowed = String(entryValue(entries, 'scan.config.ai.allowAiUsage')?.value ?? 'true') !== 'false';
  const tenantModel = String(modelEntry?.value ?? '').trim();
  const presetList = (Array.isArray(presets) ? presets : presets?.presets ?? []).map((p) => (typeof p === 'string' ? p : p.name)).filter(Boolean).slice(0, 60);
  return {
    source: 'tenant',
    tenant: config.connection.tenant,
    region: config.connection.regionLabel,
    engines: engineKeys.map((key) => ({ key, label: ENGINE_LABEL[key] ?? key.toUpperCase(), default: config.scan.engines.includes(key) })),
    fusion: { available: aiAllowed, default: config.scan.fusion && aiAllowed },
    models: models.map((key) => ({ key, label: MODEL_LABEL[key] ?? key, default: key === (config.scan.llmModel || tenantModel || 'opus-5.5') })),
    presets: presetList.map((name) => ({ key: name, label: name, default: name === config.scan.presetName })),
    extendedAnalysis: config.scan.extendedAnalysis,
  };
}

/** Normalises what a visitor picked against what the tenant offers. */
export function resolveProfile(options, choice = {}) {
  const pick = (list, wanted, fallbackDefault = true) => {
    const keys = new Set(list.map((o) => o.key));
    const chosen = (Array.isArray(wanted) ? wanted : [wanted]).filter((k) => keys.has(k));
    if (chosen.length) return chosen;
    return fallbackDefault ? list.filter((o) => o.default).map((o) => o.key) : [];
  };
  const engines = pick(options.engines, choice.engines);
  const fusion = options.fusion.available ? (typeof choice.fusion === 'boolean' ? choice.fusion : options.fusion.default) : false;
  const [llmModel = ''] = pick(options.models, choice.llmModel);
  const [presetName = ''] = pick(options.presets, choice.presetName);
  return { engines: engines.length ? engines : ['sast'], fusion, llmModel, presetName, extendedAnalysis: options.extendedAnalysis !== false };
}

/** The `config` array of POST /api/scans for a profile. */
export function buildScanConfig(profile) {
  const entries = profile.engines.map((type) => {
    if (type === 'sast') {
      const value = { incremental: 'false' };
      if (profile.presetName) value.presetName = profile.presetName;
      if (profile.extendedAnalysis) value.extendedAnalysis = 'true';
      return { type, value };
    }
    return { type, value: {} };
  });
  if (profile.fusion) {
    const value = { fusionEnabled: 'true' };
    if (profile.llmModel) value.llmModel = profile.llmModel;
    entries.push({ type: 'ai', value });
  }
  // Anything the administrator added (same type → merged values).
  for (const extra of config.scan.extraConfig ?? []) {
    if (!extra?.type) continue;
    const match = entries.find((e) => e.type === extra.type);
    if (match) match.value = { ...match.value, ...(extra.value ?? {}) };
    else entries.push({ type: extra.type, value: { ...(extra.value ?? {}) } });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Projects, scans, results
// ---------------------------------------------------------------------------
export async function ensureProject(name, repoUrl, branch) {
  const cx = client();
  const found = await cx.request('/api/projects', { query: { names: name, limit: 1 } });
  const existing = found?.projects?.find((p) => p.name === name);
  if (existing) return existing;
  return cx.request('/api/projects', { method: 'POST', body: { name, repoUrl, mainBranch: branch, origin: 'Checkmate', tags: { source: 'checkmate-event' } } });
}

export async function startScan({ projectId, repoUrl, branch, profile, tags = {} }) {
  const handler = { repoUrl, branch };
  if (config.checkmarx.githubToken) handler.credentials = { username: 'x-access-token', type: 'apiKey', value: config.checkmarx.githubToken };
  return client().request('/api/scans', {
    method: 'POST',
    body: { type: 'git', handler, project: { id: projectId }, config: buildScanConfig(profile), tags: { source: 'checkmate-event', ...tags } },
  });
}

export const getScan = (scanId) => client().request(`/api/scans/${encodeURIComponent(scanId)}`);

/** Every result of a scan. /api/results numbers pages, not rows (see CxClient.paginate). */
export async function getResults(scanId) {
  const all = [];
  for await (const row of client().paginate('/api/results', { query: { 'scan-id': scanId }, itemsKey: 'results', limit: 500, offsetIsPage: true, maxItems: 20_000 })) all.push(row);
  return all;
}

/** Lines of code SAST scanned (GET /api/sast-metadata/{scanId} → loc), for the Fusion credits; null when not known. */
export async function scanLoc(scanId) {
  const meta = await client().request(`/api/sast-metadata/${encodeURIComponent(scanId)}`).catch(() => null);
  const loc = Number(meta?.loc);
  return Number.isFinite(loc) && loc > 0 ? Math.round(loc) : null;
}

/** The scan's results in the Checkmarx One web app. */
export const scanUiUrl = (projectId, scanId) =>
  config.connection ? `${config.connection.baseUrl}/results/${encodeURIComponent(projectId)}/${encodeURIComponent(scanId)}/sast` : '';

export const TERMINAL = new Set(['Completed', 'Partial', 'Failed', 'Canceled']);

// ---------------------------------------------------------------------------
// Applications and Fusion (Fusion Dispatcher + Fusion Results services).
// Fusion correlates across an application: the project is put in one, a Fusion scan
// is started on it, its stage is polled, and the risk-score changes are read back.
// The two services' base paths are not in their OpenAPI files: they are settings,
// and the first live call probes the usual prefixes and remembers the one that answers.
// ---------------------------------------------------------------------------
export async function ensureApplication(name, projectName) {
  const cx = client();
  const found = await cx.request('/api/applications', { query: { name, limit: 20, offset: 0 } });
  const existing = (found?.applications ?? []).find((a) => a.name === name);
  if (existing) {
    // Make sure this project is in it (the rule may predate a renamed project).
    const rules = existing.rules ?? [];
    if (!rules.some((r) => r.type === 'project.name.in' && String(r.value).split(';').includes(projectName))) {
      await cx.request(`/api/applications/${encodeURIComponent(existing.id)}/project-rules`, { method: 'POST', body: { type: 'project.name.in', value: projectName } }).catch(() => {});
    }
    return existing;
  }
  return cx.request('/api/applications', {
    method: 'POST',
    body: { name, description: 'Created by Checkmate for a Fusion demonstration', criticality: 3, rules: [{ type: 'project.name.in', value: projectName }], tags: { source: 'checkmate-event' } },
  });
}

const FUSION_CANDIDATES = {
  dispatcher: ['/api/fusion-dispatcher', '/api/fusion/dispatcher', '/api/fusion-dispatcher-service', '/api/fusion'],
  results: ['/api/fusion-results', '/api/fusion/results', '/api/fusion-results-service', '/api/fusion'],
};
const probed = {};

/** The base path of a Fusion service: the setting when given, else the first candidate that is not a 404. */
async function fusionBase(kind, appId) {
  const configured = (config.fusion[`${kind}Path`] || '').replace(/\/$/, '');
  if (configured) return configured;
  if (probed[kind]) return probed[kind];
  const cx = client();
  const path = kind === 'dispatcher' ? `/${encodeURIComponent(appId)}/scan-status` : '/applications';
  for (const base of FUSION_CANDIDATES[kind]) {
    try {
      await cx.request(`${base}${path}`, { retries: 0 });
      probed[kind] = base;
      return base;
    } catch (e) {
      if (e.status && e.status !== 404 && e.status !== 405) {
        probed[kind] = base; // it exists; the answer was about the app, not the path
        return base;
      }
    }
  }
  throw new CxApiError(`No Fusion service answered on this tenant (tried ${FUSION_CANDIDATES[kind].join(', ')}). Set its base path under Admin → Settings → Fusion.`, { status: 404 });
}

export async function startFusion(appId) {
  const base = await fusionBase('dispatcher', appId);
  return client().request(`${base}/${encodeURIComponent(appId)}/correlate`, { method: 'POST', retries: 1 });
}

/** {scanStatus: Unknown|Started|In Progress|Completed|Failed, stage: 0..100, stageDescription, errorMessage, scanId} */
export async function fusionStatus(appId) {
  const base = await fusionBase('dispatcher', appId);
  return client().request(`${base}/${encodeURIComponent(appId)}/scan-status`);
}

/** Risk-score changes Fusion made for these Checkmarx One scans, with the reason for each. */
export async function fusionRiskScores(appId, scanIds = []) {
  const base = await fusionBase('results', appId);
  const page = await client().request(`${base}/applications/${encodeURIComponent(appId)}/risk-scores`, { query: { 'cxone-scan-ids': scanIds, limit: 500 } });
  return page?.results ?? [];
}

/** What Fusion mapped: microservices and cloud resources, and the summary counts. */
export async function fusionMap(appId) {
  const base = await fusionBase('results', appId);
  const cx = client();
  const [summary, resources, microservices] = await Promise.all([
    cx.request(`${base}/applications/${encodeURIComponent(appId)}/summary`).catch(() => null),
    cx.request(`${base}/applications/${encodeURIComponent(appId)}/resources`).catch(() => null),
    cx.request(`${base}/applications/${encodeURIComponent(appId)}/microservices`).catch(() => null),
  ]);
  return { summary, resources: resources?.resources ?? [], microservices: microservices?.microservices ?? [] };
}

export const FUSION_TERMINAL = new Set(['Completed', 'Failed']);
