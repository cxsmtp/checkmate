import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every module here keeps its state under DATA_DIR: give this test its own.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-admin-'));
const { isAllowedCheckmarxUrl, saveSettings, publicSettings, config } = await import('../src/config.js');
const samples = await import('../src/samples.js');
const auth = await import('../src/admin-auth.js');
const { validateRegistration } = await import('../src/validation.js');

test('Checkmarx One credentials only go to https addresses on checkmarx.net', () => {
  assert.equal(isAllowedCheckmarxUrl('https://ast.checkmarx.net'), true);
  assert.equal(isAllowedCheckmarxUrl('https://eu.iam.checkmarx.net'), true);
  assert.equal(isAllowedCheckmarxUrl('http://ast.checkmarx.net'), false);
  assert.equal(isAllowedCheckmarxUrl('https://checkmarx.net.evil.com'), false);
  assert.equal(isAllowedCheckmarxUrl('https://evilcheckmarx.net'), false);
  assert.equal(isAllowedCheckmarxUrl('not a url'), false);
  assert.equal(isAllowedCheckmarxUrl('http://127.0.0.1:8080', true), true, 'a local stand-in, only when custom hosts are allowed');
  assert.equal(isAllowedCheckmarxUrl('http://127.0.0.1:8080', false), false);
  assert.equal(isAllowedCheckmarxUrl('http://10.0.0.5', true), false, 'plain http never leaves the machine');
});

test('settings: validated, secrets never returned, blank secret keeps the stored one', () => {
  assert.ok(saveSettings({ 'checkmarx.baseUrl': 'https://attacker.example.com' }).errors['checkmarx.baseUrl']);
  assert.equal(config.checkmarx.baseUrl, '', 'nothing is stored when a value is refused');
  // A key that is not a Checkmarx One JWT is kept but reported as unusable (the connection is derived from the key).
  const saved = saveSettings({ 'checkmarx.apiKey': 'secret-key', 'checkmarx.tenant': 'acme', mode: 'live' });
  assert.ok(saved.ok);
  assert.ok(saved.connectionError, 'a non-JWT key cannot yield a connection');
  assert.equal(config.connection, null);
  assert.deepEqual(publicSettings()['checkmarx.apiKey'], { set: true });
  assert.ok(!JSON.stringify(publicSettings()).includes('secret-key'));
  saveSettings({ 'checkmarx.apiKey': '' });
  assert.equal(config.checkmarx.apiKey, 'secret-key');
  assert.equal(config.mode, 'live');
  assert.ok(saveSettings({ mode: 'sideways' }).errors.mode);
  const mode = fs.statSync(path.join(process.env.DATA_DIR, 'settings.json')).mode & 0o777;
  assert.equal(mode, 0o600);
  saveSettings({ mode: 'demo' });
});

test('sample repositories: seeded, validated, reused only while fresh', () => {
  const seeded = samples.list();
  assert.ok(seeded.length >= 3);
  assert.ok(samples.create({ name: 'x', url: 'https://gitlab.com/a/b' }).errors.url);
  const { sample } = samples.create({ name: 'Demo', url: 'https://github.com/acme/demo.git', branch: 'main' });
  assert.equal(sample.url, 'https://github.com/acme/demo');
  assert.equal(samples.reusable(sample), null);
  assert.equal(samples.needsScan(sample), true, 'a new sample is scanned at once');
  samples.recordScan(sample.id, 'abc', new Date().toISOString());
  assert.equal(samples.reusable(samples.get(sample.id)).sessionId, 'abc');
  assert.equal(samples.needsScan(samples.get(sample.id)), false, 'fresh results are ready');
  samples.recordScan(sample.id, 'old', new Date(Date.now() - 200 * 3_600_000).toISOString());
  assert.equal(samples.reusable(samples.get(sample.id)).sessionId, 'old', 'older results are still shown at once');
  assert.equal(samples.needsScan(samples.get(sample.id)), true, '…while a fresh scan is started');
  // Changing the repository drops results that no longer apply.
  samples.recordScan(sample.id, 'abc', new Date().toISOString());
  samples.update(sample.id, { url: 'https://github.com/acme/other' });
  assert.equal(samples.get(sample.id).latest, undefined);
  samples.update(sample.id, { enabled: false });
  assert.ok(!samples.publicList().some((s) => s.id === sample.id));
  assert.ok(samples.remove(sample.id));
});

