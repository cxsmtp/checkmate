import 'dotenv/config';

const list = (v, fallback) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const json = (v, fallback) => {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`Invalid JSON in environment value: ${v}`);
  }
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ''),
  eventName: process.env.EVENT_NAME ?? 'Checkmate',
  dataDir: process.env.DATA_DIR ?? 'data',

  // "live" talks to the Checkmarx One tenant; "demo" simulates a scan so the
  // booth can rehearse (or keep running) without tenant access.
  mode: (process.env.CX_MODE ?? 'demo').toLowerCase(),

  checkmarx: {
    baseUrl: (process.env.CX_BASE_URL ?? 'https://ast.checkmarx.net').replace(/\/$/, ''),
    iamUrl: (process.env.CX_IAM_URL ?? 'https://iam.checkmarx.net').replace(/\/$/, ''),
    tenant: process.env.CX_TENANT ?? '',
    // Either an API key (refresh token) or an OAuth client id/secret.
    apiKey: process.env.CX_API_KEY ?? '',
    clientId: process.env.CX_CLIENT_ID ?? '',
    clientSecret: process.env.CX_CLIENT_SECRET ?? '',
    projectPrefix: process.env.CX_PROJECT_PREFIX ?? 'checkmate-',
    defaultBranch: process.env.CX_DEFAULT_BRANCH ?? 'main',
    // Engines to run; Fusion entries are added from CX_FUSION_SCAN_CONFIG.
    engines: list(process.env.CX_ENGINES, 'sast,sca,kics,apisec'),
    // Extra scan config entries (JSON array) that switch the Fusion engine on,
    // e.g. [{"type":"sast","value":{"engineVerbose":"false","fusion":"true"}}].
    fusionScanConfig: json(process.env.CX_FUSION_SCAN_CONFIG, []),
    pollIntervalMs: Number(process.env.CX_POLL_INTERVAL_MS ?? 15000),
    scanTimeoutMs: Number(process.env.CX_SCAN_TIMEOUT_MS ?? 45 * 60 * 1000),
    // Optional GitHub token for private repositories.
    githubToken: process.env.CX_GITHUB_TOKEN ?? '',
  },

  fusion: {
    // A result counts as a Fusion finding when its result type, or any of its
    // engine/source fields, matches one of these markers.
    markers: list(process.env.FUSION_RESULT_MARKERS, 'fusion,ai-sast,aisast,ai_sast'),
  },

  anthropic: {
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    maxFindingsToExplain: Number(process.env.EXPLAIN_MAX_FINDINGS ?? 40),
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Checkmarx Checkmate <no-reply@checkmarx.com>',
    // Internal team address(es) copied on every registration.
    notify: process.env.TEAM_NOTIFY_EMAIL ?? '',
  },
};
