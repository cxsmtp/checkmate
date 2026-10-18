import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-profiles-'));
const profiles = await import('../src/profiles.js');
const { settingsFromEnv, parseEnvText } = await import('../src/env-import.js');

test('profiles: create, search by two letters, pick with the team, CSV round trip', () => {
  const { profile } = profiles.create({ name: 'Ada Lovelace', email: 'ADA@acme.example', company: 'Acme Retail', title: 'CISO', team: [{ name: 'Ops', email: 'ops@acme.example' }] });
  assert.equal(profile.email, 'ada@acme.example');
  assert.ok(profiles.create({ name: 'Dup', email: 'ada@acme.example' }).errors.email);
  const hits = profiles.search('ac');
  assert.ok(hits.some((h) => h.name === 'Ada Lovelace'));
  assert.ok(!JSON.stringify(hits).includes('@'), 'search results carry no email addresses');
  const picked = profiles.forRegistration(profile.id);
  assert.equal(picked.team[0].email, 'ops@acme.example');
  const csv = profiles.exportCsv();
  assert.match(csv, /Ada Lovelace/);
  const r = profiles.importCsv('Full name,Work email,Organisation,Job title,Colleagues\nGrace Hopper,grace@harbor.example,Harbor,VP Eng,"a@harbor.example; b@harbor.example"\nAda Lovelace,ada@acme.example,Acme Retail,CISO,\n,nobody,,,\n');
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(profiles.byEmail('grace@harbor.example').team.length, 2);
  assert.ok(profiles.remove(profile.id));
});

test('.env import maps the variables an administrator would paste, and nothing else', () => {
  const vars = parseEnvText('CX_API_KEY=abc\nSMTP_HOST=mail.example.com\nSMTP_PASSWORD=pw\nexport SMTP_FROM_ADDRESS="booth@example.com"\nUNRELATED=1\n# comment\n');
  const { patch, applied, ignored } = settingsFromEnv(vars);
  assert.equal(patch['checkmarx.apiKey'], 'abc');
  assert.equal(patch['smtp.pass'], 'pw');
  assert.equal(patch['smtp.from'], 'booth@example.com');
  assert.deepEqual(ignored, ['UNRELATED']);
  assert.equal(applied.length, 4);
});
