import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, isFusionResult, normalize, sameIssue } from '../src/fusion.js';
import { demoResults } from '../src/demo.js';
import { buildScanConfig } from '../src/checkmarx.js';

test('detects Fusion results: the verified fingerprint (queryId 0, CWE-title query, LANG_SEVERITY group), or a marker', () => {
  assert.equal(isFusionResult({ type: 'fusion' }), true);
  assert.equal(isFusionResult({ type: 'sast', data: { engine: 'Fusion' } }), true);
  // As seen on the tenant (project "Fusion Hub"): no description, queryId 0, group TSX_HIGH.
  assert.equal(isFusionResult({ type: 'sast', description: '', data: { queryId: 0, queryName: 'Improper Input Validation', group: 'TSX_HIGH' } }), true);
  // Classic SAST: a 64-bit queryId and a group like JavaScript_Low_Visibility.
  assert.equal(isFusionResult({ type: 'sast', data: { queryId: 7634211052344960000, queryName: 'Reflected_XSS_All_Clients', group: 'JavaScript_High_Risk' } }), false);
  assert.equal(isFusionResult({ type: 'sast', data: {} }), false);
  assert.equal(isFusionResult({ type: 'sast', data: { queryId: 0, queryName: 'Improper Input Validation', group: 'TSX_HIGH' } }, { queryIdZero: false, markers: ['fusion'] }), false);
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
  // Severity first; within a severity the order is stable.
  assert.deepEqual(fusionOnly.map((f) => f.severity), ['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM']);
  assert.equal(fusionOnly[0].id, 'fus-001');
  assert.equal(fusionOnly.at(-1).id, 'fus-004');
  assert.ok(fusionOnly.every((f) => f.fusionOnly));
  assert.equal(others.find((f) => f.id === 'sast-001').confirmedByFusion, true);
  assert.equal(summary.fusionOnly, 4);
  assert.equal(summary.total, raw.length - 1);
  assert.equal(summary.confirmedByFusion, 1);
  assert.equal(others[0].severity, 'HIGH');
});

test('scan config: engines, the ai entry for Fusion and the tenant-verified keys', () => {
  const cfg = buildScanConfig({ engines: ['sast', 'sca'], fusion: true, llmModel: 'opus-5.5', presetName: 'ASA Premium', extendedAnalysis: true });
  const sast = cfg.find((c) => c.type === 'sast');
  assert.deepEqual(sast.value, { incremental: 'false', presetName: 'ASA Premium', extendedAnalysis: 'true' });
  assert.ok(cfg.find((c) => c.type === 'sca'));
  assert.deepEqual(cfg.find((c) => c.type === 'ai').value, { fusionEnabled: 'true', llmModel: 'opus-5.5' });
  const off = buildScanConfig({ engines: ['sast'], fusion: false, extendedAnalysis: false });
  assert.equal(off.find((c) => c.type === 'ai'), undefined);
  assert.deepEqual(off.find((c) => c.type === 'sast').value, { incremental: 'false' });
});

test('template explanations fit the finding type', async () => {
  const { templateExplanation } = await import('../src/knowledge.js');
  const { fusionOnly } = classify(demoResults());
  const reset = fusionOnly.find((f) => f.id === 'fus-003');
  const ex = templateExplanation(reset);
  // Fusion's own account of the finding is used as "what it means" when the result carries one.
  assert.equal(ex.whatItMeans, reset.fusionInsight);
  assert.ok(ex.whyFusionFoundIt.length > 20);
  assert.match(ex.businessImpact, /account takeover/i);
  const noInsight = templateExplanation({ ...reset, fusionInsight: '' });
  assert.match(noInsight.whatItMeans, /prove who they are/);
});
