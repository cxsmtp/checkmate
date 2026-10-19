import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'checkmate-assist-'));
const { triageFromBody, remediationFromBody, eligibility, scopeOf, SCOPES } = await import('../src/assist.js');
const { classify } = await import('../src/fusion.js');
const { demoResults } = await import('../src/demo.js');

test('AI Triage verdicts are read the way Checkmarx One returns them', () => {
  assert.equal(triageFromBody(null), null);
  assert.equal(triageFromBody({}), null);
  assert.equal(triageFromBody({ jobStatus: 'IN_PROGRESS' }).verdict, 'IN_PROGRESS');
  const t = triageFromBody({ triageStatus: 'VULNERABLE', analysis: { confidence: { score: '0.93' }, reachability: { status: 'REACHABLE' }, exploitability: { status: 'EXPLOITABLE', reason: 'Input reaches the query.' } } });
  assert.deepEqual(t, { verdict: 'VULNERABLE', reachability: 'REACHABLE', exploitability: 'EXPLOITABLE', confidence: '0.93', reason: 'Input reaches the query.' });
});

test('AI Remediation details: running, failed, or the fix with its file changes', () => {
  assert.equal(remediationFromBody({ results: [] }), null);
  assert.equal(remediationFromBody({ results: [{ jobStatus: 'IN_PROGRESS', data: {} }] }), null);
  assert.deepEqual(remediationFromBody({ results: [{ jobStatus: 'FAILED', data: { error: 'no fix' } }] }), { failed: 'no fix' });
  const fix = remediationFromBody({ results: [{ finishedAt: 'now', data: { summary: 'Bind the parameter', analysis: { how: 'placeholder', why: 'safer' }, file_changes: [{ file_path: 'src/db.js', diff: '@@ -1,1 +1,1 @@\n-a\n+b\n' }] }, autoPr: { url: 'https://github.com/acme/x/pull/4' } }] });
  assert.equal(fix.summary, 'Bind the parameter');
  assert.equal(fix.files, 1);
  assert.equal(fix.changes[0].path, 'src/db.js');
  assert.equal(fix.prUrl, 'https://github.com/acme/x/pull/4');
  assert.equal(remediationFromBody({ results: [{ finishedAt: 'now', data: { summary: 'x' }, autoPr: { url: 'javascript:alert(1)' } }] }).prUrl, '');
});

test('scopes: Fusion-only, critical and high, everything — SAST and SCA only', () => {
  const { fusionOnly, others } = classify(demoResults());
  const session = { fusionOnly, others };
  const counts = Object.fromEntries(Object.keys(SCOPES).map((k) => [k, scopeOf(session, k).length]));
  assert.equal(counts.fusion, 4);
  assert.ok(counts['critical-high'] >= counts.fusion);
  assert.ok(counts.all > counts['critical-high']);
  assert.ok(scopeOf(session, 'all').every((f) => ['sast', 'sca'].includes(f.underlyingType)));
  assert.match(eligibility(others.find((f) => f.engine === 'kics')).reason, /SAST and SCA/);
});
