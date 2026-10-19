import test from 'node:test';
import assert from 'node:assert/strict';
import { computeImpact, regionFor, impactSettings, formatMoney, formatCompact, REGIONAL_RATES } from '../public/impact.js';

const finding = (id, severity = 'HIGH') => ({ id, severity });
const four = [finding('a', 'CRITICAL'), finding('b'), finding('c'), finding('d', 'MEDIUM')];

test('the region follows the city, then the browser, then an administrator', () => {
  assert.equal(regionFor('dubai').currency, 'AED');
  assert.equal(regionFor('singapore').currency, 'SGD');
  assert.equal(regionFor('melbourne').currency, 'AUD');
  assert.equal(regionFor('new-york').currency, 'USD');
  assert.equal(regionFor(null, 'en-GB').currency, 'GBP');
  assert.equal(regionFor(null, 'de-DE').currency, 'EUR');
  assert.equal(regionFor(null, 'xx').currency, 'USD');
  assert.equal(regionFor('dubai', '', { currency: 'usd' }).currency, 'USD');
});

test('MZ arithmetic: hours by hand at the regional rate, the release multiple, 1 + 3 credits', () => {
  const im = computeImpact({ findings: four, region: regionFor('dubai') });
  // 4 × 20 min triage; 4 × 70% real × 120 min fix
  assert.equal(im.hours.triage, 1.3);
  assert.equal(im.hours.fix, 5.6);
  assert.equal(im.rate, REGIONAL_RATES.AED);
  assert.equal(im.money.timeValue, Math.round((80 / 60 + 5.6) * 250));
  assert.equal(im.money.avoided, Math.round(5.6 * 250 * 5));
  assert.equal(im.money.cost, null, 'credits not priced by default');
  assert.equal(im.money.net, im.money.gross);
  assert.deepEqual([im.credits.triage, im.credits.remediation, im.credits.fusion], [4, 9, 0]);
});

test('AI Triage verdicts replace the assumed false positives; credits priced and Fusion LOC counted when set', () => {
  const verdicts = { a: { verdict: 'VULNERABLE' }, b: { verdict: 'NOT_EXPLOITABLE' }, c: { verdict: 'PROPOSED_NOT_EXPLOITABLE' }, d: { verdict: 'CONFIRMED' } };
  const im = computeImpact({ findings: four, verdicts, loc: 23456, settings: { creditPrice: 2, fusionCreditsPer10k: 10, hourlyRate: 100 }, region: regionFor('boston') });
  assert.equal(im.truePositives, 2);
  assert.equal(im.triaged, 4);
  assert.equal(im.credits.fusion, 30, '3 units of 10K lines × 10');
  assert.equal(im.credits.total, 4 + 6 + 30);
  assert.equal(im.money.cost, 80);
  assert.equal(im.rateFrom, 'admin');
  assert.equal(im.money.net, im.money.gross - 80);
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
    assert.match(f.explanation.evidence[0], /SAST and SCA ran on the same code/);
  }
  assert.match(fusionOnly[0].explanation.whyMissed, /absence/);
  assert.match(fusionOnly[0].explanation.whyCaught, /In Fusion's words: The id comes from the URL\./);
});

test('any city: the currency follows its country; an unknown rate falls back to US dollars', () => {
  assert.equal(regionFor({ key: 'mumbai-in', name: 'Mumbai', countryCode: 'IN' }).currency, 'INR');
  assert.equal(regionFor({ key: 'berlin-de', name: 'Berlin', countryCode: 'DE' }).currency, 'EUR');
  assert.equal(regionFor({ key: 'riyadh-sa', name: 'Riyadh', countryCode: 'SA' }).label, 'Riyadh');
  assert.equal(regionFor({ key: 'reykjavik-is', name: 'Reykjavik', countryCode: 'IS' }).currency, 'USD');
  assert.equal(regionFor({ key: 'x', countryCode: 'IS' }, '', { currency: 'ISK', hourlyRate: 15000 }).currency, 'ISK');
});