test('registration with a sample: no own URL or consent needed; disabled samples refused', () => {
  const [sample] = samples.list();
  const base = {
    name: 'Ada', email: 'ada@example.com', technicalName: 'Grace', technicalEmail: 'grace@example.com',
    contacts: [{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }],
  };
  const { value, errors } = validateRegistration({ ...base, sampleId: sample.id, githubUrl: 'https://github.com/ignored/repo' }, { getSample: samples.get });
  assert.equal(errors, undefined);
  assert.equal(value.repo.url, sample.url);
  assert.equal(value.sampleId, sample.id);
  const gone = validateRegistration({ ...base, sampleId: '00000000-0000-0000-0000-000000000000' }, { getSample: samples.get });
  assert.ok(gone.errors.sampleId);
  assert.ok(validateRegistration(base, { getSample: samples.get }).errors.consent);
});

test('admin password: generated once, hashed, changeable, resettable', () => {
  const quiet = { log: () => {} };
  const first = auth.ensureAdmin(quiet);
  assert.ok(first.length >= 20);
  assert.equal(auth.ensureAdmin(quiet), null, 'not created twice');
  assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'admin.json'), 'utf8').includes(first));
  assert.equal(auth.verifyPassword(first), true);
  assert.equal(auth.verifyPassword('wrong'), false);
  assert.throws(() => auth.setPassword('short'));
  auth.setPassword('a much longer password');
  assert.equal(auth.verifyPassword(first), false);
  assert.equal(auth.firstStart(), false);
  const reset = auth.resetAdmin();
  assert.equal(auth.verifyPassword(reset), true);
});

test('mode: automatic follows the key; AI Triage & Remediation live only when switched on and scans are live', async () => {
  const { isLive, assistLive } = await import('../src/config.js');
  saveSettings({ mode: 'auto', 'assist.mode': 'live' });
  assert.equal(config.connection, null);
  assert.equal(isLive(), false, 'no usable key: the demo');
  assert.equal(assistLive(), false, 'never live AI on simulated scans');
  saveSettings({ mode: 'live', 'assist.mode': 'simulated' });
  assert.equal(isLive(), true);
  assert.equal(assistLive(), false, 'simulated unless switched on');
  saveSettings({ 'assist.mode': 'live' });
  assert.equal(assistLive(), true);
  assert.ok(saveSettings({ 'assist.mode': 'sometimes' }).errors['assist.mode']);
  saveSettings({ mode: 'demo', 'assist.mode': 'simulated' });
  assert.equal(config.mode, 'auto', '"demo" from an older .env reads as automatic: a connected key always scans for real');
});

test('samples: a demo result is never reused for a live visitor', () => {
  const { sample } = samples.create({ name: 'Mode', url: 'https://github.com/acme/mode' });
  samples.recordScan(sample.id, 'demo-run', new Date().toISOString(), false);
  assert.equal(samples.reusable(samples.get(sample.id)).sessionId, 'demo-run', 'demo for demo');
  saveSettings({ mode: 'live' });
  assert.equal(samples.reusable(samples.get(sample.id)), null, 'not for live');
  samples.recordScan(sample.id, 'live-run', new Date().toISOString(), true);
  assert.equal(samples.reusable(samples.get(sample.id)).sessionId, 'live-run');
  saveSettings({ mode: 'demo' });
  samples.remove(sample.id);
});
