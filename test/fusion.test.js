import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, isFusionResult, normalize, sameIssue } from '../src/fusion.js';
import { demoResults } from '../src/demo.js';
import { buildScanConfig } from '../src/checkmarx.js';

test('detects Fusion results by type or engine field', () => {
  assert.equal(isFusionResult({ type: 'fusion' }), true);
  assert.equal(isFusionResult({ type: 'sast', data: { engine: 'Fusion' } }), true);
  assert.equal(isFusionResult({ type: 'sast', data: {} }), false);
});

test('normalizes SAST, SCA and KICS results', () => {
  const [sast] = demoResults().filter((r) => r.id === 'sast-001').map(normalize);
  assert.equal(sast.engine, 'sast');
  assert.equal(sast.file, 'src/routes/search.js');
  assert.equal(sast.sinkFile, 'src/db/products.js');
  assert.equal(sast.cwe, '89');
  const [sca] = demoResults().filter((r) => r.type === 'sca').map(normalize);
  assert.equal(sca.engine, 'sca');
  assert.equal(sca.recommendedVersion, '4.19.2');
  const [kics] = demoResults().filter((r) => r.type === 'kics').map(normalize);
  assert.equal(kics.engine, 'kics');
  assert.equal(kics.file, 'infra/storage.tf');
});

test('sameIssue matches by file, weakness and nearby line', () => {
  const a = { file: 'src/a.js', line: 10, cwe: '89', title: 'x' };
  assert.equal(sameIssue(a, { file: 'src/a.js', line: 12, cwe: '89', title: 'y' }), true);
  assert.equal(sameIssue(a, { file: 'src/x.js', line: 1, sinkFile: 'src/a.js', sinkLine: 11, cwe: '89', title: 'y' }), true);
  assert.equal(sameIssue(a, { file: 'src/a.js', line: 30, cwe: '89', title: 'x' }), false);
  assert.equal(sameIssue(a, { file: 'src/b.js', line: 10, cwe: '89', title: 'x' }), false);
});

test('classify puts Fusion-only findings first and flags corroborated ones', () => {
  const raw = demoResults();
  // fus-005 reports the SQL injection at its sink (products.js:23); SAST reports the same flow from its source.
  const { fusionOnly, others, summary } = classify(raw);
  assert.deepEqual(fusionOnly.map((f) => f.id), ['fus-001', 'fus-003', 'fus-002', 'fus-004']); // severity, then title
  assert.ok(fusionOnly.every((f) => f.fusionOnly));
  assert.equal(others.find((f) => f.id === 'sast-001').confirmedByFusion, true);
  assert.equal(summary.fusionOnly, 4);
  assert.equal(summary.total, raw.length - 1);
  assert.equal(summary.confirmedByFusion, 1);
  assert.equal(others[0].severity, 'HIGH');
});

test('scan config merges Fusion settings into engine entries', () => {
  const cfg = buildScanConfig();
  assert.ok(cfg.find((c) => c.type === 'sast'));
});

test('template explanations fit the finding type', async () => {
  const { templateExplanation } = await import('../src/knowledge.js');
  const { fusionOnly } = classify(demoResults());
  const reset = fusionOnly.find((f) => f.id === 'fus-003');
  const ex = templateExplanation(reset);
  assert.match(ex.whatItMeans, /prove who they are/);
  assert.ok(ex.whyFusionFoundIt.length > 20);
});
