import { THEMES, applyTheme, nearestCity, cityFromTimeZone, paintSkylines } from './themes.js';

const app = document.getElementById('app');

// Build DOM safely: every string goes in via textContent, never innerHTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SCANNERS = [
  ['fusion', 'Fusion'],
  ['sast', 'SAST'],
  ['sca', 'SCA'],
  ['kics', 'IaC Security'],
  ['secrets', 'Secret Detection'],
  ['apisec', 'API Security'],
  ['containers', 'Containers'],
];
const scannerLabel = (e) => SCANNERS.find(([k]) => k === e)?.[1] ?? e.toUpperCase();
const STAGES = [
  ['queued', 'Registered'],
  ['creating-project', 'Connecting to Checkmarx One'],
  ['starting-scan', 'Starting scan'],
  ['scanning', 'Scanning with Fusion + all engines'],
  ['fetching-results', 'Collecting results'],
  ['explaining', 'Writing plain-language explanations'],
  ['complete', 'Results ready'],
];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

let siteConfig = { eventName: 'Checkmate', samples: [], defaultCity: 'auto', askLocation: true };
const configReady = fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    siteConfig = c;
    document.getElementById('event-name').textContent = c.eventName;
    document.title = `${c.eventName} Security Scan`;
    const v = document.getElementById('version');
    if (v) v.textContent = `v${c.version}`;
  })
  .catch(() => {});


// ---------------------------------------------------------------------------
// City theme: asked for once on this device; only the city name is kept.
// ---------------------------------------------------------------------------
const CITY_KEY = 'checkmate-city';
const readCity = () => { try { return localStorage.getItem(CITY_KEY); } catch { return null; } };
const storeCity = (v) => { try { localStorage.setItem(CITY_KEY, v); } catch { /* private mode: ask again next time */ } };
let city = null;

function setCity(key, { remember = true } = {}) {
  city = THEMES[key] ? key : null;
  if (remember) storeCity(city ?? 'none');
  const theme = applyTheme(city);
  const chip = document.getElementById('city-chip');
  if (chip) {
    chip.hidden = false;
    chip.textContent = city ? `📍 ${theme.name}` : '📍 Choose your city';
    chip.onclick = () => askForCity();
  }
  const greeting = document.getElementById('city-greeting');
  const landmarks = document.getElementById('landmarks');
  if (greeting) { greeting.hidden = !city; greeting.textContent = city ? theme.greeting : ''; }
  if (landmarks) { landmarks.hidden = !city; landmarks.textContent = city ? theme.landmarks : ''; }
}

/** The theme to show before anyone answers: this device's choice, the event's city, or a time-zone guess. */
function initialCity() {
  const stored = readCity();
  if (stored) return { key: stored === 'none' ? null : stored, asked: true };
  if (siteConfig.defaultCity && siteConfig.defaultCity !== 'auto') return { key: siteConfig.defaultCity, asked: false };
  return { key: cityFromTimeZone(), asked: false };
}

