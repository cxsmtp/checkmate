/**
 * The booth default: only CX_API_KEY is set. Scans and results must come from Checkmarx One
 * (Automatic mode), while AI Triage and Remediation stay simulated until switched on in the
 * admin panel: they run on the real findings and never call the tenant's AI endpoints.
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
async function waitFor(fn, { timeout = 30_000, label = 'condition' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`);
    await sleep(150);
  }
}

test('Automatic mode: real scan and results with the key alone; AI Triage simulated on the real findings', { timeout: 90_000 }, async (t) => {
  const mock = await startMockCxOne();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-auto-'));
  const port = await freePort();
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', CX_API_KEY: mock.apiKey, CX_BASE_URL: mock.base, CX_IAM_URL: mock.base, CX_ALLOW_CUSTOM_HOST: 'true', CX_POLL_INTERVAL_MS: '150', FUSION_TIMEOUT_MS: '20000', CITY_PHOTOS_AUTO: 'false', ADMIN_PASSWORD: 'auto-mode-test-password', UPDATE_CHECK_MINUTES: '0' };
  delete env.CX_MODE;
  delete env.ASSIST_MODE;
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

  const cfg = await api('GET', '/api/config');
  assert.equal(cfg.mode, 'live', `the key alone switches scans to the tenant\n${log}`);
  assert.match(log, /mode: live \(automatic\).*AI Triage & Remediation: simulated/);
  // No fictional demo profiles at a live event.
  assert.deepEqual(await api('GET', '/api/profiles/search?q=ad'), []);

  const reg = await api('POST', '/api/sessions', { name: 'Ada Lovelace', email: 'ada@acme.example', technicalName: 'Charles Babbage', technicalEmail: 'charles@acme.example', contacts: [{ name: 'A', email: 'a@acme.example' }, { name: 'B', email: 'b@acme.example' }], githubUrl: 'https://github.com/acme/webshop', consent: true, inviteNow: false });
  const get = () => api('GET', `/api/sessions/${reg.id}?k=${reg.accessKey}`);
  const profile = await waitFor(async () => { const s = await get(); return s.stage === 'profile' ? s : null; }, { label: 'profile' });
  assert.equal(profile.options.source, 'tenant', 'scan options come from the tenant');
  await api('POST', `/api/sessions/${reg.id}/start`, { k: reg.accessKey, fusion: true, llmModel: 'opus-5.5' });
  const done = await waitFor(async () => { const s = await get(); if (s.stage === 'error') throw new Error(s.error); return s.stage === 'complete' ? s : null; }, { timeout: 60_000, label: 'scan' });

  // The report is the tenant's: the scan was started there and its results were read.
  assert.ok(mock.calls.some((c) => c.method === 'POST' && c.path === '/api/scans'));
  assert.ok(mock.calls.some((c) => c.path === '/api/results' && c.query['scan-id'] === mock.state.scanId));
  assert.equal(done.cx.demo, undefined, 'not a demo result');
  assert.equal(done.mode, 'live');
  assert.equal(done.assistSimulated, true);
  assert.equal(done.summary.fusionOnly, 4);
  assert.equal(done.loc, 23456, 'lines of code read from sast-metadata, for the Fusion credits');
  assert.equal(cfg.impact.triageMinutes, 20, 'Business impact settings reach the page');

  // AI Triage: simulated on those real findings, with no call to Checkmarx One AI.
  await api('POST', `/api/sessions/${reg.id}/assist/triage`, { k: reg.accessKey, scope: 'fusion' });
  const triaged = await waitFor(async () => { const s = await get(); return s.assist?.triage?.status === 'done' ? s : null; }, { label: 'simulated triage' });
  assert.equal(triaged.assist.triage.simulated, true);
  assert.equal(Object.keys(triaged.assist.triage.items).length, 4);
  assert.ok(Object.keys(triaged.assist.triage.items).every((id) => done.fusionOnly.some((f) => f.id === id)), 'verdicts are about the real findings');
  assert.ok(!mock.calls.some((c) => c.path.startsWith('/api/ai-triage') || c.path.startsWith('/api/remediation')), 'no AI credits spent');
});
