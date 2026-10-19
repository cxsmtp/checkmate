// Business impact: what finding and fixing these gaps is worth, in the visitor's own currency.
// The same arithmetic as CxMissionZero's Impact page and Cx Credits Calculator, shared by the
// outcome page (public/app.js) and the tests:
//
//   time saved   = findings × minutes to triage by hand + real findings × minutes to fix by hand,
//                  valued at the region's engineering hour (the administrator's rates table);
//   avoided      = what the real findings would have cost to fix after release: the same fix,
//                  `releaseMultiplier` times over (minus the fix itself, already counted above);
//   credits      = 1 per finding triaged, 3 per finding remediated, plus the Fusion scan
//                  (whole 10K-line units × credits per 10K LOC), at the region's credit price.
//
// Real findings: AI Triage's verdicts when it has run on them, otherwise the false-positive share
// the calculator assumes (30%). Every figure comes with the assumptions it used.

export const UNIT_LOC = 10000;
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * What an engineering hour and a Checkmarx One credit cost, per currency: set by the administrator
 * (Admin → Settings → Business impact). A visitor whose region has a row sees its currency; anyone
 * else sees the first row. Default: USD 25 an hour, USD 1 a credit.
 */
export const DEFAULT_RATES = Object.freeze([{ currency: 'USD', hourly: 25, credit: 1 }]);

export const IMPACT_DEFAULTS = Object.freeze({
  triageMinutes: 20,
  fixMinutes: 120,
  fpPercent: 30,
  releaseMultiplier: 6,
  triageCredits: 1,
  remediationCredits: 3,
  fusionCreditsPer10k: 0,
});

/** Each booth city's currency. Amounts are written in en-US so a currency is never ambiguous (SGD 9,000, A$9,000, AED 9,000, not "$"). */
export const CITY_REGIONS = Object.freeze({
  dubai: { currency: 'AED', label: 'UAE' },
  'new-york': { currency: 'USD', label: 'New York' },
  boston: { currency: 'USD', label: 'Boston' },
  singapore: { currency: 'SGD', label: 'Singapore' },
  melbourne: { currency: 'AUD', label: 'Australia' },
});

const COUNTRY_CURRENCY = {
  US: 'USD', AE: 'AED', SA: 'SAR', QA: 'QAR', SG: 'SGD', AU: 'AUD', NZ: 'NZD', GB: 'GBP', CH: 'CHF', CA: 'CAD',
  IN: 'INR', JP: 'JPY', KR: 'KRW', HK: 'HKD', IL: 'ILS', ZA: 'ZAR', BR: 'BRL', MX: 'MXN', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', PL: 'PLN', DE: 'EUR', FR: 'EUR', NL: 'EUR', IE: 'EUR', ES: 'EUR', IT: 'EUR', BE: 'EUR', AT: 'EUR',
  PT: 'EUR', FI: 'EUR', LU: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', CY: 'EUR',
  MT: 'EUR', HR: 'EUR', CN: 'CNY', TW: 'TWD', TH: 'THB', MY: 'MYR', ID: 'IDR', PH: 'PHP', VN: 'VND', PK: 'PKR',
  BD: 'BDT', LK: 'LKR', EG: 'EGP', NG: 'NGN', KE: 'KES', TR: 'TRY', CZ: 'CZK', HU: 'HUF', RO: 'RON', KW: 'KWD',
  BH: 'BHD', OM: 'OMR', JO: 'JOD', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', MA: 'MAD',
};

/** The rate rows, cleaned: [{ currency, hourly, credit }], never empty. */
export function cleanRates(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const currency = String(r?.currency ?? '').trim().toUpperCase();
    const hourly = Number(r?.hourly);
    const credit = Number(r?.credit);
    if (!/^[A-Z]{3}$/.test(currency) || seen.has(currency) || !(hourly >= 0) || !(credit >= 0)) continue;
    seen.add(currency);
    out.push({ currency, hourly, credit });
  }
  return out.length ? out : DEFAULT_RATES.map((r) => ({ ...r }));
}

/**
 * The region the amounts are for, and its rates: the visitor's city (a drawn city, or any city with
 * its country), else the browser's country (en-GB → GBP). When the administrator has a rate row for
 * that currency it is used; otherwise the first row (by default USD 25 an hour, USD 1 a credit).
 * `place`: a city key ("dubai") or { key, name, countryCode }.
 */
export function regionFor(place, locale = '', settings = {}) {
  const rates = cleanRates(settings.rates);
  const key = typeof place === 'string' ? place : place?.key;
  const city = CITY_REGIONS[key];
  const country = typeof place === 'object' && place ? String(place.countryCode ?? '').toUpperCase() : '';
  const local = city?.currency ?? COUNTRY_CURRENCY[country] ?? COUNTRY_CURRENCY[String(locale).split(/[-_]/)[1]?.toUpperCase()] ?? 'USD';
  const row = rates.find((r) => r.currency === local) ?? rates[0];
  const label = city?.label ?? (typeof place === 'object' && place ? place.name || place.country || '' : '');
  return { currency: row.currency, locale: 'en-US', label, hourly: row.hourly, credit: row.credit, regional: row.currency === local };
}

