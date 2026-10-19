/**
 * A sample repository whose results are already published on the tenant: they are read at once
 * (the Fusion scan, not a newer one without Fusion), and no new scan is needed while they are fresh.
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

test('samples: published Checkmarx One results are ready at once, Fusion scans first', { timeout: 60_000 }, async (t) => {
  const mock = await startMockCxOne();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-pub-'));
  const port = await freePort();
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', CX_API_KEY: mock.apiKey, CX_BASE_URL: mock.base, CX_IAM_URL: mock.base, CX_ALLOW_CUSTOM_HOST: 'true', CX_POLL_INTERVAL_MS: '150', CITY_PHOTOS_AUTO: 'false', ADMIN_PASSWORD: 'published-test-password', UPDATE_CHECK_MINUTES: '0', SAMPLES_AUTO_SCAN: 'true', SAMPLE_REUSE_HOURS: '0' };
  // Only the sample under test.
  fs.writeFileSync(path.join(dataDir, 'samples.json'), '[]');
  const child = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  t.after(async () => { child.kill('SIGTERM'); await mock.close(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100 && !(await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)); i++) await sleep(100);

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'published-test-password' }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, `signed in\n${log}`);
  const admin = (method, p, body) => fetch(`${base}/api/admin${p}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await admin('POST', '/samples', { name: 'Published', url: 'https://github.com/acme/published', branch: 'main' });

  let sample;
  for (let i = 0; i < 150; i++) {
    const list = await admin('GET', '/samples');
    assert.ok(Array.isArray(list), JSON.stringify(list));
    [sample] = list;
    if (sample?.latest?.live) break;
    await sleep(100);
  }
  assert.ok(sample.latest?.live, `published results ready\n${log}`);
  assert.equal(sample.run.project, 'team/published');
  assert.equal(sample.run.scanId, mock.state.scanId, 'the Fusion scan, not the newer one without Fusion');
  assert.equal(sample.latest.completedAt, '2026-10-17T10:06:00Z', 'dated by the scan, not by when it was read');
  assert.ok(!mock.calls.some((c) => c.method === 'POST' && c.path === '/api/scans'), 'no new scan while the published one is fresh');
  assert.match(log, /published results of team\/published/);
});