function askForCity() {
  document.querySelector('.city-modal')?.remove();
  const suggested = city ?? cityFromTimeZone() ?? (siteConfig.defaultCity !== 'auto' ? siteConfig.defaultCity : null);
  const status = h('p', { class: 'city-status', role: 'status' });
  const close = () => { modal.remove(); document.getElementById('city-chip')?.focus(); };
  const choose = (key) => { setCity(key); close(); };

  const locate = h('button', { class: 'primary', type: 'button', onclick: () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      status.textContent = 'Location needs a secure (https) connection here. Please pick your city below.';
      return;
    }
    locate.disabled = true;
    status.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        // The coordinates never leave this browser: only the nearest city is kept.
        const found = nearestCity(coords.latitude, coords.longitude);
        if (found.key) {
          status.textContent = `${THEMES[found.key].greeting}! Theming everything for ${THEMES[found.key].name}.`;
          setCity(found.key);
          setTimeout(close, 900);
        } else {
          locate.disabled = false;
          status.textContent = `We don't have a theme for your area yet (nearest is ${THEMES[found.nearest].name}, ${Math.round(found.d)} km away). Pick one below.`;
        }
      },
      (err) => {
        locate.disabled = false;
        status.textContent = err.code === 1 ? 'No problem — pick your city below.' : 'We could not find your location. Pick your city below.';
      },
      { timeout: 10000, maximumAge: 3_600_000 },
    );
  } }, '📍 Use my location');

  const modal = h('div', { class: 'city-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'city-title', onclick: (e) => e.target === modal && close() },
    h('div', { class: 'city-dialog' },
      h('h2', { id: 'city-title' }, 'Make it feel like home'),
      h('p', {}, 'Share your location and we\'ll theme the page and your results with your city\'s skyline.'),
      h('div', { class: 'city-actions' }, locate, h('button', { class: 'link', type: 'button', onclick: () => choose(null) }, 'Not now')),
      status,
      h('div', { class: 'city-options' }, Object.entries(THEMES).map(([key, t]) =>
        h('button', { type: 'button', class: `city-option ${key === suggested ? 'suggested' : ''}`, onclick: () => choose(key) },
          t.name, h('small', {}, key === suggested ? 'Suggested for you' : t.landmarks.split(' · ')[0])))),
      h('p', { class: 'privacy-note' }, 'Your coordinates stay in this browser. We only keep the city name, to show your results in the same theme.'),
    ));
  modal.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(modal);
  locate.focus();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function contactRow(i, removable) {
  return h('div', { class: 'contact-row grid three' },
    h('label', {}, h('span', {}, `Contact ${i + 1} name`), h('input', { name: `contacts.${i}.name`, required: true })),
    h('label', {}, h('span', {}, 'Email'), h('input', { name: `contacts.${i}.email`, type: 'email', required: true })),
    h('label', {}, h('span', {}, 'Role'), h('input', { name: `contacts.${i}.role`, placeholder: 'e.g. DevOps lead' })),
    removable ? h('button', { type: 'button', class: 'link remove', 'aria-label': 'Remove contact', onclick: (e) => { e.target.closest('.contact-row').remove(); renumber(); } }, 'Remove') : null,
  );
}

function renumber() {
  document.querySelectorAll('#contacts .contact-row').forEach((row, i) => {
    row.querySelectorAll('input').forEach((input) => { input.name = input.name.replace(/contacts\.\d+/, `contacts.${i}`); });
    row.querySelector('label span').textContent = `Contact ${i + 1} name`;
  });
}

function samplePicker(form) {
  const wrap = document.getElementById('samples');
  if (!siteConfig.samples?.length) { wrap.hidden = true; return; }
  const own = document.getElementById('own-repo');
  const select = (id) => {
    form.sampleId.value = id ?? '';
    wrap.querySelectorAll('.sample').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.id === id)));
    own.hidden = Boolean(id);
    form.githubUrl.required = !id;
  };
  wrap.append(
    h('p', { class: 'samples-lead' }, h('strong', {}, 'No repository handy? '), 'See Fusion in action on one of ours — pick one and we\'ll scan it for you.'),
    h('div', { class: 'sample-grid' }, siteConfig.samples.map((s) =>
      h('button', { type: 'button', class: 'sample', 'data-id': s.id, 'aria-pressed': 'false', onclick: (e) => select(e.currentTarget.getAttribute('aria-pressed') === 'true' ? null : s.id) },
        h('span', { class: 'sample-name' }, s.name),
        h('span', { class: 'sample-lang' }, s.language),
        h('span', { class: 'sample-desc' }, s.description),
        h('span', { class: 'sample-url' }, s.url.replace('https://github.com/', '')),
        s.hasResults ? h('span', { class: 'sample-ready' }, '⚡ Instant results') : null))),
    h('button', { type: 'button', class: 'link', onclick: () => select(null) }, 'I\'ll use my own repository instead'),
  );
}

