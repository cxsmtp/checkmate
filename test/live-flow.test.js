/**
 * The whole live flow against a Checkmarx One stand-in (test/helpers/mock-cxone.mjs):
 * sign in with the key → tenant options (models from the tenant) → project, application,
 * scan with the ai config → poll → Fusion correlate/status/risk-scores/map → results →
 * outcome → AI Triage → AI Remediation → the developer brief. The server runs as a child
 * process exactly as the container starts it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { startMockCxOne } from './helpers/mock-cxone.mjs';

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 30_000, every = 150, label = 'condition' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`);
    await sleep(every);
  }
}

test('live mode end to end against a Checkmarx One stand-in', { timeout: 90_000 }, async (t) => {
  const mock = await startMockCxOne();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-live-'));
  const port = await freePort();
  const env = {
    ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', CX_MODE: 'live', CX_API_KEY: mock.apiKey, CX_BASE_URL: mock.base, CX_IAM_URL: mock.base,
    CX_ALLOW_CUSTOM_HOST: 'true', ASSIST_MODE: 'live', CX_POLL_INTERVAL_MS: '150', FUSION_TIMEOUT_MS: '20000', ASSIST_POLL_INTERVAL_MS: '150', ASSIST_TIMEOUT_MS: '20000',
    CITY_PHOTOS_AUTO: 'false', ADMIN_PASSWORD: 'live-flow-test-password', PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, UPDATE_CHECK_MINUTES: '0', SAMPLES_AUTO_SCAN: 'false',
  };
  const child = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  t.after(async () => { child.kill('SIGTERM'); await mock.close(); });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  await waitFor(() => fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false), { label: 'server start' });

  // The key was enough to connect: the public config says so.
  const cfg = await api('GET', '/api/config');
  assert.equal(cfg.mode, 'live');
  assert.equal(cfg.connected, true, `not connected; server log:\n${log}`);

  // Register (as the page does) and read the scan profile fetched from the tenant.
  const reg = await api('POST', '/api/sessions', { name: 'Ada Lovelace', email: 'ada@acme.example', company: 'Acme', title: 'CISO', technicalName: 'Charles Babbage', technicalEmail: 'charles@acme.example', contacts: [{ name: 'Ops One', email: 'ops1@acme.example' }, { name: 'Ops Two', email: 'ops2@acme.example' }], githubUrl: 'https://github.com/acme/webshop', branch: 'main', consent: true, inviteNow: false, theme: 'dubai' });
  const s = (p = '') => api('GET', `/api/sessions/${reg.id}${p}${p.includes('?') ? '&' : '?'}k=${reg.accessKey}`);
  const profile = await waitFor(async () => { const x = await s(); return x.stage === 'profile' ? x : null; }, { label: 'profile stage' });
  assert.equal(profile.options.source, 'tenant');
  assert.deepEqual(profile.options.models.map((m) => m.key), ['opus-4.7', 'haiku-4.5', 'opus-5.0', 'opus-5.5', 'mythos-5.1']);
  assert.equal(profile.options.models.find((m) => m.default).key, 'opus-5.5', 'the tenant default is pre-selected');
  assert.ok(profile.options.engines.some((e) => e.key === 'sast'));
  assert.equal(profile.options.fusion.available, true);

  // Choose Fusion with Mythos; the scan request must carry it.
  await api('POST', `/api/sessions/${reg.id}/start`, { k: reg.accessKey, engines: ['sast', 'sca', 'kics'], fusion: true, llmModel: 'mythos-5.1', presetName: 'ASA Premium' });
  const done = await waitFor(async () => { const x = await s(); if (x.stage === 'error') throw new Error(`scan errored: ${x.error}\n${log}`); return x.stage === 'complete' ? x : null; }, { timeout: 60_000, label: 'scan completion' });
  const scanCall = mock.calls.find((c) => c.method === 'POST' && c.path === '/api/scans');
  assert.ok(scanCall, 'a scan was started');
  assert.equal(scanCall.body.handler.repoUrl, 'https://github.com/acme/webshop');
  assert.deepEqual(scanCall.body.config.find((c) => c.type === 'ai').value, { fusionEnabled: 'true', llmModel: 'mythos-5.1' });
  assert.deepEqual(scanCall.body.config.find((c) => c.type === 'sast').value, { incremental: 'false', presetName: 'ASA Premium', extendedAnalysis: 'true' });
  assert.ok(mock.calls.some((c) => c.path === '/api/applications' && c.method === 'POST'), 'an application was created for Fusion');
  assert.ok(mock.calls.some((c) => c.path === `/api/fusion-dispatcher/${mock.state.appId}/correlate`), 'Fusion correlation was started');
  assert.ok(mock.calls.every((c) => !c.path.startsWith('/api/') || c.path.includes('/auth/') || /version=1\.0/.test(c.accept ?? '') || c.path.startsWith('/api/fusion')), 'API calls negotiate the version through Accept');

  // The outcome: Fusion-only findings on top, correlation attached, the application map read.
  assert.equal(done.summary.fusionOnly, 4);
  assert.ok(done.fusionOnly.every((f) => f.alternateId), 'alternateIds kept for AI Triage/Remediation');
  const corr = done.fusionOnly.find((f) => f.id === 'fus-001').correlation;
  assert.equal(corr.direction, 'raised');
  assert.equal(done.outcome.correlation.status, 'completed');
  assert.equal(done.outcome.correlation.changed, 2);
  assert.equal(done.fusionMap.resources.length, 2);
  assert.match(done.outcome.headline, /^4 risks in acme\/webshop that rule-based scanning could not see/);
  assert.equal(done.assistScopes.fusion, 4);
  assert.ok(done.assistScopes.all > done.assistScopes.fusion);
  assert.equal(done.cx.demo, undefined);
  assert.equal(done.cx.projectId, undefined, 'tenant identifiers are not shown to visitors');

  // AI Triage: one POST with the Fusion-only result ids, verdicts read back per group.
  await api('POST', `/api/sessions/${reg.id}/assist/triage`, { k: reg.accessKey, scope: 'fusion' });
  const triaged = await waitFor(async () => { const x = await s(); return x.assist?.triage?.status === 'done' ? x : null; }, { label: 'AI Triage' });
  const triageCall = mock.calls.find((c) => c.method === 'POST' && c.path === '/api/ai-triage/triage');
  assert.equal(triageCall.body.scanID, mock.state.scanId);
  assert.deepEqual(triageCall.body.buckets.map((b) => b.scannerType), ['sast']);
  assert.equal(triageCall.body.buckets[0].resultIDs.length, 4);
  assert.equal(triaged.assist.triage.summary.vulnerable, 4);
  assert.equal(Object.values(triaged.assist.triage.items)[0].verdict, 'VULNERABLE');
  assert.equal(Object.values(triaged.assist.triage.items)[0].confidence, '0.91');

  // AI Remediation on everything: one POST per finding, fixes read back; the SCA finding keyed by its own group.
  await api('POST', `/api/sessions/${reg.id}/assist/remediate`, { k: reg.accessKey, scope: 'all' });
  const fixed = await waitFor(async () => { const x = await s(); return x.assist?.remediation?.status === 'done' ? x : null; }, { label: 'AI Remediation' });
  const remCalls = mock.calls.filter((c) => c.method === 'POST' && c.path === '/api/remediation/remediate');
  assert.equal(remCalls.length, fixed.assist.remediation.requested);
  assert.ok(remCalls.every((c) => c.body.buckets[0].resultIDs.length === 1), 'one result per remediation request');
  assert.ok(remCalls.some((c) => c.body.buckets[0].scannerType === 'sca'));
  const fix = Object.values(fixed.assist.remediation.items).find((i) => i.status === 'done');
  assert.equal(fix.files, 1);
  assert.equal(fix.changes[0].path, 'src/api/orders.js');
  assert.equal(fix.prUrl, 'https://github.com/acme/webshop/pull/42');
  assert.equal(fixed.assist.remediation.summary.failed, 0);

  // The developer brief goes to the technical owner (outbox, as SMTP is not configured).
  const sent = await api('POST', `/api/sessions/${reg.id}/assist/send`, { k: reg.accessKey });
  assert.deepEqual(sent.results.map((r) => r.ok), [true]);
  const outbox = fs.readdirSync(path.join(dataDir, 'outbox')).filter((f) => f.includes('charles@acme.example'));
  const brief = JSON.parse(fs.readFileSync(path.join(dataDir, 'outbox', outbox.at(-1)), 'utf8'));
  assert.match(brief.subject, /AI-written fix/);
  assert.match(brief.text, /git apply|\+\+\+ b\/src\/api\/orders\.js/);

  // No credential ever went anywhere but the stand-in, and never in a URL.
  assert.ok(mock.calls.every((c) => !JSON.stringify(c.query).includes(mock.apiKey)));
});
