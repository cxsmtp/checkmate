import { config } from './config.js';

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const ENGINE_LABEL = {
  sast: 'Static code analysis (SAST)',
  sca: 'Open-source dependencies (SCA)',
  kics: 'Infrastructure as code (IaC)',
  secrets: 'Secrets detection',
  apisec: 'API security',
  containers: 'Container security',
  fusion: 'Checkmarx Fusion',
};

const str = (v) => (v == null ? '' : String(v));

function engineOf(type) {
  const t = str(type).toLowerCase();
  if (t.includes('secret')) return 'secrets';
  if (t === 'infrastructure' || t === 'kics' || t === 'iac') return 'kics';
  if (t.includes('container')) return 'containers';
  if (t.includes('api')) return 'apisec';
  if (t === 'sca' || t.includes('dependency')) return 'sca';
  return t || 'sast';
}

/**
 * True when a raw Checkmarx One result was produced by Fusion (the LLM-based engine).
 *
 * Verified on a real tenant (project "Fusion Hub", scan 6324d8fd…): Fusion's findings
 * arrive in /api/results as type "sast" but with `data.queryId === 0`, a CWE title as
 * the query name ("Improper Input Validation") instead of a query id ("SQL_Injection"),
 * a group of the form <Language>_<SEVERITY> and no description. Classic SAST results
 * have a 64-bit queryId and a group like "JavaScript_Low_Visibility".
 * Any explicit marker (a type or engine field naming fusion / ai-sast) also counts.
 */
export function isFusionResult(raw, { markers = config.fusion.markers, queryIdZero = config.fusion.queryIdZero } = {}) {
  const d = raw?.data ?? {};
  const fields = [raw?.type, raw?.source, raw?.engine, raw?.origin, d.engine, d.source, d.detectionEngine, d.detectionMethod, d.resultSource];
  const hay = fields.map((f) => str(f).toLowerCase());
  if (markers.some((m) => hay.some((h) => h && h.includes(m)))) return true;
  if (queryIdZero && str(raw?.type).toLowerCase() === 'sast') {
    const queryId = d.queryId;
    const zero = queryId === 0 || queryId === '0';
    const fusionGroup = /^[A-Za-z#+.]+_(CRITICAL|HIGH|MEDIUM|LOW|INFO)$/.test(str(d.group));
    if (zero && (fusionGroup || !d.queryId)) return true;
  }
  return false;
}

/** Converts a Checkmarx One result into the flat shape the page renders. */
export function normalize(raw) {
  const d = raw.data ?? {};
  const vd = raw.vulnerabilityDetails ?? {};
  const fusion = isFusionResult(raw);
  const engine = fusion ? 'fusion' : engineOf(raw.type);
  const node = Array.isArray(d.nodes) && d.nodes.length ? d.nodes[0] : {};
  const sink = Array.isArray(d.nodes) && d.nodes.length ? d.nodes[d.nodes.length - 1] : {};

  const title =
    d.queryName || d.ruleName || d.title || (raw.type === 'sca' ? `${vd.cveName || raw.id} in ${d.packageIdentifier ?? 'a dependency'}` : '') || raw.description?.slice(0, 80) || 'Security finding';

  return {
    id: str(raw.id || raw.similarityId),
    similarityId: str(raw.similarityId),
    // Checkmarx One AI Triage and AI Remediation are keyed by the result's alternateId.
    alternateId: str(raw.alternateId),
    engine,
    engineLabel: ENGINE_LABEL[engine] ?? engine.toUpperCase(),
    underlyingType: str(raw.type),
    title: str(title).replace(/_/g, ' '),
    severity: SEVERITY_ORDER.includes(str(raw.severity).toUpperCase()) ? str(raw.severity).toUpperCase() : 'INFO',
    state: str(raw.state),
    status: str(raw.status),
    cwe: str(vd.cweId || d.cweId || ''),
    cve: str(vd.cveName || (raw.type === 'sca' ? raw.id : '')),
    cvss: vd.cvssScore ?? null,
    file: str(node.fileName || d.filename || d.fileName || d.file || ''),
    line: Number(node.line ?? d.line ?? 0) || null,
    sinkFile: str(sink.fileName || ''),
    sinkLine: Number(sink.line ?? 0) || null,
    language: str(d.languageName || d.platform || ''),
    packageName: str(d.packageIdentifier || ''),
    recommendedVersion: str(d.recommendedVersion || ''),
    description: str(raw.description || d.description || ''),
    // Fusion's own account of what it determined, when the result carries one.
    fusionInsight: str(raw.fusionInsight || d.fusionInsight || d.explanation || ''),
    expected: str(d.expectedValue || ''),
    actual: str(d.actualValue || ''),
    firstFoundAt: str(raw.firstFoundAt || raw.foundAt || ''),
    // The data flow from source to sink, as Checkmarx One's attack vector shows it.
    nodes: (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 25).map((n) => ({
      file: str(n.fileName),
      line: Number(n.line) || null,
      column: Number(n.column) || null,
      name: str(n.name || n.fullName || ''),
      method: str(n.method || ''),
    })),
  };
}

const normFile = (f) => str(f).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const normTitle = (t) => str(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const locations = (f) =>
  [[f.file, f.line], [f.sinkFile, f.sinkLine]].filter(([file]) => file).map(([file, line]) => ({ file: normFile(file), line }));

/** Same weakness at (nearly) the same location — source or sink — i.e. both engines found it. */
export function sameIssue(a, b, lineTolerance = 3) {
  const sameKind = (a.cwe && b.cwe && a.cwe === b.cwe) || normTitle(a.title) === normTitle(b.title);
  if (!sameKind) return false;
  return locations(a).some((x) =>
    locations(b).some((y) => x.file === y.file && (!x.line || !y.line || Math.abs(x.line - y.line) <= lineTolerance)),
  );
}

const bySeverity = (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.title.localeCompare(b.title);

/**
 * Splits findings into:
 *  - fusionOnly: Fusion findings that no deterministic engine reported (the headline)
 *  - others: every deterministic finding, flagged when Fusion corroborated it
 */
export function classify(rawResults) {
  const all = rawResults.map(normalize);
  const fusion = all.filter((f) => f.engine === 'fusion');
  const deterministic = all.filter((f) => f.engine !== 'fusion');

  const fusionOnly = [];
  for (const f of fusion) {
    const match = deterministic.find((d) => sameIssue(f, d));
    if (match) match.confirmedByFusion = true;
    else fusionOnly.push({ ...f, fusionOnly: true });
  }

  fusionOnly.sort(bySeverity);
  deterministic.sort(bySeverity);
  return { fusionOnly, others: deterministic, summary: summarize(fusionOnly, deterministic) };
}

export function summarize(fusionOnly, others) {
  const count = (list) => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, list.filter((f) => f.severity === s).length]));
  const byEngine = {};
  for (const f of others) byEngine[f.engineLabel] = (byEngine[f.engineLabel] ?? 0) + 1;
  return {
    total: fusionOnly.length + others.length,
    fusionOnly: fusionOnly.length,
    fusionOnlyBySeverity: count(fusionOnly),
    othersBySeverity: count(others),
    allBySeverity: count([...fusionOnly, ...others]),
    confirmedByFusion: others.filter((f) => f.confirmedByFusion).length,
    byEngine,
  };
}