async function renderRegister() {
  await configReady;
  app.replaceChildren(document.getElementById('register-tpl').content.cloneNode(true));
  const start = initialCity();
  setCity(start.key, { remember: false });
  if (!start.asked && siteConfig.askLocation !== false) askForCity();
  const form = document.getElementById('register');
  const contacts = document.getElementById('contacts');
  contacts.append(contactRow(0, false), contactRow(1, false));
  samplePicker(form);

  document.getElementById('add-contact').onclick = () => {
    const n = contacts.children.length;
    if (n < 10) contacts.append(contactRow(n, true));
  };
  document.getElementById('same-as-me').onclick = () => {
    form.technicalName.value = form.name.value;
    form.technicalEmail.value = form.email.value;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });
    document.getElementById('form-error').textContent = '';

    const fd = new FormData(form);
    const rows = [...contacts.querySelectorAll('.contact-row')];
    const body = {
      name: fd.get('name'), email: fd.get('email'), company: fd.get('company'),
      technicalName: fd.get('technicalName'), technicalEmail: fd.get('technicalEmail'),
      contacts: rows.map((_, i) => ({ name: fd.get(`contacts.${i}.name`), email: fd.get(`contacts.${i}.email`), role: fd.get(`contacts.${i}.role`) })),
      sampleId: fd.get('sampleId') || undefined,
      githubUrl: fd.get('githubUrl'), branch: fd.get('branch'),
      consent: form.consent.checked, inviteNow: form.inviteNow.checked,
      theme: city ?? undefined,
    };

    const btn = document.getElementById('submit');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.status === 400 && data.errors) {
        showErrors(form, data.errors);
        throw new Error('Please fix the highlighted fields.');
      }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      history.pushState({}, '', data.url);
      route();
    } catch (err) {
      document.getElementById('form-error').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Start my scan';
    }
  });
}

function showErrors(form, errors) {
  let first = null;
  for (const [field, msg] of Object.entries(errors)) {
    const slot = form.querySelector(`[data-error="${field}"]`);
    if (slot) { slot.textContent = msg; continue; }
    const input = form.elements[field];
    if (!input || input.type === 'hidden') continue;
    input.classList.add('invalid');
    input.after(h('span', { class: 'field-error' }, msg));
    first ??= input;
  }
  first?.focus();
}

// ---------------------------------------------------------------------------
// Results — laid out like the Checkmarx One results view
// ---------------------------------------------------------------------------
let pollTimer = null;
const ui = { scanner: 'all', severities: new Set(), fusionOnly: false, search: '', selected: null, tab: null, execOpen: true };

async function loadSession(id, key) {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('We could not find this scan. Please check the link.');
  return res.json();
}

let current = null;
async function renderResults(id, key, { reload = true } = {}) {
  clearTimeout(pollTimer);
  if (reload || !current) {
    try {
      current = await loadSession(id, key);
    } catch (err) {
      app.replaceChildren(h('div', { class: 'card narrow' }, h('h2', {}, 'Scan not found'), h('p', {}, err.message), h('a', { href: '/' }, 'Start a new scan')));
      return;
    }
  }
  const s = current;
  const rerender = () => renderResults(id, key, { reload: false });
  if (document.documentElement.dataset.cityFor !== s.id) {
    // Everyone opening these results sees the visitor's city.
    setCity(s.theme ?? initialCity().key, { remember: false });
    document.documentElement.dataset.cityFor = s.id;
  }

  // Preserve the invite form across re-renders.
  const typed = [...document.querySelectorAll('#invite-form input')].map((i) => i.value);
  const activeName = document.activeElement?.name;

  let body;
  if (s.stage === 'error') {
    body = h('div', { class: 'card narrow error-card' }, h('h2', {}, 'The scan could not complete'), h('p', {}, s.error), h('p', { class: 'muted' }, 'Our team has the details and will follow up with you.'));
  } else if (s.stage !== 'complete') {
    body = h('div', { class: 'progress-layout' }, progress(s), s.technical ? teamPanel(s, id, key) : null);
    pollTimer = setTimeout(() => renderResults(id, key), 4000);
  } else {
    body = resultsView(s, id, key, rerender);
  }
  app.replaceChildren(scanBar(s), body);
  paintSkylines();

  document.querySelectorAll('#invite-form input').forEach((i, n) => { i.value = typed[n] ?? ''; });
  if (activeName) document.querySelector(`#invite-form [name="${activeName}"]`)?.focus();
}

