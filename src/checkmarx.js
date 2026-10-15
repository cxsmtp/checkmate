import { config, isAllowedCheckmarxUrl } from './config.js';

// Minimal Checkmarx One REST client: auth, project, scan, poll, results.
// Settings are read on every call so changes from the admin panel apply at once.
const ACCEPT = 'application/json; version=1.0';
const TIMEOUT_MS = 60_000;

let token = null;
let tokenExpiresAt = 0;
let tokenFor = '';

function settings() {
  const cx = config.checkmarx;
  for (const [name, url] of [['Base URL', cx.baseUrl], ['IAM URL', cx.iamUrl]]) {
    if (!isAllowedCheckmarxUrl(url)) throw new Error(`Checkmarx One ${name} is not an allowed https address: ${url}`);
  }
  return cx;
}

async function getToken() {
  const cx = settings();
  const identity = `${cx.iamUrl}|${cx.tenant}|${cx.apiKey}|${cx.clientId}|${cx.clientSecret}`;
  if (token && tokenFor === identity && Date.now() < tokenExpiresAt - 60_000) return token;
  if (!cx.tenant) throw new Error('The Checkmarx One tenant is not configured');

  const form = new URLSearchParams();
  if (cx.apiKey) {
    form.set('grant_type', 'refresh_token');
    form.set('client_id', 'ast-app');
    form.set('refresh_token', cx.apiKey);
  } else if (cx.clientId && cx.clientSecret) {
    form.set('grant_type', 'client_credentials');
    form.set('client_id', cx.clientId);
    form.set('client_secret', cx.clientSecret);
  } else {
    throw new Error('Set CX_API_KEY or CX_CLIENT_ID/CX_CLIENT_SECRET for live mode');
  }

  const res = await fetch(
    `${cx.iamUrl}/auth/realms/${encodeURIComponent(cx.tenant)}/protocol/openid-connect/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Checkmarx One authentication failed (${res.status})`);
  const body = await res.json();
  token = body.access_token;
  tokenFor = identity;
  tokenExpiresAt = Date.now() + (body.expires_in ?? 1800) * 1000;
  return token;
}

async function api(method, path, body) {
  const cx = settings();
  const res = await fetch(`${cx.baseUrl}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      Accept: ACCEPT,
      ...(body ? { 'Content-Type': ACCEPT } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Checkmarx One ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function ensureProject(name, repoUrl, branch) {
  const found = await api('GET', `/api/projects?names=${encodeURIComponent(name)}&limit=1`);
  const existing = found?.projects?.find((p) => p.name === name);
  if (existing) return existing;
  return api('POST', '/api/projects', {
    name,
    repoUrl,
    mainBranch: branch,
    origin: 'Checkmate',
    tags: { source: 'checkmate-event' },
  });
}

export function buildScanConfig() {
  const cx = config.checkmarx;
  const entries = cx.engines.map((type) =>
    type === 'sast' ? { type, value: { incremental: 'false' } } : { type, value: {} },
  );
  // Merge Fusion configuration over the defaults (same type -> merged values).
  for (const extra of cx.fusionScanConfig) {
    const match = entries.find((e) => e.type === extra.type);
    if (match) match.value = { ...match.value, ...(extra.value ?? {}) };
    else entries.push(extra);
  }
  return entries;
}

export async function startScan({ projectId, repoUrl, branch, tags = {} }) {
  const cx = config.checkmarx;
  const handler = { repoUrl, branch };
  if (cx.githubToken) handler.credentials = { username: 'x-access-token', type: 'apiKey', value: cx.githubToken };
  return api('POST', '/api/scans', {
    type: 'git',
    handler,
    project: { id: projectId },
    config: buildScanConfig(),
    tags: { source: 'checkmate-event', ...tags },
  });
}

export const getScan = (scanId) => api('GET', `/api/scans/${encodeURIComponent(scanId)}`);

export async function getResults(scanId) {
  const all = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await api('GET', `/api/results?scan-id=${encodeURIComponent(scanId)}&limit=${limit}&offset=${offset}`);
    all.push(...(page?.results ?? []));
    if (!page?.results?.length || all.length >= (page.totalCount ?? 0)) break;
  }
  return all;
}

/** The scan's results in the Checkmarx One web app (for tenant users, e.g. the booth team). */
export const scanUiUrl = (projectId, scanId) =>
  `${config.checkmarx.baseUrl}/results/${encodeURIComponent(projectId)}/${encodeURIComponent(scanId)}/sast`;

/** Signs in and reads one project: used by "Test connection" in the admin panel. */
export async function testConnection() {
  const page = await api('GET', '/api/projects?limit=1');
  return { ok: true, projects: page?.totalCount ?? page?.filteredTotalCount ?? null };
}

export const TERMINAL = new Set(['Completed', 'Partial', 'Failed', 'Canceled']);
