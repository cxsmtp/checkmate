import test from 'node:test';
import assert from 'node:assert/strict';
import { boardModel, exposureScore } from '../public/board.js';

const f = (id, severity, fusionOnly = true) => ({ id, severity, fusionOnly });
const session = {
  createdAt: '2026-10-19T10:00:00Z', completedAt: '2026-10-19T10:06:00Z',
  repo: { owner: 'acme', repo: 'webshop' }, customer: { name: 'Ada', company: 'Acme Retail' }, technical: { name: 'Charles' },
  fusionOnly: [f('a', 'CRITICAL'), f('b', 'HIGH'), f('c', 'HIGH'), f('d', 'MEDIUM')], others: [f('x', 'HIGH', false), f('y', 'LOW', false)],
  outcome: { blindSpots: [{ label: 'Access control & authorisation' }] }, profile: { llmModel: 'opus-5.5' }, source: { live: true, tenant: 'acme', scan: '1a2b3c4d' },
  assist: {
    triage: { status: 'done', finishedAt: '2026-10-19T10:08:00Z', items: { a: { status: 'done', verdict: 'VULNERABLE' }, b: { status: 'done', verdict: 'CONFIRMED' }, c: { status: 'done', verdict: 'VULNERABLE' }, d: { status: 'done', verdict: 'PROPOSED_NOT_EXPLOITABLE' } } },
    remediation: { status: 'done', finishedAt: '2026-10-19T10:12:00Z', summary: { fixed: 3, files: 3 }, items: { a: { status: 'done' }, b: { status: 'done' }, c: { status: 'done' } } },
  },
};

test('the board brief: unknowns found, proven, fixed, exposure down, cost and return at the default rates', () => {
  const b = boardModel({ session });
  assert.match(b.headline, /^Checkmarx Fusion uncovered 4 risks in acme\/webshop that rule-based scanning could not see — 3 critical or high — and had 3 fixes ready within 12 minutes\.$/);
  assert.deepEqual(b.kpis.map((k) => k.value).slice(0, 3), ['4', '3', '3']);
  assert.equal(b.kpis[1].note, '1 set aside as noise');
  assert.ok(b.exposure.after < b.exposure.before, 'exposure falls once the fixes and the noise are taken out');
  assert.equal(b.exposure.after, exposureScore([f('x', 'HIGH'), f('y', 'LOW')]));
  assert.equal(b.cost.credits, 4 + 3 * 3, '1 credit per triage, 3 per fix');
  assert.equal(b.cost.creditCost, '$13');
  assert.equal(b.currency, 'USD');
  assert.ok(b.cost.roi > 1);
  assert.ok(b.live);
  assert.equal(b.process.filter((p) => p.at).length, 4, 'scanned, found, proven, fixed — not yet sent');
  assert.match(b.recommendations[0], /^Extend Fusion across the portfolio: 50 applications like this one would save about \$/);
});

test('nothing Fusion-only: the brief says so plainly', () => {
  const b = boardModel({ session: { ...session, fusionOnly: [], assist: {} } });
  assert.match(b.headline, /confirmed what rule-based scanning reported: no unknown risks this time/);
});