function scanBar(s) {
  const status = s.stage === 'complete' ? ['ok', 'Completed'] : s.stage === 'error' ? ['bad', 'Failed'] : ['run', 'Running'];
  return h('div', { class: 'cx-scanbar' },
    h('div', { class: 'scanbar-skyline', 'data-skyline': '', 'aria-hidden': 'true' }),
    h('div', { class: 'cx-project' },
      h('span', { class: 'cx-crumb' }, 'Projects / ', s.customer?.company || s.customer?.name || 'Scan'),
      h('h1', {}, `${s.repo.owner}/${s.repo.repo}`),
      h('div', { class: 'cx-meta' },
        h('span', {}, h('b', {}, 'Branch '), s.cx?.branch || s.branch || 'default'),
        h('span', {}, h('b', {}, 'Scanned '), fmtDate(s.completedAt || s.createdAt)),
        h('span', {}, h('b', {}, 'Source '), h('a', { href: s.repo.url, target: '_blank', rel: 'noopener' }, 'GitHub')),
        s.mode === 'demo' ? h('span', { class: 'demo-tag' }, 'Demo data') : null,
      ),
    ),
    h('div', { class: 'cx-scanbar-right' },
      h('span', { class: `cx-status ${status[0]}` }, h('span', { class: 'dot' }), status[1]),
      s.cx?.url ? h('a', { class: 'btn-outline', href: s.cx.url, target: '_blank', rel: 'noopener' }, 'Open in Checkmarx One ↗') : null,
    ),
  );
}

function progress(s) {
  const idx = Math.max(0, STAGES.findIndex(([k]) => k === s.stage));
  const started = new Date(s.createdAt).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
  return h('div', { class: 'card' },
    h('h2', {}, 'Scanning your repository'),
    h('p', { class: 'muted' }, `Elapsed ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s · this usually takes a few minutes.${s.technical ? ' Invite your team while you wait →' : ''}`),
    h('ol', { class: 'stepper' }, STAGES.map(([, label], i) =>
      h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, h('span', { class: 'dot' }), label))),
    s.cx?.engines?.length ? h('div', { class: 'engines' }, s.cx.engines.map((e) =>
      h('span', { class: `engine-chip ${String(e.status).toLowerCase()}` }, `${e.name}: ${e.status}`))) : null,
  );
}

function allFindings(s) {
  return [...s.fusionOnly, ...s.others];
}

function filtered(s) {
  const q = ui.search.trim().toLowerCase();
  return allFindings(s).filter((f) =>
    (ui.scanner === 'all' || f.engine === ui.scanner) &&
    (!ui.severities.size || ui.severities.has(f.severity)) &&
    (!ui.fusionOnly || f.fusionOnly) &&
    (!q || `${f.title} ${f.explanation?.plainTitle} ${f.file} ${f.packageName} ${f.cwe} ${f.cve}`.toLowerCase().includes(q)));
}

