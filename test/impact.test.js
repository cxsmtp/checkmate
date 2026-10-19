import test from 'node:test';
import assert from 'node:assert/strict';
import { computeImpact, regionFor, impactSettings, formatMoney, formatCompact } from '../public/impact.js';

const finding = (id, severity = 'HIGH') => ({ id, severity });
const four = [finding('a', 'CRITICAL'), finding('b'), finding('c'), finding('d', 'MEDIUM')];

const RATES = [{ currency: 'USD', hourly: 25, credit: 1 }, { currency: 'AED', hourly: 92, credit: 3.67 }, { currency: 'SGD', hourly: 34, credit: 1.35 }];

test('the region picks its own rate row; anyone else gets the first (USD 25 an hour, USD 1 a credit by default)', () => {
  assert.deepEqual([regionFor('dubai').currency, regionFor('dubai').hourly, regionFor('dubai').credit], ['USD', 25, 1], 'default: one USD row for everyone');
  const s = { rates: RATES };
  assert.equal(regionFor('dubai', '', s).currency, 'AED');
  assert.equal(regionFor('dubai', '', s).hourly, 92);
  assert.equal(regionFor('singapore', '', s).credit, 1.35);
  assert.equal(regionFor('melbourne', '', s).currency, 'USD', 'no AUD row: the first row');
  assert.equal(regionFor(null, 'en-SG', s).currency, 'SGD');
  assert.equal(regionFor({ key: 'abu-dhabi-ae', name: 'Abu Dhabi', countryCode: 'AE' }, '', s).currency, 'AED');
  assert.equal(regionFor({ key: 'riyadh-sa', name: 'Riyadh', countryCode: 'SA' }, '', s).label, 'Riyadh');
});

test('MZ arithmetic at the default rates: hours by hand × USD 25, the release multiple, 1 + 3 credits at USD 1', () => {
  const im = computeImpact({ findings: four, region: regionFor('dubai') });
  // 4 × 20 min triage; 4 × 70% real × 120 min fix
  assert.equal(im.hours.triage, 1.3);
  assert.equal(im.hours.fix, 5.6);
  assert.equal(im.rate, 25);
  assert.equal(im.money.timeValue, Math.round((80 / 60 + 5.6) * 25));
  assert.equal(im.money.avoided, Math.round(5.6 * 25 * 5));
  assert.deepEqual([im.credits.triage, im.credits.remediation, im.credits.fusion], [4, 9, 0]);
  assert.equal(im.money.cost, 13, '13 credits × USD 1');
  assert.equal(im.money.net, im.money.gross - 13);
  assert.ok(im.roi > 10);
});

test('AI Triage verdicts replace the assumed false positives; credits per step and Fusion LOC as set', () => {
  const verdicts = { a: { verdict: 'VULNERABLE' }, b: { verdict: 'NOT_EXPLOITABLE' }, c: { verdict: 'PROPOSED_NOT_EXPLOITABLE' }, d: { verdict: 'CONFIRMED' } };
  const settings = { rates: RATES, fusionCreditsPer10k: 10, triageCredits: 2, remediationCredits: 5 };
  const im = computeImpact({ findings: four, verdicts, loc: 23456, settings, region: regionFor('dubai', '', settings) });
  assert.equal(im.truePositives, 2);
  assert.equal(im.triaged, 4);
  assert.equal(im.credits.fusion, 30, '3 units of 10K lines × 10');
  assert.equal(im.credits.total, 8 + 10 + 30);
  assert.equal(im.money.cost, Math.round(48 * 3.67));
  assert.equal(im.rate, 92);
  assert.equal(im.currency, 'AED');
});

test('repositories like this one scale every figure', () => {
  const one = computeImpact({ findings: four });
  const fifty = computeImpact({ findings: four, repos: 50 });
  assert.ok(Math.abs(fifty.money.gross - one.money.gross * 50) <= 50, 'fifty times the saving, give or take rounding');
  assert.equal(fifty.credits.triage, 200);
  assert.ok(fifty.hours.total > one.hours.total * 49);
});

test('settings are cleaned; amounts are written in their currency', () => {
  const s = impactSettings({ fpPercent: 400, releaseMultiplier: 0, triageMinutes: -1 });
  assert.equal(s.fpPercent, 100);
  assert.equal(s.releaseMultiplier, 1);
  assert.equal(s.triageMinutes, 20);
  assert.equal(formatMoney(48000, 'AED'), 'AED\u00a048,000');
  assert.equal(formatMoney(9000, 'SGD'), 'SGD\u00a09,000');
  assert.equal(formatMoney(12500, 'USD'), '$12,500');
  assert.equal(formatCompact(1_250_000, 'USD'), '$1.3M');
  assert.equal(formatMoney(null, 'USD'), '—');
});

test('every Fusion-only finding carries why the rules missed it and why Fusion found it', async () => {
  const { explainFindings } = await import('../src/explain.js');
  const fusionOnly = [{ id: 'f1', fusionOnly: true, title: 'Missing Authorization', cwe: '862', severity: 'HIGH', file: 'a.ts', line: 3, nodes: [{ fileName: 'a.ts' }, { fileName: 'b.ts' }], fusionInsight: 'The id comes from the URL.' }, { id: 'f2', fusionOnly: true, title: 'Something new', severity: 'MEDIUM' }];
  explainFindings(fusionOnly, [{ id: 'o', title: 'SQL Injection', cwe: '89', severity: 'HIGH' }], { engines: ['sast', 'sca'], llmModel: 'opus-5.5' });
  for (const f of fusionOnly) {
    assert.ok(f.explanation.whyMissed.length > 40);
    assert.ok(f.explanation.whyCaught.length > 40);
    assert.match(f.explanation.evidence[0], /Rule-based scanning ran on the same code/);
  }
  assert.match(fusionOnly[0].explanation.whyMissed, /absence/);
  assert.match(fusionOnly[0].explanation.whyCaught, /In Fusion's words: The id comes from the URL\./);
});

test('rate rows are cleaned: bad or repeated currencies dropped, never empty', async () => {
  const { cleanRates } = await import('../public/impact.js');
  assert.deepEqual(cleanRates([{ currency: 'aed', hourly: 92, credit: 3.67 }, { currency: 'AED', hourly: 1, credit: 1 }, { currency: 'XX', hourly: 1, credit: 1 }, { currency: 'EUR', hourly: -1, credit: 1 }]), [{ currency: 'AED', hourly: 92, credit: 3.67 }]);
  assert.deepEqual(cleanRates([]), [{ currency: 'USD', hourly: 25, credit: 1 }]);
});
