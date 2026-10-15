const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const GITHUB = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());

export function parseGithubUrl(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(GITHUB);
  if (!m) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

export const CITY_THEMES = ['dubai', 'new-york', 'boston', 'singapore', 'melbourne'];

const clean = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates the registration form. Returns { value } or { errors }. */
export function validateRegistration(body = {}, { getSample = () => null } = {}) {
  const errors = {};
  const customer = { name: clean(body.name), email: clean(body.email, 254).toLowerCase(), company: clean(body.company) };
  const technical = { name: clean(body.technicalName), email: clean(body.technicalEmail, 254).toLowerCase() };
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const pocs = contacts
    .map((c) => ({ name: clean(c?.name), email: clean(c?.email, 254).toLowerCase(), role: clean(c?.role) || 'Operations' }))
    .filter((c) => c.name || c.email);
  // A visitor without a repository of their own picks one of the samples instead.
  const sampleId = clean(body.sampleId, 36);
  const sample = sampleId ? getSample(sampleId) : null;
  const repo = sample ? parseGithubUrl(sample.url) : parseGithubUrl(body.githubUrl);
  const branch = sample ? sample.branch : clean(body.branch, 200);

  if (!customer.name) errors.name = 'Please enter your name.';
  if (!isEmail(customer.email)) errors.email = 'Please enter a valid email address.';
  if (!technical.name) errors.technicalName = 'Please enter the technical contact name.';
  if (!isEmail(technical.email)) errors.technicalEmail = 'Please enter a valid technical contact email.';
  if (pocs.length < 2) errors.contacts = 'Please add at least two operations points of contact.';
  pocs.forEach((c, i) => {
    if (!c.name) errors[`contacts.${i}.name`] = 'Name is required.';
    if (!isEmail(c.email)) errors[`contacts.${i}.email`] = 'Valid email is required.';
  });
  if (pocs.length > 10) errors.contacts = 'Up to 10 contacts can be added here; invite more later.';
  if (sampleId && !sample?.enabled) errors.sampleId = 'That sample repository is no longer available. Please pick another.';
  else if (!repo) errors.githubUrl = 'Please enter a GitHub repository URL like https://github.com/org/repo, or pick a sample repository.';
  if (branch && !/^[\w./-]+$/.test(branch)) errors.branch = 'Branch name contains invalid characters.';
  // Consent is about the visitor's own code; the samples are ours.
  if (!sample && body.consent !== true) errors.consent = 'Please confirm you are authorised to have this repository scanned.';

  if (Object.keys(errors).length) return { errors };
  // Only a known city name is kept (never coordinates); anything else means no theme.
  const theme = CITY_THEMES.includes(body.theme) ? body.theme : null;
  return { value: { customer, technical, pocs, repo, branch, sampleId: sample?.id ?? null, theme } };
}