function resultsView(s, id, key, rerender) {
  const findings = allFindings(s);
  const list = filtered(s);
  const selected = findings.find((f) => f.id === ui.selected) ?? null;
  const counts = Object.fromEntries(SCANNERS.map(([k]) => [k, findings.filter((f) => f.engine === k).length]));
  const ranEngines = SCANNERS.filter(([k]) => k !== 'fusion' && counts[k]).map(([, label]) => label);

  return h('div', { class: 'cx-page' },
    s.reusedFrom ? h('p', { class: 'reused-note' }, `Showing the most recent scan of this sample repository (completed ${fmtDate(s.reusedFrom.completedAt)}).`) : null,

    s.summary.fusionOnly ? h('div', { class: 'fusion-banner' },
      h('div', { class: 'fusion-mark', 'aria-hidden': 'true' }, '✦'),
      h('div', {},
        h('strong', {}, `Checkmarx Fusion found ${s.summary.fusionOnly} ${s.summary.fusionOnly === 1 ? 'vulnerability' : 'vulnerabilities'} that no rule-based engine reported.`),
        h('span', {}, ' These are logic, authorisation and cross-file flaws that pattern-matching scanners are not built to see.')),
      h('button', { class: 'btn-fusion', onclick: () => { ui.fusionOnly = !ui.fusionOnly; ui.scanner = 'all'; rerender(); } }, ui.fusionOnly ? 'Show all results' : 'Show only Fusion findings'),
    ) : null,

    executive(s, rerender),

    h('nav', { class: 'cx-tabs', 'aria-label': 'Scanners' },
      [['all', 'All results', findings.length], ...SCANNERS.filter(([k]) => counts[k]).map(([k, label]) => [k, label, counts[k]])].map(([k, label, n]) =>
        h('button', { class: `cx-tab ${ui.scanner === k ? 'active' : ''} ${k === 'fusion' ? 'fusion' : ''}`, onclick: () => { ui.scanner = k; rerender(); } },
          k === 'fusion' ? '✦ ' : '', label, h('span', { class: 'count' }, n)))),

    h('div', { class: `cx-workspace ${selected ? 'with-drawer' : ''}` },
      h('aside', { class: 'cx-filters' },
        h('div', { class: 'filter-group' },
          h('input', { type: 'search', placeholder: 'Search vulnerabilities', value: ui.search, 'aria-label': 'Search', oninput: (e) => { ui.search = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { rerender(); document.querySelector('.cx-filters input[type=search]')?.focus(); }, 250); } })),
        h('div', { class: 'filter-group' },
          h('h4', {}, 'Severity'),
          SEVERITIES.map((sev) => {
            const n = findings.filter((f) => f.severity === sev).length;
            if (!n) return null;
            return h('label', { class: 'filter-check' },
              h('input', { type: 'checkbox', checked: ui.severities.has(sev), onchange: (e) => { e.target.checked ? ui.severities.add(sev) : ui.severities.delete(sev); rerender(); } }),
              h('span', { class: `sev-icon ${sev.toLowerCase()}` }), sev[0] + sev.slice(1).toLowerCase(), h('span', { class: 'count' }, n));
          })),
        h('div', { class: 'filter-group' },
          h('h4', {}, 'Detection'),
          h('label', { class: 'filter-check' },
            h('input', { type: 'checkbox', checked: ui.fusionOnly, onchange: (e) => { ui.fusionOnly = e.target.checked; rerender(); } }),
            'Found only by Fusion', h('span', { class: 'count' }, s.summary.fusionOnly)),
          h('p', { class: 'filter-note' }, `${s.summary.confirmedByFusion ?? 0} rule-based finding(s) also confirmed by Fusion.`)),
        s.technical ? teamPanel(s, id, key) : null,
      ),

      h('section', { class: 'cx-table-wrap' },
        h('table', { class: 'cx-table' },
          h('thead', {}, h('tr', {},
            ['Severity', 'Vulnerability', 'Scanner', 'Language / Platform', 'Location', 'State', 'Status'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, list.length ? list.map((f) => row(f, rerender)) : h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'No results match these filters.')))),
      ),

      selected ? drawer(selected, ranEngines, rerender) : null,
    ),
  );
}

