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
const STAGES = [
  ['queued', 'Registered'],
  ['creating-project', 'Connecting to Checkmarx One'],
  ['starting-scan', 'Starting scan'],
  ['scanning', 'Scanning with Fusion + all engines'],
  ['fetching-results', 'Collecting results'],
  ['explaining', 'Writing plain-language explanations'],
  ['complete', 'Results ready'],
];

fetch('/api/config').then((r) => r.json()).then((c) => {
  document.getElementById('event-name').textContent = c.eventName;
  document.title = `${c.eventName} Security Scan`;
}).catch(() => {});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function contactRow(i, removable) {
  return h('div', { class: 'contact-row grid three' },
    h('label', {}, `Contact ${i + 1} name`, h('input', { name: `contacts.${i}.name`, required: true })),
    h('label', {}, 'Email', h('input', { name: `contacts.${i}.email`, type: 'email', required: true })),
    h('label', {}, 'Role', h('input', { name: `contacts.${i}.role`, placeholder: 'e.g. DevOps lead' })),
    removable ? h('button', { type: 'button', class: 'link remove', 'aria-label': 'Remove contact', onclick: (e) => { e.target.closest('.contact-row').remove(); renumber(); } }, 'Remove') : null,
  );
}

function renumber() {
  document.querySelectorAll('#contacts .contact-row').forEach((row, i) => {
    row.querySelectorAll('input').forEach((input) => { input.name = input.name.replace(/contacts\.\d+/, `contacts.${i}`); });
    row.querySelector('label').firstChild.textContent = `Contact ${i + 1} name`;
  });
}

function renderRegister() {
  app.replaceChildren(document.getElementById('register-tpl').content.cloneNode(true));
  const form = document.getElementById('register');
  const contacts = document.getElementById('contacts');
  contacts.append(contactRow(0, false), contactRow(1, false));

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
    form.querySelectorAll('[data-error], .field-error').forEach((el) => { if (el.classList.contains('field-error')) el.remove(); else el.textContent = ''; });
    document.getElementById('form-error').textContent = '';

    const fd = new FormData(form);
    const rows = [...contacts.querySelectorAll('.contact-row')];
    const body = {
      name: fd.get('name'), email: fd.get('email'), company: fd.get('company'),
      technicalName: fd.get('technicalName'), technicalEmail: fd.get('technicalEmail'),
      contacts: rows.map((_, i) => ({ name: fd.get(`contacts.${i}.name`), email: fd.get(`contacts.${i}.email`), role: fd.get(`contacts.${i}.role`) })),
      githubUrl: fd.get('githubUrl'), branch: fd.get('branch'),
      consent: form.consent.checked, inviteNow: form.inviteNow.checked,
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
    if (!input) continue;
    input.classList.add('invalid');
    input.after(h('span', { class: 'field-error' }, msg));
    first ??= input;
  }
  first?.focus();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
let pollTimer = null;
const ui = { filterEngine: 'all', filterSeverity: 'all', openIds: new Set() };

async function loadSession(id, key) {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('We could not find this scan. Please check the link.');
  return res.json();
}

async function renderResults(id, key) {
  clearTimeout(pollTimer);
  let s;
  try {
    s = await loadSession(id, key);
  } catch (err) {
    app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Scan not found'), h('p', {}, err.message), h('a', { href: '/' }, 'Start a new scan')));
    return;
  }

  const main = h('div', { class: 'results-main' });
  const side = h('aside', { class: 'results-side' }, teamPanel(s, id, key));
  main.append(header(s));

  if (s.stage === 'error') {
    main.append(h('div', { class: 'card error-card' }, h('h2', {}, 'The scan could not complete'), h('p', {}, s.error), h('p', { class: 'muted' }, 'Our team has the details and will follow up with you.')));
  } else if (s.stage !== 'complete') {
    main.append(progress(s));
    pollTimer = setTimeout(() => renderResults(id, key), 4000);
  } else {
    main.append(executive(s), stats(s), fusionSection(s), othersSection(s, id, key));
  }

  // Preserve focus in the invite form across polls.
  const active = document.activeElement?.name;
  const typed = [...document.querySelectorAll('#invite-form input')].map((i) => i.value);
  app.replaceChildren(h('div', { class: 'results-layout' }, main, side));
  document.querySelectorAll('#invite-form input').forEach((i, n) => { i.value = typed[n] ?? ''; });
  if (active) document.querySelector(`#invite-form [name="${active}"]`)?.focus();
}

function header(s) {
  const pill = s.stage === 'complete' ? ['ok', 'Complete'] : s.stage === 'error' ? ['bad', 'Failed'] : ['run', 'In progress'];
  return h('div', { class: 'results-header' },
    h('div', {},
      h('p', { class: 'eyebrow' }, `Security review for ${s.customer.company || s.customer.name}`),
      h('h1', {}, `${s.repo.owner}/${s.repo.repo}`),
      h('p', { class: 'muted' }, h('a', { href: s.repo.url, target: '_blank', rel: 'noopener' }, s.repo.url), s.cx?.branch || s.branch ? ` · branch ${s.cx?.branch || s.branch}` : '', s.mode === 'demo' ? ' · demo data' : ''),
    ),
    h('span', { class: `pill ${pill[0]}` }, pill[1]),
  );
}

function progress(s) {
  const idx = Math.max(0, STAGES.findIndex(([k]) => k === s.stage));
  const started = new Date(s.createdAt).getTime();
  const mins = Math.floor((Date.now() - started) / 60000);
  const secs = Math.floor(((Date.now() - started) % 60000) / 1000);
  return h('div', { class: 'card' },
    h('h2', {}, 'Scanning your repository'),
    h('p', { class: 'muted' }, `Elapsed ${mins}m ${String(secs).padStart(2, '0')}s · this usually takes a few minutes. You can invite your team while you wait →`),
    h('ol', { class: 'stepper' }, STAGES.map(([key, label], i) =>
      h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, h('span', { class: 'dot' }), label))),
    s.cx?.engines?.length ? h('div', { class: 'engines' }, s.cx.engines.map((e) =>
      h('span', { class: `engine-chip ${String(e.status).toLowerCase()}` }, `${e.name}: ${e.status}`))) : null,
  );
}

