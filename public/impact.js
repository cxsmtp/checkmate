// Business impact: what finding and fixing these gaps is worth, in the visitor's own currency.
// The same arithmetic as CxMissionZero's Impact page and Cx Credits Calculator, shared by the
// outcome page (public/app.js) and the tests:
//
//   time saved   = findings × minutes to triage by hand + real findings × minutes to fix by hand,
//                  valued at the region's fully loaded engineering hour;
//   avoided      = what the real findings would have cost to fix after release: the same fix,
//                  `releaseMultiplier` times over (minus the fix itself, already counted above);
//   credits      = 1 per finding triaged, 3 per finding remediated, plus the Fusion scan
//                  (whole 10K-line units × credits per 10K LOC); priced only when a credit price is set.
//
// Real findings: AI Triage's verdicts when it has run on them, otherwise the false-positive share
// the calculator assumes (30%). Every figure comes with the assumptions it used.

export const TRIAGE_CREDITS = 1;
export const REMEDIATION_CREDITS = 3;
export const UNIT_LOC = 10000;
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export const IMPACT_DEFAULTS = Object.freeze({
  triageMinutes: 20,
  fixMinutes: 120,
  fpPercent: 30,
  releaseMultiplier: 6,
  hourlyRate: 0, // 0: the region's rate below
  currency: '', // '': the region's currency
  creditPrice: 0, // 0: credits are counted, not priced
  fusionCreditsPer10k: 0,
});

/**
 * Fully loaded cost of one engineering hour (salary, benefits, overhead) by currency, rounded:
 * conservative mid-market figures, editable in the admin panel.
 */
export const REGIONAL_RATES = Object.freeze({
  USD: 110, AED: 250, SAR: 250, QAR: 250, SGD: 90, AUD: 100, NZD: 95, EUR: 85, GBP: 80, CHF: 120,
  CAD: 105, INR: 2000, JPY: 7000, KRW: 70000, HKD: 450, ILS: 300, ZAR: 650, BRL: 180, MXN: 700,
  SEK: 750, NOK: 750, DKK: 600, PLN: 200, CNY: 300, TWD: 1500, THB: 1200, MYR: 150, IDR: 450000,
  PHP: 1500, VND: 700000, PKR: 6000, BDT: 3000, LKR: 6000, EGP: 1200, NGN: 25000, KES: 3500, TRY: 1200,
  CZK: 1100, HUF: 14000, RON: 200, KWD: 20, BHD: 25, OMR: 25, JOD: 30, ARS: 25000, CLP: 30000,
  COP: 120000, PEN: 120, MAD: 300,
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

/**
 * The region the amounts are for: the visitor's city (a drawn city, or any city with its country),
 * else the browser's country (en-GB → GBP), else US dollars. An administrator's currency wins. A
 * currency without a regional rate (and no rate set by the administrator) is shown in US dollars.
 * `place`: a city key ("dubai") or { key, name, countryCode }.
 */
export function regionFor(place, locale = '', settings = {}) {
  const fixed = String(settings.currency ?? '').trim().toUpperCase();
  const key = typeof place === 'string' ? place : place?.key;
  const city = CITY_REGIONS[key];
  const country = typeof place === 'object' && place ? String(place.countryCode ?? '').toUpperCase() : '';
  let currency = city?.currency ?? COUNTRY_CURRENCY[country] ?? COUNTRY_CURRENCY[String(locale).split(/[-_]/)[1]?.toUpperCase()] ?? 'USD';
  if (/^[A-Z]{3}$/.test(fixed)) currency = fixed;
  else if (!REGIONAL_RATES[currency] && !(Number(settings.hourlyRate) > 0)) currency = 'USD';
  const label = city?.label ?? (typeof place === 'object' && place ? place.name || place.country || '' : '');
  return { currency, locale: 'en-US', label };
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
    hourlyRate: num(v.hourlyRate, 0),
    currency: String(v.currency ?? '').trim().toUpperCase(),
    creditPrice: num(v.creditPrice, 0),
    fusionCreditsPer10k: num(v.fusionCreditsPer10k, 0),
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
export function computeImpact({ findings = [], verdicts = {}, loc = null, repos = 1, settings = {}, region = { currency: 'USD', locale: 'en-US' } } = {}) {
  const s = impactSettings(settings);
  const rate = s.hourlyRate || REGIONAL_RATES[region.currency] || REGIONAL_RATES.USD;
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
    triage: list.length * TRIAGE_CREDITS * scale,
    remediation: Math.ceil(truePositives) * REMEDIATION_CREDITS * scale,
    fusion: units && s.fusionCreditsPer10k ? units * s.fusionCreditsPer10k * scale : 0,
  };
  credits.total = credits.triage + credits.remediation + credits.fusion;
  const cost = s.creditPrice > 0 ? credits.total * s.creditPrice : null;
  const gross = timeValue + avoided;
  const net = cost === null ? gross : gross - cost;

  return {
    currency: region.currency,
    locale: region.locale,
    rate,
    rateFrom: s.hourlyRate ? 'admin' : 'region',
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