function row(f, rerender) {
  const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : f.packageName ? f.packageName.replace(/^[A-Za-z]+-/, '') : '—';
  const open = () => {
    const first = !ui.selected;
    ui.selected = f.id;
    ui.tab = null;
    if (first) ui.execOpen = false; // make room: the details sit next to the table
    rerender();
    if (first) document.querySelector('.cx-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return h('tr', { class: `${f.fusionOnly ? 'fusion-row' : ''} ${ui.selected === f.id ? 'selected' : ''}`, tabindex: 0, onclick: open, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) },
    h('td', {}, h('span', { class: `sev-pill ${f.severity.toLowerCase()}` }, h('span', { class: `sev-icon ${f.severity.toLowerCase()}` }), f.severity[0] + f.severity.slice(1).toLowerCase())),
    h('td', { class: 'vuln' },
      h('div', { class: 'vuln-name' }, f.explanation?.plainTitle || f.title,
        f.fusionOnly ? h('span', { class: 'chip fusion' }, '✦ Fusion only') : null,
        f.confirmedByFusion ? h('span', { class: 'chip confirmed' }, '✓ Confirmed by Fusion') : null),
      f.explanation?.plainTitle && f.explanation.plainTitle !== f.title ? h('div', { class: 'vuln-query' }, f.title) : null),
    h('td', {}, scannerLabel(f.engine)),
    h('td', {}, f.language || '—'),
    h('td', { class: 'mono' }, location),
    h('td', {}, (f.state || 'TO_VERIFY').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())),
    h('td', {}, (f.status || 'NEW').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())),
  );
}