const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '' && v !== null ? Number(v) : fallback);

/** The settings, made safe to compute with (an administrator's, over the defaults). */
export function impactSettings(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const d = IMPACT_DEFAULTS;
  return {
    triageMinutes: num(v.triageMinutes, d.triageMinutes),
    fixMinutes: num(v.fixMinutes, d.fixMinutes),
    fpPercent: Math.min(100, num(v.fpPercent, d.fpPercent)),
    releaseMultiplier: Math.max(1, num(v.releaseMultiplier, d.releaseMultiplier)),
    triageCredits: num(v.triageCredits, d.triageCredits),
    remediationCredits: num(v.remediationCredits, d.remediationCredits),
    fusionCreditsPer10k: num(v.fusionCreditsPer10k, 0),
    rates: cleanRates(v.rates),
  };
}

const REAL = new Set(['VULNERABLE', 'CONFIRMED', 'URGENT']);
const NOT_REAL = new Set(['NOT_EXPLOITABLE', 'PROPOSED_NOT_EXPLOITABLE']);
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * The business outcome for `findings` (one scan's, or the Fusion-only ones).
 * `verdicts`: AI Triage items by finding id ({verdict}); `loc`: lines of code scanned;
 * `repos`: how many repositories like this one to project for (1 = this one).
 */
export function computeImpact({ findings = [], verdicts = {}, loc = null, repos = 1, settings = {}, region = null } = {}) {
  const s = impactSettings(settings);
  const r = region?.hourly !== undefined ? region : regionFor(region?.currency ?? 'USD', '', s);
  const rate = r.hourly;
  const creditPrice = r.credit;
  const list = findings.filter((f) => SEVERITIES.includes(f.severity));
  // Real findings: the verdict when AI Triage gave one, the assumed share otherwise.
  let triaged = 0;
  let real = 0;
  let unknown = 0;
  for (const f of list) {
    const v = verdicts[f.id]?.verdict;
    if (REAL.has(v)) { triaged += 1; real += 1; }
    else if (NOT_REAL.has(v)) triaged += 1;
    else unknown += 1;
  }
  const truePositives = real + unknown * (1 - s.fpPercent / 100);
  const bySeverity = Object.fromEntries(SEVERITIES.map((sev) => [sev, list.filter((f) => f.severity === sev).length]));

  const scale = Math.max(1, Math.round(Number(repos) || 1));
  const triageHours = (list.length * s.triageMinutes) / 60;
  const fixHours = (truePositives * s.fixMinutes) / 60;
  const hours = (triageHours + fixHours) * scale;
  const timeValue = hours * rate;
  const avoided = fixHours * rate * (s.releaseMultiplier - 1) * scale;

  const units = Number(loc) > 0 ? Math.ceil(Number(loc) / UNIT_LOC) : 0;
  const credits = {
    triage: list.length * s.triageCredits * scale,
    remediation: Math.ceil(truePositives) * s.remediationCredits * scale,
    fusion: units && s.fusionCreditsPer10k ? units * s.fusionCreditsPer10k * scale : 0,
  };
  credits.total = credits.triage + credits.remediation + credits.fusion;
  const cost = creditPrice > 0 ? credits.total * creditPrice : null;
  const gross = timeValue + avoided;
  const net = cost === null ? gross : gross - cost;

  return {
    currency: r.currency,
    locale: r.locale ?? 'en-US',
    rate,
    creditPrice,
    regional: r.regional,
    settings: s,
    repos: scale,
    findings: list.length,
    bySeverity,
    triaged,
    realFound: real,
    truePositives: round(truePositives * scale, 1),
    falsePositives: round((list.length - truePositives) * scale, 1),
    hours: { triage: round(triageHours * scale, 1), fix: round(fixHours * scale, 1), total: round(hours, 1), days: round(hours / 8, 1) },
    money: { timeValue: round(timeValue), avoided: round(avoided), gross: round(gross), cost: cost === null ? null : round(cost), net: round(net) },
    credits,
    loc: Number(loc) > 0 ? Number(loc) : null,
    roi: cost ? round(gross / cost, 1) : null,
  };
}

/** An amount written the way its currency is ("AED 48,000", "$12,500", "S$9,000"). */
export function formatMoney(n, currency, locale = 'en-US', digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Number(n));
  } catch {
    return `${currency} ${Math.round(Number(n)).toLocaleString('en-US')}`;
  }
}

/** A big amount, short: "AED 1.2M", "$48K". */
export function formatCompact(n, currency, locale = 'en-US') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  if (Math.abs(n) < 100_000) return formatMoney(n, currency, locale);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(n));
  } catch {
    return formatMoney(n, currency, locale);
  }
}
