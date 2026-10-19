import { SEVERITY_ORDER } from './fusion.js';

/**
 * The outcome: one verdict a CISO can repeat, computed from the findings alone
 * (no language model). It answers three questions in order: how exposed is this
 * codebase, what did Fusion see that rule-based scanning did not, and what to do first.
 */

const WEIGHT = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 0.5, INFO: 0 };

/** 0–100: how much attention this codebase needs today. */
export function exposureScore(all) {
  const raw = all.reduce((n, f) => n + (WEIGHT[f.severity] ?? 0), 0);
  // Saturates: 1 critical + a handful of highs is already serious.
  return Math.round(100 * (1 - Math.exp(-raw / 60)));
}

const band = (score) => (score >= 75 ? 'Critical' : score >= 45 ? 'High' : score >= 15 ? 'Moderate' : 'Low');

const THEMES = [
  { key: 'access', label: 'Access control & authorisation', cwes: ['284', '285', '639', '862', '863', '269', '640', '287', '306', '307', '384', '613'] },
  { key: 'injection', label: 'Injection', cwes: ['89', '77', '78', '94', '917', '611', '776'] },
  { key: 'web', label: 'Web client attacks', cwes: ['79', '80', '352', '601', '1021'] },
  { key: 'secrets', label: 'Secrets & credentials', cwes: ['798', '259', '321', '540', '312', '522'] },
  { key: 'crypto', label: 'Weak cryptography', cwes: ['326', '327', '328', '330', '338', '916', '759', '760'] },
  { key: 'data', label: 'Data exposure', cwes: ['200', '209', '532', '117', '215', '20'] },
  { key: 'logic', label: 'Business logic & race conditions', cwes: ['362', '367', '841', '799', '770'] },
  { key: 'files', label: 'Files & paths', cwes: ['22', '23', '36', '73', '434', '502'] },
  { key: 'ssrf', label: 'Server-side request forgery', cwes: ['918'] },
];

export function themeOf(f) {
  const cwe = String(f.cwe ?? '');
  const hit = cwe && THEMES.find((t) => t.cwes.includes(cwe));
  if (hit) return hit;
  if (f.engine === 'sca') return { key: 'supply', label: 'Vulnerable open-source packages' };
  if (f.engine === 'kics') return { key: 'cloud', label: 'Cloud & infrastructure configuration' };
  if (f.engine === 'secrets') return THEMES[3];
  if (f.engine === 'containers') return { key: 'containers', label: 'Container images' };
  return { key: 'other', label: 'Other weaknesses' };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sevCount = (list) => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, list.filter((f) => f.severity === s).length]));

/**
 * @param fusionOnly  findings only Fusion reported
 * @param others      every rule-based finding (confirmedByFusion set where Fusion agreed)
 * @param profile     the scan profile that ran (engines, fusion, llmModel)
 */
export function buildOutcome(fusionOnly, others, { profile = {}, repoName = 'this repository' } = {}) {
  const all = [...fusionOnly, ...others];
  const score = exposureScore(all);
  const sev = sevCount(all);
  const fusionSev = sevCount(fusionOnly);
  const confirmed = others.filter((f) => f.confirmedByFusion).length;
  const seriousFusion = fusionSev.CRITICAL + fusionSev.HIGH;

  // Themes, Fusion-only first: what kind of risk the rule-based engines were blind to.
  const themeMap = new Map();
  for (const f of all) {
    const t = themeOf(f);
    const row = themeMap.get(t.key) ?? { key: t.key, label: t.label, total: 0, fusionOnly: 0, worst: 'INFO' };
    row.total += 1;
    if (f.fusionOnly) row.fusionOnly += 1;
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(row.worst)) row.worst = f.severity;
    themeMap.set(t.key, row);
  }
  const themes = [...themeMap.values()].sort((a, b) => b.fusionOnly - a.fusionOnly || SEVERITY_ORDER.indexOf(a.worst) - SEVERITY_ORDER.indexOf(b.worst) || b.total - a.total);
  const blindSpots = themes.filter((t) => t.fusionOnly).slice(0, 3);

  let headline;
  if (!all.length) headline = `No security findings were reported for ${repoName} on this scan.`;
  else if (fusionOnly.length) headline = `${plural(fusionOnly.length, 'risk')} in ${repoName} that rule-based scanning could not see${seriousFusion ? ` — ${seriousFusion} critical or high` : ''}. Every one can be triaged and fixed with AI today.`;
  else headline = `Fusion agreed with the rule-based engines on ${repoName}: ${plural(all.length, 'finding')}, none that only Fusion saw.`;

  const verdict = !all.length
    ? 'Nothing to act on from this scan. Keep Fusion on for the next change: logic flaws usually arrive with new features.'
    : fusionOnly.length
      ? `${blindSpots.length ? `Rule-based scanning was blind to ${blindSpots.map((t) => t.label.toLowerCase()).join(', ')}. ` : ''}Fusion found them by reasoning about how the application behaves; AI Triage proves which are exploitable and AI Remediation writes the fixes — on the same platform, in minutes.`
      : `${confirmed ? `Fusion independently confirmed ${plural(confirmed, 'rule-based finding')}, which raises confidence they are real. ` : ''}Every issue here is one the rules can describe; review the critical and high ones first.`;

  const firstMoves = [];
  if (fusionOnly.length) firstMoves.push(`Walk the ${plural(fusionOnly.length, 'Fusion-only finding')} with the engineering owner this week — they are the ones no other tool has told you about.`);
  if (sev.CRITICAL) firstMoves.push(`Fix the ${plural(sev.CRITICAL, 'critical finding')} before the next release.`);
  if (others.some((f) => f.engine === 'secrets')) firstMoves.push('Rotate every exposed secret today and move it to a secrets manager.');
  if (others.some((f) => f.engine === 'sca' && f.recommendedVersion)) firstMoves.push('Upgrade the open-source packages that already have a fixed version.');
  if (confirmed) firstMoves.push(`Start with the ${plural(confirmed, 'finding')} both engines agree on: highest confidence, no triage needed.`);
  firstMoves.push(`Put ${profile.fusion === false ? 'Checkmarx One' : 'Checkmarx One with Fusion'} in the pipeline for ${repoName} so the next change is scanned the same way.`);

  return {
    headline,
    verdict,
    exposure: { score, band: band(score) },
    counts: { total: all.length, fusionOnly: fusionOnly.length, confirmedByFusion: confirmed, bySeverity: sev, fusionOnlyBySeverity: fusionSev },
    blindSpots,
    themes: themes.slice(0, 8),
    firstMoves: firstMoves.slice(0, 4),
    scanned: {
      engines: profile.engines ?? [],
      fusion: profile.fusion !== false,
      llmModel: profile.llmModel ?? '',
    },
  };
}
