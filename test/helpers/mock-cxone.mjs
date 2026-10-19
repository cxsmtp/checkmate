/**
 * A small Checkmarx One stand-in for the live-flow test: the exact endpoints and
 * shapes Checkmate uses (sign-in, tenant configuration, presets, projects,
 * applications, scans, results, the Fusion Dispatcher/Results services, AI Triage
 * and AI Remediation). Each handler answers the way the tenant has been seen to,
 * and records what it was asked so the test can check the requests.
 */
import http from 'node:http';
import { demoResults } from '../../src/demo.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(data);
      }
    });
  });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function fakeApiKey(iamBase) {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: `${iamBase}/auth/realms/acme`, sub: 'booth', exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
}

export async function startMockCxOne({ scanPolls = 2, triagePolls = 1, remediationPolls = 1 } = {}) {
  const calls = [];
  const state = { scanId: 'scan-0001', projectId: 'proj-0001', appId: 'app-0001', scanLooks: 0, fusionLooks: 0, triageLooks: {}, remLooks: {} };
  const accessToken = `${b64({ alg: 'none' })}.${b64({ preferred_username: 'booth@acme.example', azp: 'ast-app' })}.`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null;
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, accept: req.headers.accept, auth: req.headers.authorization });
    const p = url.pathname;

    // --- IAM ---
    if (p === '/auth/realms/acme/protocol/openid-connect/token') {
      if (!String(body).includes('refresh_token=')) return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, { access_token: accessToken, expires_in: 1800, token_type: 'Bearer' });
    }
    if (!req.headers.authorization?.startsWith('Bearer ')) return json(res, 401, { message: 'no token' });

    // --- tenant ---
    if (p === '/api/configuration/tenant') {
      return json(res, 200, [
        { key: 'scan.config.general.scannersSelection', name: 'Scanners', value: 'sast,sca,kics', valuetype: 'List', valuetypeparams: 'sast,kics,apisec,sca,containers,microEnginesScoreCard,microEngines2ms,cisec,2ms,aisc,scorecard' },
        { key: 'scan.config.ai.fusionEnabled', name: 'Fusion Scan', value: 'false', valuetype: 'Bool' },
        { key: 'scan.config.ai.allowAiUsage', name: 'Allow AI usage', value: 'true', valuetype: 'Bool' },
        { key: 'scan.config.ai.llmModel', name: 'LLM model', value: 'opus-5.5', valuetype: 'List', valuetypeparams: 'opus-4.7,haiku-4.5,opus-5.0,opus-5.5,mythos-5.1' },
        { key: 'scan.config.sast.extendedAnalysis', name: 'LLM-based scanning', value: 'false', valuetype: 'Bool' },
      ]);
    }
    if (p === '/api/queries/presets') return json(res, 200, { presets: [{ id: 1, name: 'ASA Premium' }, { id: 2, name: 'OWASP Top 10 2021' }], totalCount: 2 });

    // --- projects / applications ---
    if (p === '/api/projects' && req.method === 'GET') {
      // A project with a published Fusion scan on the sample repository (for "results already published").
      if (url.searchParams.get('repo-url') === 'https://github.com/acme/published') return json(res, 200, { projects: [{ id: 'proj-published', name: 'team/published', repoUrl: 'https://github.com/acme/published' }], totalCount: 1 });
      return json(res, 200, { projects: [], totalCount: 0, filteredTotalCount: 0 });
    }
    if (p === '/api/scans' && req.method === 'GET' && url.searchParams.get('project-id') === 'proj-published') {
      return json(res, 200, { scans: [
        { id: 'scan-old-nofusion', status: 'Completed', engines: ['sast', 'sca'], branch: 'main', createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:05:00Z' },
        { id: state.scanId, status: 'Completed', engines: ['sast', 'sca', 'ai'], branch: 'main', createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T10:06:00Z' },
      ], totalCount: 2 });
    }
    if (p === '/api/projects' && req.method === 'POST') return json(res, 201, { id: state.projectId, name: body.name, repoUrl: body.repoUrl, mainBranch: body.mainBranch });
    if (p === '/api/applications' && req.method === 'GET') return json(res, 200, { applications: [], totalCount: 0 });
    if (p === '/api/applications' && req.method === 'POST') return json(res, 201, { id: state.appId, name: body.name, rules: body.rules });

    // --- scans ---
    if (p === '/api/scans' && req.method === 'POST') return json(res, 201, { id: state.scanId, status: 'Queued', projectId: body.project.id });
    if (p === `/api/sast-metadata/${state.scanId}`) return json(res, 200, { scanId: state.scanId, loc: 23456, fileCount: 120 });
    if (p === `/api/scans/${state.scanId}`) {
      state.scanLooks += 1;
      const done = state.scanLooks > scanPolls;
      const engines = ['sast', 'sca', 'kics', 'ai'];
      return json(res, 200, {
        id: state.scanId, status: done ? 'Completed' : 'Running', projectId: state.projectId,
        statusDetails: [{ name: 'general', status: done ? 'Completed' : 'Running' }, ...engines.map((e, i) => ({ name: e, status: done ? 'Completed' : i < state.scanLooks ? 'Completed' : 'Running' }))],
      });
    }
    if (p === '/api/results') {
      const page = Number(url.searchParams.get('offset') || 0);
      const rows = page === 0 ? demoResults().map((r, i) => ({ ...r, alternateId: `alt-${i + 1}` })) : [];
      return json(res, 200, { results: rows, totalCount: rows.length });
    }

    // --- Fusion Dispatcher / Results (on one of the probed base paths) ---
    if (p === `/api/fusion-dispatcher/${state.appId}/correlate` && req.method === 'POST') return json(res, 201, {});
    if (p === `/api/fusion-dispatcher/${state.appId}/scan-status`) {
      state.fusionLooks += 1;
      const stage = Math.min(100, state.fusionLooks * 50);
      return json(res, 200, { scanStatus: stage >= 100 ? 'Completed' : 'In Progress', stage, stageDescription: stage >= 100 ? 'Done' : 'Correlating findings', scanId: 'fusion-1' });
    }
    if (p === '/api/fusion-results/applications') return json(res, 200, { applications: [{ id: state.appId }] });
    if (p === `/api/fusion-results/applications/${state.appId}/risk-scores`) {
      return json(res, 200, { results: [
        { resultId: 'fus-001', fusionScanId: 'fusion-1', vulnerabilityEngine: 'SAST', correlatedEngine: 'KICS', oldRiskValue: 7.5, newRiskValue: 9.6, scanId: state.scanId, resultInfo: 'Reachable through the public ALB.', projectId: state.projectId },
        { resultId: 'CVE-2024-29041', fusionScanId: 'fusion-1', vulnerabilityEngine: 'SCA', correlatedEngine: 'SAST', oldRiskValue: 6.1, newRiskValue: 3.2, scanId: state.scanId, resultInfo: 'The vulnerable function is never called.', projectId: state.projectId },
      ] });
    }
    if (p === `/api/fusion-results/applications/${state.appId}/summary`) return json(res, 200, { microservices: { count: 2 }, cloudResources: { count: 3, access: { Public: 1, Private: 2 } } });
    if (p === `/api/fusion-results/applications/${state.appId}/resources`) return json(res, 200, { resources: [{ name: 'customer-exports', type: 'AWS::S3::Bucket', access: 'Public' }, { name: 'shop-db', type: 'AWS::RDS::DBInstance', access: 'Private' }] });
    if (p === `/api/fusion-results/applications/${state.appId}/microservices`) return json(res, 200, { microservices: [{ name: 'orders-api' }, { name: 'web' }] });

    // --- AI Triage ---
    if (p === '/api/ai-triage/triage' && req.method === 'POST') return json(res, 200, { triageID: 'triage-job-1', published: true });
    const triage = p.match(/^\/api\/ai-triage\/triage\/([^/]+)\/(.+)$/);
    if (triage) {
      const group = decodeURIComponent(triage[2]);
      state.triageLooks[group] = (state.triageLooks[group] ?? 0) + 1;
      if (state.triageLooks[group] <= triagePolls) return json(res, 200, { triageStatus: 'IN_PROGRESS', jobStatus: 'IN_PROGRESS' });
      return json(res, 200, { triageStatus: group === 'c1' ? 'PROPOSED_NOT_EXPLOITABLE' : 'VULNERABLE', analysis: { confidence: { score: '0.91' }, reachability: { status: 'REACHABLE' }, exploitability: { status: 'EXPLOITABLE', reason: `Input reaches the sink in group ${group}.` } } });
    }

    // --- AI Remediation ---
    if (p === '/api/remediation/remediate' && req.method === 'POST') return json(res, 200, { remediationJobId: `rem-${body.buckets[0].resultIDs[0]}`, published: true });
    const rem = p.match(/^\/api\/remediation\/remediation-details\/([^/]+)\/(.+)$/);
    if (rem) {
      const alt = decodeURIComponent(rem[2]);
      state.remLooks[alt] = (state.remLooks[alt] ?? 0) + 1;
      if (state.remLooks[alt] <= remediationPolls) return json(res, 200, { results: [{ jobStatus: 'IN_PROGRESS', data: {} }] });
      return json(res, 200, { results: [{ jobStatus: 'COMPLETED', finishedAt: new Date().toISOString(), data: { summary: `Fix for ${alt}`, analysis: { how: 'Validate and bind the input.', why: 'Removes the injection path.' }, file_changes: [{ file_path: 'src/api/orders.js', diff: '@@ -41,2 +41,3 @@\n const order = await find(id);\n+if (order.customerId !== req.user.id) return res.status(404).end();\n res.json(order);\n' }] }, autoPr: { url: 'https://github.com/acme/webshop/pull/42' } }] });
    }

    json(res, 404, { message: `mock: no route for ${req.method} ${p}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, state, apiKey: fakeApiKey(base), close: () => new Promise((resolve) => server.close(resolve)) };
}