const RISK_CLASS = { Critical: 'sev-critical', High: 'sev-high', Moderate: 'sev-medium', Low: 'sev-low' };

function executive(s) {
  const e = s.executive ?? {};
  return h('section', { class: 'card exec' },
    h('div', { class: 'exec-top' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Executive summary'), h('h2', {}, e.headline)),
      h('div', { class: `risk ${RISK_CLASS[e.riskLevel] ?? ''}` }, h('small', {}, 'Overall risk'), h('strong', {}, e.riskLevel)),
    ),
    e.fusionValue ? h('p', { class: 'fusion-callout' }, h('strong', {}, 'What Fusion added: '), e.fusionValue) : null,
    h('div', { class: 'grid two' },
      h('div', {}, h('h3', {}, 'Key risks'), h('ul', {}, (e.keyPoints ?? []).map((p) => h('li', {}, p)))),
      h('div', {}, h('h3', {}, 'Recommended next steps'), h('ol', {}, (e.nextSteps ?? []).map((p) => h('li', {}, p)))),
    ),
  );
}

function stats(s) {
  const sum = s.summary;
  return h('div', { class: 'stats' },
    h('div', { class: 'stat fusion' }, h('strong', {}, sum.fusionOnly), h('span', {}, 'found only by Fusion')),
    h('div', { class: 'stat' }, h('strong', {}, sum.total), h('span', {}, 'total findings')),
    ...SEVERITIES.slice(0, 4).map((sev) => h('div', { class: `stat stat-${sev.toLowerCase()}` }, h('strong', {}, sum.allBySeverity[sev]), h('span', {}, sev.toLowerCase()))),
    sum.confirmedByFusion ? h('div', { class: 'stat' }, h('strong', {}, sum.confirmedByFusion), h('span', {}, 'confirmed by Fusion')) : null,
  );
}

function findingCard(f, { highlight = false } = {}) {
  const ex = f.explanation ?? {};
  const open = ui.openIds.has(f.id);
  const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : f.packageName ? f.packageName.replace(/^[A-Za-z]+-/, '') : '';
  return h('article', { class: `finding ${highlight ? 'highlight' : ''}` },
    h('header', {},
      h('span', { class: `sev sev-${f.severity.toLowerCase()}` }, f.severity),
      h('div', { class: 'finding-title' },
        h('h3', {}, ex.plainTitle || f.title),
        h('p', { class: 'meta' }, f.engineLabel, location ? ` · ${location}` : '', f.cwe ? ` · CWE-${f.cwe}` : '', f.cve ? ` · ${f.cve}` : ''),
      ),
      f.fusionOnly ? h('span', { class: 'badge fusion' }, 'Fusion only') : null,
      f.confirmedByFusion ? h('span', { class: 'badge confirmed' }, '✓ Confirmed by Fusion') : null,
    ),
    h('div', { class: 'explain grid three' },
      h('div', {}, h('h4', {}, 'What it means'), h('p', {}, ex.whatItMeans)),
      h('div', {}, h('h4', {}, 'Business impact'), h('p', {}, ex.businessImpact)),
      h('div', {}, h('h4', {}, 'How to fix'), h('p', {}, ex.howToFix)),
    ),
    ex.whyFusionFoundIt ? h('p', { class: 'why-fusion' }, h('strong', {}, 'Why only Fusion caught this: '), ex.whyFusionFoundIt) : null,
    ex.urgency ? h('p', { class: 'urgency' }, ex.urgency) : null,
    h('details', { open, ontoggle: (e) => (e.target.open ? ui.openIds.add(f.id) : ui.openIds.delete(f.id)) },
      h('summary', {}, 'Technical details'),
      h('dl', {},
        ...[
          ['Engine finding', f.title], ['Description', f.description], ['Language / platform', f.language],
          ['Source', f.file && `${f.file}${f.line ? ` line ${f.line}` : ''}`],
          ['Sink', f.sinkFile && (f.sinkFile !== f.file || f.sinkLine !== f.line) && `${f.sinkFile}${f.sinkLine ? ` line ${f.sinkLine}` : ''}`],
          ['Package', f.packageName], ['Fixed in', f.recommendedVersion], ['CVSS', f.cvss],
          ['Expected', f.expected], ['Actual', f.actual], ['State', f.state],
        ].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
      ),
    ),
  );
}

function fusionSection(s) {
  return h('section', { class: 'section fusion-section' },
    h('div', { class: 'section-head' },
      h('h2', {}, 'Found only by Checkmarx Fusion'),
      h('p', {}, 'These issues were not reported by the rule-based (deterministic) engines. Fusion reasons about how your application actually behaves across files and frameworks — catching logic and authorisation flaws that pattern-matching misses.'),
    ),
    s.fusionOnly.length
      ? s.fusionOnly.map((f) => findingCard(f, { highlight: true }))
      : h('div', { class: 'card muted' }, 'Fusion did not report anything beyond the rule-based engines on this scan.'),
  );
}

function othersSection(s, id, key) {
  const engines = [...new Set(s.others.map((f) => f.engineLabel))];
  const list = s.others.filter((f) =>
    (ui.filterEngine === 'all' || f.engineLabel === ui.filterEngine) &&
    (ui.filterSeverity === 'all' || f.severity === ui.filterSeverity));
  const select = (label, value, options, onchange) => h('label', { class: 'inline' }, label,
    h('select', { onchange: (e) => { onchange(e.target.value); renderResults(id, key); } },
      h('option', { value: 'all' }, 'All'), options.map((o) => h('option', { value: o, selected: o === value }, o))));
  return h('section', { class: 'section' },
    h('div', { class: 'section-head row' },
      h('div', {}, h('h2', {}, 'All other findings'), h('p', {}, `${s.others.length} issues from SAST, SCA, IaC, secrets and API security engines.`)),
      h('div', { class: 'filters' },
        select('Engine', ui.filterEngine, engines, (v) => (ui.filterEngine = v)),
        select('Severity', ui.filterSeverity, SEVERITIES, (v) => (ui.filterSeverity = v))),
    ),
    list.length ? list.map((f) => findingCard(f)) : h('div', { class: 'card muted' }, 'No findings match these filters.'),
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
      const m = document.querySelector('.invite-msg');
      const queued = data.results.filter((r) => r.delivery === 'queued').length;
      const failed = data.results.filter((r) => r.delivery === 'failed').map((r) => r.email);
      if (m) m.textContent = failed.length
        ? `Could not email ${failed.join(', ')}. Please check the address or try again.`
        : `${queued ? 'Invitation queued for' : 'Invitation sent to'} ${invitees.map((i) => i.email).join(', ')}.`;
    } catch (err) {
      msg.textContent = err.message || 'Could not send the invitation.';
      btn.disabled = false;
    }
  }

  const form = h('form', { id: 'invite-form', class: 'invite-form', novalidate: true },
    h('label', {}, 'Name', h('input', { name: 'inviteName', placeholder: 'Colleague name' })),
    h('label', {}, 'Email', h('input', { name: 'inviteEmail', type: 'email', placeholder: 'name@company.com', required: true })),
    h('button', { class: 'primary small', type: 'submit' }, 'Send invite'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.inviteEmail.value.trim();
    if (!email) { msg.textContent = 'Enter an email address.'; return; }
    invite([{ name: form.inviteName.value.trim(), email }], form.querySelector('button'));
  });

  const pending = (s.team ?? []).filter((t) => t.delivery !== 'sent' && t.delivery !== 'queued');
  return h('div', { class: 'card team' },
    h('h2', {}, 'Your team'),
    h('ul', { class: 'people' },
      h('li', {}, h('div', {}, h('strong', {}, s.technical.name), h('small', {}, s.technical.email)), h('span', { class: 'tag-mini' }, 'Technical contact')),
      (s.team ?? []).map((t) => h('li', {},
        h('div', {}, h('strong', {}, t.name || t.email), h('small', {}, t.name ? t.email : ''), h('small', { class: `status ${t.delivery}` }, status[t.delivery] ?? t.delivery)),
        h('button', { class: 'link', type: 'button', onclick: (e) => invite([{ name: t.name, email: t.email, role: t.role }], e.target) },
          t.delivery === 'sent' || t.delivery === 'queued' ? 'Resend' : 'Invite'),
      )),
    ),
    pending.length > 1 ? h('button', { class: 'secondary small', type: 'button', onclick: (e) => invite(pending.map(({ name, email, role }) => ({ name, email, role })), e.target) }, `Invite all ${pending.length}`) : null,
    h('h3', {}, 'Invite someone else'),
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
window.addEventListener('popstate', route);
route();
