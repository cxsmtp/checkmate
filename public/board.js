// The board brief: one page a CISO can put in front of the board. Built from the outcome, the AI
// Triage and AI Remediation runs and the business impact; shared by the page (public/app.js, which
// prints it) and the email (src/mailer.js). Pure data, no DOM.

import { computeImpact, regionFor, formatMoney, formatCompact } from './impact.js';

const WEIGHT = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 0.5, INFO: 0 };

/** 0–100: how much attention a set of findings needs (saturates: one critical and a few highs is already serious). */
export function exposureScore(findings) {
  const raw = findings.reduce((n, f) => n + (WEIGHT[f.severity] ?? 0), 0);
  return Math.round(100 * (1 - Math.exp(-raw / 60)));
}
export const exposureBand = (score) => (score >= 75 ? 'Critical' : score >= 45 ? 'High' : score >= 15 ? 'Moderate' : 'Low');

const SAFE = new Set(['NOT_EXPLOITABLE', 'PROPOSED_NOT_EXPLOITABLE', 'RISK_ACCEPTED']);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutesBetween = (a, b) => (a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);

/**
 * Everything the brief says, worked out once. `session`: the visitor's session (as the page gets it);
 * `settings`: the business-impact settings; `place`: the visitor's city (for the currency).
 */
export function boardModel({ session: s, settings = {}, place = null, locale = '', appName = 'Checkmate' }) {
  const all = [...(s.fusionOnly ?? []), ...(s.others ?? [])];
  const fusion = s.fusionOnly ?? [];
  const tri = s.assist?.triage ?? {};
  const rem = s.assist?.remediation ?? {};
  const verdicts = tri.items ?? {};
  const fixedIds = new Set(Object.entries(rem.items ?? {}).filter(([, i]) => i.status === 'done').map(([id]) => id));
  const safeIds = new Set(Object.entries(verdicts).filter(([, v]) => SAFE.has(v.verdict)).map(([id]) => id));

  const serious = fusion.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length;
  const proven = Object.values(verdicts).filter((v) => v.status === 'done' && !SAFE.has(v.verdict) && v.verdict !== 'UNCERTAIN').length;
  const setAside = Object.values(verdicts).filter((v) => SAFE.has(v.verdict)).length;
  const before = exposureScore(all);
  const after = exposureScore(all.filter((f) => !fixedIds.has(f.id) && !safeIds.has(f.id)));

  const region = regionFor(place ?? s.place ?? s.theme ?? null, locale, settings);
  const im = computeImpact({ findings: fusion, verdicts, loc: s.loc, settings, region });
  const portfolio = computeImpact({ findings: fusion, verdicts, loc: s.loc, settings, region, repos: 50 });
  const money = (n) => formatMoney(n, im.currency, im.locale);
  const big = (n) => formatCompact(n, im.currency, im.locale);

  const started = s.createdAt;
  const fixedAt = rem.finishedAt || null;
  const minutes = minutesBetween(started, fixedAt || s.completedAt);
  const repo = s.repo ? `${s.repo.owner}/${s.repo.repo}` : 'the application';
  const company = s.customer?.company || s.customer?.name || 'Your organisation';
  const themes = (s.outcome?.blindSpots ?? []).map((t) => t.label.toLowerCase());
  const model = s.profile?.llmModel || '';

  const headline = fusion.length
    ? `Checkmarx Fusion uncovered ${plural(fusion.length, 'risk')} in ${repo} that rule-based scanning could not see${serious ? ` — ${serious} critical or high` : ''}${fixedIds.size ? ` — and had ${plural(fixedIds.size, 'fix', 'fixes')} ready${minutes ? ` within ${plural(minutes, 'minute')}` : ''}.` : '.'}`
    : `Checkmarx Fusion reviewed ${repo} end to end and confirmed what rule-based scanning reported: no unknown risks this time.`;

  const process = [
    { step: 'Scanned', what: `${repo} on Checkmarx One${s.source?.live ? '' : ' (demo)'}`, at: started },
    { step: 'Unknowns found', what: `${plural(fusion.length, 'risk')} only Fusion saw${themes.length ? ` — ${themes.slice(0, 2).join(', ')}` : ''}`, at: s.completedAt },
    { step: 'Proven', what: tri.status ? `${proven} exploitable · ${setAside} set aside by AI Triage` : 'AI Triage pending', at: tri.finishedAt },
    { step: 'Fixed', what: rem.status ? `${plural(fixedIds.size, 'fix', 'fixes')} written by AI Remediation` : 'AI Remediation pending', at: rem.finishedAt },
    { step: 'With developers', what: s.assist?.sent?.length ? `sent to ${s.technical?.name || 'the technical owner'}` : `ready for ${s.technical?.name || 'the technical owner'}`, at: s.assist?.sent?.at(-1)?.at },
  ];

  return {
    appName,
    company,
    repo,
    date: s.completedAt || new Date().toISOString(),
    live: Boolean(s.source?.live),
    tenant: s.source?.tenant || '',
    scan: s.source?.scan || '',
    model,
    headline,
    why: [
      'Frontier AI models now let attackers find the flaws no rule describes — broken access control, business-logic abuse, unsafe flows across services — at machine speed.',
      `Checkmarx Fusion puts the same class of models on your side${model ? ` (${model})` : ''}: it reasons about how the application behaves and finds those risks first.`,
      'AI Triage proves which are exploitable and AI Remediation writes the fixes, so the backlog shrinks instead of growing — on one platform.',
    ],
    kpis: [
      { label: 'Unknown risks uncovered', value: String(fusion.length), note: serious ? `${serious} critical or high` : 'none critical or high' },
      { label: 'Proven exploitable', value: tri.status === 'done' ? String(proven) : '—', note: tri.status === 'done' ? `${setAside} set aside as noise` : 'AI Triage pending' },
      { label: 'Fixes ready', value: String(fixedIds.size), note: rem.summary ? `${plural(rem.summary.files ?? 0, 'file')} changed` : 'AI Remediation pending' },
      { label: 'Saved, after credits', value: big(im.money.net), note: `${im.hours.total} engineering hours back` },
    ],
    exposure: { before, after, beforeBand: exposureBand(before), afterBand: exposureBand(after) },
    cost: {
      hours: im.hours.total,
      gross: money(im.money.gross),
      credits: im.credits.total,
      creditCost: formatMoney(im.money.cost ?? 0, im.currency, im.locale, 2),
      net: money(im.money.net),
      roi: im.roi,
      rate: money(im.rate),
    },
    process,
    minutes,
    recommendations: [
      `Extend Fusion across the portfolio: 50 applications like this one would save about ${big(portfolio.money.net)} and ${Math.round(portfolio.hours.total).toLocaleString('en-US')} engineering hours.`,
      'Make AI Triage and AI Remediation the default path from finding to fix, so developers receive proven risks with the fix attached.',
      `Report AI-era exposure to the board each quarter: this application moved from ${before} (${exposureBand(before)}) to ${after} (${exposureBand(after)}).`,
    ],
    currency: im.currency,
  };
}
