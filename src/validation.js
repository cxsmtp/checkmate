const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const GITHUB = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());

export function parseGithubUrl(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(GITHUB);
  if (!m) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

const clean = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates the registration form. Returns { value } or { errors }. */
export function validateRegistration(body = {}) {
  const errors = {};
  const customer = { name: clean(body.name), email: clean(body.email, 254).toLowerCase(), company: clean(body.company) };
  const technical = { name: clean(body.technicalName), email: clean(body.technicalEmail, 254).toLowerCase() };
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const pocs = contacts
    .map((c) => ({ name: clean(c?.name), email: clean(c?.email, 254).toLowerCase(), role: clean(c?.role) || 'Operations' }))
    .filter((c) => c.name || c.email);
  const repo = parseGithubUrl(body.githubUrl);
  const branch = clean(body.branch, 200);

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
  if (!repo) errors.githubUrl = 'Please enter a GitHub repository URL like https://github.com/org/repo.';
  if (branch && !/^[\w./-]+$/.test(branch)) errors.branch = 'Branch name contains invalid characters.';
  if (body.consent !== true) errors.consent = 'Please confirm you are authorised to have this repository scanned.';

  if (Object.keys(errors).length) return { errors };
  return { value: { customer, technical, pocs, repo, branch } };
}