function drawer(f, ranEngines, rerender) {
  const ex = f.explanation ?? {};
  const tabs = [
    f.fusionOnly ? ['fusion', '✦ Fusion insight'] : null,
    ['plain', 'Plain language'],
    f.nodes?.length ? ['vector', 'Attack vector'] : null,
    ['details', 'Details'],
  ].filter(Boolean);
  const tab = tabs.some(([k]) => k === ui.tab) ? ui.tab : tabs[0][0];
  const close = () => { ui.selected = null; rerender(); };

  const section = (title, text) => (text ? h('section', { class: 'drawer-section' }, h('h4', {}, title), h('p', {}, text)) : null);

  let content;
  if (tab === 'fusion') {
    content = [
      h('div', { class: 'never-seen' },
        h('div', { class: 'never-title' }, '✦ Never reported by rule-based scanning'),
        h('p', {}, 'Every other engine ran on this code and none of them flagged this issue:'),
        h('div', { class: 'engine-misses' }, (ranEngines.length ? ranEngines : ['SAST', 'SCA', 'IaC Security', 'Secret Detection']).map((e) => h('span', { class: 'miss' }, '✕ ', e)), h('span', { class: 'hit' }, '✓ Fusion'))),
      section('What Fusion determined', f.description),
      section('Why rule-based tools miss this', ex.whyFusionFoundIt),
      section('Business impact', ex.businessImpact),
      section('How to fix', ex.howToFix),
      ex.urgency ? h('p', { class: 'urgency' }, ex.urgency) : null,
      f.nodes?.length ? h('section', { class: 'drawer-section' }, h('h4', {}, 'Where it happens'), vector(f, 4)) : null,
    ];
  } else if (tab === 'plain') {
    content = [
      section('What it means', ex.whatItMeans),
      section('Business impact', ex.businessImpact),
      section('How to fix', ex.howToFix),
      ex.urgency ? h('p', { class: 'urgency' }, ex.urgency) : null,
    ];
  } else if (tab === 'vector') {
    content = [vector(f)];
  } else {
    content = h('dl', { class: 'info' },
      [
        ['Vulnerability', f.title], ['Scanner', scannerLabel(f.engine)], ['Severity', f.severity],
        ['CWE', f.cwe && `CWE-${f.cwe}`], ['CVE', f.cve], ['CVSS', f.cvss], ['Language / platform', f.language],
        ['Package', f.packageName], ['Fixed in', f.recommendedVersion], ['File', f.file && `${f.file}${f.line ? `:${f.line}` : ''}`],
        ['Expected', f.expected], ['Actual', f.actual], ['State', f.state], ['Status', f.status],
        ['First detected', f.firstFoundAt && fmtDate(f.firstFoundAt)], ['Description', f.description],
      ].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  return h('aside', { class: `cx-drawer ${f.fusionOnly ? 'fusion' : ''}`, 'aria-label': 'Result details' },
    h('header', {},
      h('div', {},
        h('span', { class: `sev-pill ${f.severity.toLowerCase()}` }, h('span', { class: `sev-icon ${f.severity.toLowerCase()}` }), f.severity[0] + f.severity.slice(1).toLowerCase()),
        f.fusionOnly ? h('span', { class: 'chip fusion' }, '✦ Fusion only') : null,
        f.confirmedByFusion ? h('span', { class: 'chip confirmed' }, '✓ Confirmed by Fusion') : null),
      h('button', { class: 'close', 'aria-label': 'Close details', onclick: close }, '×')),
    h('h2', {}, ex.plainTitle || f.title),
    h('p', { class: 'drawer-sub' }, scannerLabel(f.engine), f.cwe ? ` · CWE-${f.cwe}` : '', f.cve ? ` · ${f.cve}` : ''),
    h('div', { class: 'drawer-tabs', role: 'tablist' }, tabs.map(([k, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(k === tab), class: k === tab ? 'active' : '', onclick: () => { ui.tab = k; rerender(); } }, label))),
    h('div', { class: 'drawer-body' }, content),
  );
}

function vector(f, limit = Infinity) {
  const nodes = f.nodes.slice(0, limit);
  return h('ol', { class: 'vector' }, nodes.map((n, i) =>
    h('li', { class: i === 0 ? 'source' : i === f.nodes.length - 1 ? 'sink' : '' },
      h('span', { class: 'node-role' }, i === 0 ? 'Source' : i === f.nodes.length - 1 ? 'Sink' : `Step ${i + 1}`),
      h('span', { class: 'node-name mono' }, n.name || n.method || '—'),
      h('span', { class: 'node-loc mono' }, `${n.file}${n.line ? `:${n.line}` : ''}`))),
  f.nodes.length > nodes.length ? h('li', { class: 'more' }, `+ ${f.nodes.length - nodes.length} more steps (Attack vector tab)`) : null);
}

const RISK_CLASS = { Critical: 'critical', High: 'high', Moderate: 'medium', Low: 'low' };

function executive(s, rerender) {
  const e = s.executive ?? {};
  const sum = s.summary;
  return h('details', { class: 'card exec', open: ui.execOpen, ontoggle: (ev) => { ui.execOpen = ev.target.open; } },
    h('summary', {},
      h('span', { class: 'eyebrow' }, 'Executive summary'),
      h('span', { class: `risk ${RISK_CLASS[e.riskLevel] ?? ''}` }, `Overall risk: ${e.riskLevel ?? '—'}`)),
    h('h2', {}, e.headline),
    h('div', { class: 'stats' },
      h('button', { class: 'stat fusion', onclick: () => { ui.fusionOnly = true; ui.scanner = 'all'; rerender(); } }, h('strong', {}, sum.fusionOnly), h('span', {}, 'found only by Fusion')),
      h('div', { class: 'stat' }, h('strong', {}, sum.total), h('span', {}, 'total findings')),
      ...SEVERITIES.slice(0, 4).map((sev) => h('div', { class: `stat stat-${sev.toLowerCase()}` }, h('strong', {}, sum.allBySeverity[sev]), h('span', {}, sev.toLowerCase())))),
    e.fusionValue ? h('p', { class: 'fusion-callout' }, h('strong', {}, 'What Fusion added: '), e.fusionValue) : null,
    h('div', { class: 'grid two' },
      h('div', {}, h('h3', {}, 'Key risks'), h('ul', {}, (e.keyPoints ?? []).map((p) => h('li', {}, p)))),
      h('div', {}, h('h3', {}, 'Recommended next steps'), h('ol', {}, (e.nextSteps ?? []).map((p) => h('li', {}, p))))),
  );
}

function teamPanel(s, id, key) {
  const status = { sent: 'Invited', queued: 'Invite queued', failed: 'Invite failed', 'not-invited': 'Not invited yet' };
  const msg = h('p', { class: 'invite-msg', role: 'status' });

  async function invite(invitees, btn) {
    btn.disabled = true;
    msg.textContent = '';
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/invites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: key, invitees }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      document.getElementById('invite-form')?.reset();
      await renderResults(id, key);
      const failed = data.results.filter((r) => r.delivery === 'failed').map((r) => r.email);
      const queued = data.results.some((r) => r.delivery === 'queued');
      const m = document.querySelector('.invite-msg');
      if (m) m.textContent = failed.length
        ? `Could not email ${failed.join(', ')}. Please check the address or try again.`
        : `${queued ? 'Invitation queued for' : 'Invitation sent to'} ${invitees.map((i) => i.email).join(', ')}.`;
    } catch (err) {
      msg.textContent = err.message || 'Could not send the invitation.';
      btn.disabled = false;
    }
  }

  const form = h('form', { id: 'invite-form', class: 'invite-form', novalidate: true },
    h('input', { name: 'inviteName', placeholder: 'Name', 'aria-label': 'Colleague name' }),
    h('input', { name: 'inviteEmail', type: 'email', placeholder: 'name@company.com', 'aria-label': 'Colleague email', required: true }),
    h('button', { class: 'primary small', type: 'submit' }, 'Invite'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.inviteEmail.value.trim();
    if (!email) { msg.textContent = 'Enter an email address.'; return; }
    invite([{ name: form.inviteName.value.trim(), email }], form.querySelector('button'));
  });

  const pending = (s.team ?? []).filter((t) => t.delivery !== 'sent' && t.delivery !== 'queued');
  return h('div', { class: 'card team' },
    h('h4', {}, 'Your team'),
    h('ul', { class: 'people' },
      h('li', {}, h('div', {}, h('strong', {}, s.technical.name), h('small', {}, s.technical.email)), h('span', { class: 'tag-mini' }, 'Technical')),
      (s.team ?? []).map((t) => h('li', {},
        h('div', {}, h('strong', {}, t.name || t.email), t.name ? h('small', {}, t.email) : null, h('small', { class: `status ${t.delivery}` }, status[t.delivery] ?? t.delivery)),
        h('button', { class: 'link', type: 'button', onclick: (e) => invite([{ name: t.name, email: t.email, role: t.role }], e.target) },
          t.delivery === 'sent' || t.delivery === 'queued' ? 'Resend' : 'Invite'),
      )),
    ),
    pending.length > 1 ? h('button', { class: 'secondary small', type: 'button', onclick: (e) => invite(pending.map(({ name, email, role }) => ({ name, email, role })), e.target) }, `Invite all ${pending.length}`) : null,
    h('p', { class: 'invite-label' }, 'Invite someone else'),
    form,
    msg,
  );
}

// ---------------------------------------------------------------------------
function route() {
  const m = location.pathname.match(/^\/s\/([a-f0-9-]{36})$/);
  const key = new URLSearchParams(location.search).get('k');
  if (m && key) renderResults(m[1], key);
  else renderRegister();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.selected && current) { ui.selected = null; const m = location.pathname.match(/^\/s\/([a-f0-9-]{36})$/); renderResults(m[1], new URLSearchParams(location.search).get('k'), { reload: false }); }
});
window.addEventListener('popstate', route);
route();
