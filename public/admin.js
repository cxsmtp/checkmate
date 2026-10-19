/**
 * Checkmate admin console. Talks to /api/admin/* only; the visitor page never sees
 * any of this. Everything is built from text nodes (no innerHTML).
 */
const root = document.getElementById('admin');
const tabsEl = document.getElementById('tabs');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(method, path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { renderLogin(); throw new Error('Signed out'); }
  if (!res.ok) throw Object.assign(new Error(data.error || Object.values(data.errors ?? {})[0] || `Request failed (${res.status})`), { data });
  return data;
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const msg = () => h('p', { class: 'msg', role: 'status' });
const say = (el, text, ok = true) => { el.textContent = text; el.className = `msg ${ok ? 'ok' : 'bad'}`; };
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const busy = (fn) => async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try { await fn(e); } finally { btn.disabled = false; }
};
const readFile = (file, as = 'text') => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.'));
  if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
});
/** A drop zone + file picker. onFile(file) is called once per file chosen. */
function dropZone(label, accept, onFile) {
  const input = h('input', { type: 'file', accept, onchange: (e) => { for (const f of e.target.files) onFile(f); e.target.value = ''; } });
  const zone = h('label', { class: 'drop' }, h('b', {}, label), h('br'), h('span', {}, 'Drop a file here or click to choose'), input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); for (const f of e.dataTransfer.files) onFile(f); });
  return zone;
}

// [key, label, subtitle, group, icon paths]
const TABS = [
  ['registrations', 'Registrations', 'Every visitor, their team, their scan and its outcome', 'Event', ['M4 19V5', 'M4 19h16', 'M7 15l4-4 3 3 5-6']],
  ['profiles', 'Profiles', 'The invitee directory behind the two-letter type-ahead', 'Event', ['M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.5a3.5 3.5 0 0 1 0 7', 'M18 14.5a6.5 6.5 0 0 1 3.5 5.5']],
  ['samples', 'Sample repositories', 'For visitors without a repository of their own', 'Event', ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9']],
  ['branding', 'Branding', 'Name, logo, colours, look, city photography', 'Set up', ['M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.9-.6-1.4-.6-2.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3z', 'M7.5 11.5h.01', 'M10.5 7.5h.01', 'M15.5 8.5h.01']],
  ['settings', 'Settings', 'Checkmarx One, scans, Fusion, AI assist, email — or upload a .env', 'Set up', ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M4 12h2', 'M18 12h2', 'M12 4v2', 'M12 18v2', 'M6.3 6.3l1.4 1.4', 'M16.3 16.3l1.4 1.4', 'M6.3 17.7l1.4-1.4', 'M16.3 7.7l1.4-1.4']],
  ['updates', 'Updates & integrity', 'Signed releases, auto-update, rollback', 'Set up', ['M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z', 'M9 12l2 2 4-4']],
  ['activity', 'Activity', 'Sign-ins, changes, scans, AI runs', 'Set up', ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']],
  ['account', 'Account', 'Your admin password', 'Set up', ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0']],
];
const icon = (paths) => { const NS = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
const setTitle = (title, sub = '', stage = '') => {
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;
  const chip = document.getElementById('page-stage'); chip.textContent = stage; chip.hidden = !stage;
};
const LOOK_KEY = 'checkmate-look';
const readLook = () => { try { return localStorage.getItem(LOOK_KEY); } catch { return null; } };
document.getElementById('theme-btn').onclick = () => {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(document.documentElement.dataset.theme) + 1) % order.length];
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(LOOK_KEY, next); } catch {}
};
let tab = location.hash.slice(1) || 'registrations';
let mustChangePassword = false;

async function applyBrand() {
  try {
    const c = await fetch('/api/config').then((r) => r.json());
    const b = c.branding ?? {};
    document.getElementById('brand-name').textContent = b.appName || 'Checkmate';
    document.title = `${b.appName || 'Checkmate'} · Admin`;
    document.documentElement.dataset.theme = readLook() || b.theme || 'auto';
    if (b.accent && b.accent !== 'city') document.documentElement.dataset.accent = b.accent;
    if (b.accentColor) { document.documentElement.style.setProperty('--accent-light', b.accentColor); document.documentElement.style.setProperty('--accent-dark', b.accentColor); }
    const mark = document.getElementById('brand-mark');
    mark.replaceChildren(b.iconUrl ? h('img', { src: b.iconUrl, alt: '' }) : (b.markText || '✦'));
    mark.classList.toggle('has-img', Boolean(b.iconUrl));
    mark.classList.toggle('off', !c.connected);
  } catch { /* the console still works without branding */ }
}

// ---------------------------------------------------------------------------
function renderLogin() {
  document.getElementById('logout').hidden = true;
  tabsEl.replaceChildren();
  setTitle('Sign in', 'The booth team only', '');
  const m = msg();
  const form = h('form', { class: 'panel login' },
    h('span', { class: 'eyebrow' }, 'Admin console'),
    h('h2', {}, 'Sign in'),
    h('p', { class: 'hint' }, 'The first password is printed in the container log on first start (podman logs checkmate).'),
    h('label', { class: 'field' }, h('span', {}, 'Admin password'), h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'), m);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/login', { password: form.password.value });
      mustChangePassword = r.mustChangePassword;
      if (mustChangePassword) tab = 'account';
      render();
    } catch (err) { say(m, err.message, false); }
  });
  root.replaceChildren(form);
  form.password.focus();
}

async function render() {
  const me = await api('GET', '/me');
  if (!me.signedIn) return renderLogin();
  mustChangePassword = me.mustChangePassword;
  document.getElementById('logout').hidden = false;
  let group = '';
  tabsEl.replaceChildren(...TABS.flatMap(([k, label, , grp, paths]) => {
    const head = grp !== group ? h('p', { class: 'nav-group' }, h('i'), (group = grp)) : null;
    return [head, h('button', { type: 'button', class: `tab ${k === tab ? 'active' : ''} ${k === 'account' && mustChangePassword ? 'alert' : ''}`, onclick: () => { tab = k; location.hash = k; render(); } }, icon(paths), h('span', {}, label))];
  }).filter(Boolean));
  const [, tLabel, tSub, tGroup] = TABS.find(([k]) => k === tab) ?? TABS[0];
  setTitle(tLabel, tSub, tGroup);
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(body);
  const views = { registrations, profilesView, samples, branding, settings, updates, activity, account };
  const view = views[tab === 'profiles' ? 'profilesView' : tab] ?? registrations;
  try {
    body.replaceChildren(await view());
  } catch (err) {
    if (err.message !== 'Signed out') body.replaceChildren(h('p', { class: 'msg bad' }, err.message));
  }
}

document.getElementById('logout').onclick = async () => { await api('POST', '/logout', {}); renderLogin(); };

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------
async function registrations() {
  const all = await api('GET', '/sessions');
  const visitors = all.filter((s) => s.kind !== 'sample-refresh');
  const complete = visitors.filter((s) => s.stage === 'complete');
  const fusionOnly = complete.reduce((n, s) => n + (s.fusionOnly ?? 0), 0);
  const m = msg();
  const stageClass = (s) => (s.stage === 'complete' ? 'complete' : s.stage === 'error' ? 'bad' : 'warn');
  return h('div', {},
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', {}, visitors.length), h('span', {}, 'registrations')),
      h('div', { class: 'stat' }, h('b', {}, complete.length), h('span', {}, 'scans completed')),
      h('div', { class: 'stat' }, h('b', {}, fusionOnly), h('span', {}, 'Fusion-only findings shown')),
      h('div', { class: 'stat' }, h('b', {}, visitors.filter((s) => !['complete', 'error'].includes(s.stage)).length), h('span', {}, 'running now'))),
    h('div', { class: 'toolbar' },
      h('h2', {}, 'Registrations'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'ghost sm', onclick: () => render() }, 'Refresh'),
        h('a', { class: 'chip', style: 'color:var(--text);border-color:var(--border)', href: '/api/admin/sessions.csv' }, 'Download CSV'))),
    m,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['When', 'Visitor', 'Technical contact', 'Team', 'Repository', 'Scan', 'Outcome', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, visitors.length ? visitors.map((s) => h('tr', {},
        h('td', {}, fmt(s.createdAt)),
        h('td', {}, h('span', { class: 'avatar-sm' }, initials(s.customer?.name)), s.customer?.name, h('small', {}, s.customer?.email), s.customer?.company ? h('small', {}, [s.customer.title, s.customer.company].filter(Boolean).join(' · ')) : null),
        h('td', {}, s.technical?.name, h('small', {}, s.technical?.email)),
        h('td', {}, s.team.map((t) => h('small', {}, `${t.name || t.email} · ${t.delivery ?? 'pending'}`))),
        h('td', {}, s.repo, s.branch ? h('small', {}, s.branch) : null, s.theme ? h('small', {}, `📍 ${s.theme}`) : null, s.kind === 'sample' ? h('small', {}, s.reused ? 'Sample (reused scan)' : 'Sample') : null),
        h('td', {}, h('span', { class: `pill ${stageClass(s)}` }, s.stage), s.error ? h('small', {}, s.error) : null,
          s.profile?.llmModel ? h('small', {}, `${(s.profile.engines ?? []).join(', ')}${s.profile.fusion ? ` · Fusion ${s.profile.llmModel}` : ''}`) : null),
        h('td', {}, s.exposure ? h('span', { class: `pill band-${s.exposure.band}` }, `${s.exposure.band} · ${s.exposure.score}`) : '—',
          s.total != null ? h('small', {}, `${s.fusionOnly} Fusion-only / ${s.total} total`) : null),
        h('td', {}, h('div', { class: 'row-actions' },
          h('a', { href: s.link, target: '_blank', rel: 'noopener' }, 'Open'),
          s.cxUrl ? h('a', { href: s.cxUrl, target: '_blank', rel: 'noopener' }, 'Checkmarx One ↗') : null,
          ['complete', 'error'].includes(s.stage) ? h('button', { class: 'link', onclick: busy(async () => {
            try { await api('POST', `/sessions/${s.id}/rescan`, {}); say(m, `Rescan started for ${s.repo}.`); setTimeout(render, 1200); } catch (err) { say(m, err.message, false); }
          }) }, 'Rescan') : null)),
      )) : h('tr', {}, h('td', { colspan: 8, class: 'muted' }, 'No registrations yet.')))),
    ));
}

// ---------------------------------------------------------------------------
// Profiles: the invitee directory
// ---------------------------------------------------------------------------
function profileForm(profile, onDone) {
  const m = msg();
  const teamText = (profile?.team ?? []).map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join('\n');
  const form = h('form', { class: 'panel' },
    h('h3', {}, profile ? `Edit ${profile.name}` : 'Add a profile'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Full name'), h('input', { name: 'name', value: profile?.name ?? '', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'Email'), h('input', { name: 'email', type: 'email', value: profile?.email ?? '', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'Company'), h('input', { name: 'company', value: profile?.company ?? '' })),
      h('label', { class: 'field' }, h('span', {}, 'Title'), h('input', { name: 'title', value: profile?.title ?? '', placeholder: 'CISO' })),
      h('label', { class: 'field' }, h('span', {}, 'City theme'), h('select', { name: 'city' }, ['', 'dubai', 'new-york', 'boston', 'singapore', 'melbourne'].map((c) => h('option', { value: c, selected: (profile?.city ?? '') === c }, c || 'Not set')))),
      h('label', { class: 'field' }, h('span', {}, 'Tags ', h('small', {}, 'comma separated')), h('input', { name: 'tags', value: (profile?.tags ?? []).join(', ') })),
      h('label', { class: 'field' }, h('span', {}, 'Technical contact name'), h('input', { name: 'technicalName', value: profile?.technical?.name ?? '' })),
      h('label', { class: 'field' }, h('span', {}, 'Technical contact email'), h('input', { name: 'technicalEmail', type: 'email', value: profile?.technical?.email ?? '' })),
      h('label', { class: 'field wide' }, h('span', {}, 'Team ', h('small', {}, 'one per line: Name <email> or just the email; these are pre-filled as the invited colleagues')), h('textarea', { name: 'team', rows: 3 }, teamText)),
      h('label', { class: 'field wide' }, h('span', {}, 'Repositories ', h('small', {}, 'one per line, offered as one-click choices')), h('textarea', { name: 'repos', rows: 2 }, (profile?.repos ?? []).join('\n'))),
      h('label', { class: 'field wide' }, h('span', {}, 'Notes ', h('small', {}, 'booth team only')), h('input', { name: 'notes', value: profile?.notes ?? '' }))),
    h('div', { class: 'row-actions', style: 'margin-top:14px' },
      h('button', { class: 'primary sm', type: 'submit' }, profile ? 'Save' : 'Add profile'),
      h('button', { class: 'ghost sm', type: 'button', onclick: () => onDone() }, 'Cancel')),
    m);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const team = form.team.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const mm = l.match(/^(.*?)\s*<([^>]+)>$/);
      return mm ? { name: mm[1].trim(), email: mm[2].trim() } : { name: '', email: l };
    });
    const body = {
      name: form.name.value, email: form.email.value, company: form.company.value, title: form.title.value, city: form.city.value, notes: form.notes.value,
      tags: form.tags.value, team, repos: form.repos.value.split('\n').map((s) => s.trim()).filter(Boolean),
      technical: form.technicalEmail.value ? { name: form.technicalName.value, email: form.technicalEmail.value } : null,
    };
    try {
      await api(profile ? 'PUT' : 'POST', profile ? `/profiles/${profile.id}` : '/profiles', body);
      onDone();
    } catch (err) { say(m, err.message, false); }
  });
  return form;
}

async function profilesView() {
  const all = await api('GET', '/profiles');
  const slot = h('div');
  const m = msg();
  const report = h('div', { class: 'import-report' });
  const search = h('input', { type: 'search', placeholder: 'Filter by name, company, email…', 'aria-label': 'Filter profiles' });
  const tbody = h('tbody');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((p) => !q || [p.name, p.company, p.email, p.title, ...(p.tags ?? [])].join(' ').toLowerCase().includes(q));
    tbody.replaceChildren(...(rows.length ? rows.map((p) => h('tr', {},
      h('td', {}, h('span', { class: 'avatar-sm' }, initials(p.name)), p.name, h('small', {}, p.email)),
      h('td', {}, p.company, p.title ? h('small', {}, p.title) : null),
      h('td', {}, p.technical?.email ? [p.technical.name, h('small', {}, p.technical.email)] : h('span', { class: 'muted' }, '—')),
      h('td', {}, (p.team ?? []).length ? (p.team ?? []).map((t) => h('small', {}, t.name ? `${t.name} · ${t.email}` : t.email)) : h('span', { class: 'muted' }, '—')),
      h('td', {}, p.city ? `📍 ${p.city}` : '—', (p.tags ?? []).length ? h('small', {}, p.tags.join(', ')) : null),
      h('td', {}, h('span', { class: `pill ${p.visits ? 'ok' : ''}` }, p.visits ? `${p.visits} visit${p.visits === 1 ? '' : 's'}` : 'not yet'), h('small', {}, p.source === 'visitor' ? 'self-registered' : p.source === 'csv' ? 'from CSV' : 'added here')),
      h('td', {}, h('div', { class: 'row-actions' },
        h('button', { class: 'link', onclick: () => { slot.replaceChildren(profileForm(p, render)); slot.scrollIntoView({ behavior: 'smooth' }); } }, 'Edit'),
        h('button', { class: 'link danger', onclick: async () => { if (confirm(`Remove ${p.name}?`)) { await api('DELETE', `/profiles/${p.id}`); render(); } } }, 'Remove'))),
    )) : [h('tr', {}, h('td', { colspan: 7, class: 'muted' }, all.length ? 'No profile matches.' : 'No profiles yet. Import the invitee list as CSV or add people one by one.'))]));
  };
  search.addEventListener('input', draw);
  draw();
  const importCsv = async (file) => {
    report.replaceChildren(h('span', { class: 'muted' }, `Importing ${file.name}…`));
    try {
      const text = await readFile(file);
      const r = await api('POST', '/profiles/import', { text });
      report.replaceChildren(
        h('p', { class: 'msg ok' }, `${r.added} added, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`),
        r.skipped.length ? h('ul', {}, r.skipped.slice(0, 10).map((s) => h('li', {}, `Row ${s.row}: ${s.reason}`))) : null);
      setTimeout(render, 1500);
    } catch (err) { report.replaceChildren(h('p', { class: 'msg bad' }, err.message)); }
  };
  return h('div', {},
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', {}, all.length), h('span', {}, 'profiles')),
      h('div', { class: 'stat' }, h('b', {}, all.filter((p) => p.visits).length), h('span', {}, 'have visited')),
      h('div', { class: 'stat' }, h('b', {}, new Set(all.map((p) => p.company).filter(Boolean)).size), h('span', {}, 'companies')),
      h('div', { class: 'stat' }, h('b', {}, all.reduce((n, p) => n + (p.team?.length ?? 0), 0)), h('span', {}, 'team contacts on file'))),
    h('div', { class: 'toolbar' },
      h('h2', {}, 'Profiles'),
      h('div', { class: 'row-actions' },
        h('a', { class: 'chip', style: 'color:var(--text);border-color:var(--border)', href: '/api/admin/profiles.csv' }, 'Export CSV'),
        h('button', { class: 'primary sm', onclick: () => { slot.replaceChildren(profileForm(null, render)); slot.scrollIntoView({ behavior: 'smooth' }); } }, '+ Add profile'))),
    h('p', { class: 'hint' }, 'Everyone invited to the event. On the visitor page, typing two letters of a name or company offers these profiles; picking one fills in the person, their technical contact and their team, so an executive never types an email address. Visitors who register without a profile are added here automatically.'),
    h('div', { class: 'panel', style: 'margin-bottom:18px' },
      h('div', { class: 'grid2', style: 'display:grid;grid-template-columns:1fr 1fr;gap:18px' },
        dropZone('Import invitees (CSV)', '.csv,text/csv', importCsv),
        h('div', { style: 'font-size:13.5px' },
          h('h4', {}, 'Columns understood'),
          h('p', { class: 'muted', style: 'margin:6px 0' }, 'name, email, company, title, technical_name, technical_email, team (addresses separated by ; or spaces), city, tags, phone, notes. Header names such as "Job title", "Organisation", "Colleagues" or "Location" are recognised too. Rows with an existing email update that profile.'))),
      report),
    slot, m,
    h('div', { class: 'search-row', style: 'margin-bottom:10px' }, search, h('span', { class: 'muted' }, `${all.length} total`)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Person', 'Company', 'Technical contact', 'Team', 'City · tags', 'Visits', ''].map((t) => h('th', {}, t)))),
      tbody)));
}

// ---------------------------------------------------------------------------
// Sample repositories
// ---------------------------------------------------------------------------
function sampleForm(sample, onDone) {
  const m = msg();
  const form = h('form', { class: 'panel' },
    h('h3', {}, sample ? `Edit ${sample.name}` : 'Add a sample repository'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { name: 'name', value: sample?.name ?? '', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'GitHub URL'), h('input', { name: 'url', type: 'url', value: sample?.url ?? '', placeholder: 'https://github.com/org/repo', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'Branch'), h('input', { name: 'branch', value: sample?.branch ?? '', placeholder: 'main' })),
      h('label', { class: 'field' }, h('span', {}, 'Language'), h('input', { name: 'language', value: sample?.language ?? '' })),
      h('label', { class: 'field wide' }, h('span', {}, 'Short description ', h('small', {}, 'shown to visitors')), h('input', { name: 'description', value: sample?.description ?? '', maxlength: 240 })),
      h('label', { class: 'check wide' }, h('input', { name: 'enabled', type: 'checkbox', checked: sample ? sample.enabled : true }), 'Show on the visitor page')),
    h('div', { class: 'row-actions', style: 'margin-top:14px' },
      h('button', { class: 'primary sm', type: 'submit' }, sample ? 'Save' : 'Add'),
      h('button', { class: 'ghost sm', type: 'button', onclick: () => onDone() }, 'Cancel')),
    m);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['name', 'url', 'branch', 'language', 'description'].map((k) => [k, form[k].value]));
    body.enabled = form.enabled.checked;
    try {
      await api(sample ? 'PUT' : 'POST', sample ? `/samples/${sample.id}` : '/samples', body);
      onDone();
    } catch (err) { say(m, err.message, false); }
  });
  return form;
}

async function samples() {
  const list = await api('GET', '/samples');
  const slot = h('div');
  const m = msg();
  return h('div', {},
    h('div', { class: 'toolbar' },
      h('h2', {}, 'Sample repositories'),
      h('button', { class: 'primary sm', onclick: () => slot.replaceChildren(sampleForm(null, render)) }, '+ Add repository')),
    h('p', { class: 'hint' }, 'Visitors without a repository of their own pick one of these. A repository is scanned on Checkmarx One as soon as it is added, so its results are ready the moment a visitor picks it; they are refreshed in the background after the time set under Settings → Profiles & samples. "Scan now" starts a fresh scan at once.'),
    slot, m,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Repository', 'Branch', 'Shown', 'Results', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.length ? list.map((s) => h('tr', {},
        h('td', {}, h('strong', {}, s.name), h('small', {}, s.url), s.language ? h('small', {}, s.language) : null),
        h('td', {}, s.branch || 'default'),
        h('td', {}, h('span', { class: `pill ${s.enabled ? 'ok' : ''}` }, s.enabled ? 'Yes' : 'Hidden')),
        h('td', {}, s.scanning ? h('span', { class: 'pill' }, 'Scanning…') : null, s.latest ? h('span', { class: 'pill ok' }, `Ready · ${s.latest.live ? 'Checkmarx One' : 'demo'}`) : s.scanning ? null : h('span', { class: 'pill' }, 'Not scanned yet'), s.latest ? h('small', {}, fmt(s.latest.completedAt)) : null),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'link', onclick: busy(async () => {
            try {
              const r = await api('POST', `/samples/${s.id}/scan`, {});
              say(m, `Scan started for ${s.name}. `);
              m.append(h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Follow it ↗'));
            } catch (err) { say(m, err.message, false); }
          }) }, 'Scan now'),
          h('button', { class: 'link', onclick: () => slot.replaceChildren(sampleForm(s, render)) }, 'Edit'),
          h('button', { class: 'link danger', onclick: async () => { if (confirm(`Remove ${s.name}?`)) { await api('DELETE', `/samples/${s.id}`); render(); } } }, 'Remove'))),
      )) : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No sample repositories yet.'))))));
}

// ---------------------------------------------------------------------------
// Branding (as in CxMissionZero: name, logo, icon, accent, look)
// ---------------------------------------------------------------------------
const ACCENTS = [['city', 'City (follows the visitor\'s city)'], ['ink', 'Ink'], ['lagoon', 'Lagoon'], ['sage', 'Sage'], ['plum', 'Plum'], ['ochre', 'Ochre']];
const ACCENT_SWATCH = { city: 'linear-gradient(135deg,#e8b05a,#8fb4ff,#ff8aa0,#7fd0e8)', ink: '#a8bedb', lagoon: '#86c9c1', sage: '#a3c9a0', plum: '#d1a9c7', ochre: '#e5b76f' };

function imageField(label, key, current, hint) {
  const img = h('img', { alt: '', hidden: !current });
  if (current) img.src = current;
  const hidden = h('input', { type: 'hidden', name: key, value: current ?? '' });
  const set = (v) => { hidden.value = v; if (v) { img.src = v; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } hidden.dispatchEvent(new Event('change', { bubbles: true })); };
  const url = h('input', { type: 'url', placeholder: 'https://… (or upload)', value: /^https:/.test(current ?? '') ? current : '', oninput: (e) => set(e.target.value.trim()) });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 300_000) { alert('Please use an image of up to 300 KB.'); return; }
    set(await readFile(f, 'dataUrl')); url.value = '';
  } });
  return h('div', { class: 'field img-field' }, h('span', {}, label, ' ', h('small', {}, hint)),
    h('div', { class: 'img-row' }, img,
      h('button', { type: 'button', class: 'ghost sm', onclick: () => file.click() }, 'Upload…'),
      h('button', { type: 'button', class: 'link danger', onclick: () => { set(''); url.value = ''; } }, 'Remove')),
    url, file, hidden);
}

async function branding() {
  const s = await api('GET', '/settings');
  const m = msg();
  const preview = h('div', { class: 'brand-preview' });
  const form = h('form', { class: 'panel' });
  const drawPreview = () => {
    const d = form.elements;
    const icon = d['branding.iconUrl'].value;
    const logo = d['branding.logoUrl'].value;
    preview.replaceChildren(
      icon ? h('img', { src: icon, alt: '', style: 'max-height:32px' }) : h('span', { class: 'mark' }, d['branding.markText'].value || '✦'),
      logo ? h('img', { src: logo, alt: '', style: `max-height:${d['branding.logoHeight'].value || 36}px` }) : h('span', { class: 'nm' }, d['branding.appName'].value || 'Checkmate'),
      h('span', { class: 'co' }, d['branding.companyName'].value));
    const accent = d['branding.accentColor'].value;
    preview.style.setProperty('--accent-dark', accent || '');
  };
  let accentChoice = s['branding.accent'] ?? 'ink';
  const swatches = h('div', { class: 'swatches' }, ACCENTS.map(([k, label]) => h('button', { type: 'button', title: label, 'aria-label': label, class: k === accentChoice ? 'active' : '', style: `background:${ACCENT_SWATCH[k]}`, onclick: (e) => { accentChoice = k; swatches.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); } })));
  form.append(
    h('h2', {}, 'Branding'),
    h('p', { class: 'hint' }, 'What visitors see at the top of the page, in emails and in the browser tab. Leave the logo empty to show the app name in type.'),
    preview,
    h('div', { class: 'grid2', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 18px' },
      h('label', { class: 'field' }, h('span', {}, 'App name'), h('input', { name: 'branding.appName', value: s['branding.appName'] ?? '', maxlength: 60 })),
      h('label', { class: 'field' }, h('span', {}, 'Company name ', h('small', {}, 'shown next to the name and in email footers')), h('input', { name: 'branding.companyName', value: s['branding.companyName'] ?? '', maxlength: 80 })),
      imageField('Logo', 'branding.logoUrl', s['branding.logoUrl'], 'PNG/SVG, up to 300 KB; replaces the app name in the header'),
      imageField('Icon', 'branding.iconUrl', s['branding.iconUrl'], 'square; replaces the mark in the sidebar and the browser tab icon'),
      h('label', { class: 'field' }, h('span', {}, 'Mark ', h('small', {}, 'shown when no icon is uploaded: 1–3 characters or an emoji')), h('input', { name: 'branding.markText', value: s['branding.markText'] ?? '✦', maxlength: 6 })),
      h('label', { class: 'field' }, h('span', {}, 'Logo height (px)'), h('input', { name: 'branding.logoHeight', type: 'number', min: 16, max: 80, value: s['branding.logoHeight'] ?? 36 })),
      h('label', { class: 'field' }, h('span', {}, 'Accent colour ', h('small', {}, 'overrides the palette below; leave empty to use it')),
        h('div', { style: 'display:flex;gap:10px;align-items:center' },
          h('input', { name: 'branding.accentColorPicker', type: 'color', value: s['branding.accentColor'] || '#4c3fb3', style: 'width:48px;padding:2px', oninput: (e) => { form.elements['branding.accentColor'].value = e.target.value; drawPreview(); } }),
          h('input', { name: 'branding.accentColor', value: s['branding.accentColor'] ?? '', placeholder: '#4c3fb3', pattern: '^#[0-9a-fA-F]{6}$|^$' }))),
      h('div', { class: 'field' }, h('span', {}, 'Palette'), swatches),
      h('label', { class: 'field' }, h('span', {}, 'Theme'), h('select', { name: 'branding.theme' }, [['dark', 'Dark (recommended for a booth screen)'], ['light', 'Light'], ['auto', 'Follow the device']].map(([v, t]) => h('option', { value: v, selected: (s['branding.theme'] ?? 'auto') === v }, t)))),
      h('label', { class: 'field' }, h('span', {}, 'Look'), h('select', { name: 'branding.look' }, [['command-center', 'Command center'], ['classic', 'Classic']].map(([v, t]) => h('option', { value: v, selected: (s['branding.look'] ?? 'command-center') === v }, t)))),
      h('label', { class: 'field span2', style: 'grid-column:1/-1' }, h('span', {}, 'Call to action ', h('small', {}, 'the first line visitors read')), h('input', { name: 'branding.callToAction', value: s['branding.callToAction'] ?? '', maxlength: 200 })),
      h('label', { class: 'field' }, h('span', {}, 'Event name'), h('input', { name: 'event.name', value: s['event.name'] ?? '', maxlength: 80 })),
      h('label', { class: 'field' }, h('span', {}, 'Tagline'), h('input', { name: 'event.tagline', value: s['event.tagline'] ?? '', maxlength: 120 })),
      h('label', { class: 'field' }, h('span', {}, 'Venue'), h('input', { name: 'event.venue', value: s['event.venue'] ?? '', maxlength: 120, placeholder: 'Black Hat MEA · Hall 2, booth 14' })),
      h('label', { class: 'field' }, h('span', {}, 'Footer line'), h('input', { name: 'branding.footer', value: s['branding.footer'] ?? '', maxlength: 200 })),
      h('label', { class: 'field' }, h('span', {}, 'City ', h('small', {}, 'auto: each visitor\'s own city, anywhere in the world; or one city for everyone')), h('input', { name: 'defaultCity', value: s.defaultCity ?? 'auto', placeholder: 'auto, or a city such as Dubai or Riyadh', list: 'city-list' }), h('datalist', { id: 'city-list' }, ['auto', 'Dubai', 'New York', 'Boston', 'Singapore', 'Melbourne'].map((v) => h('option', { value: v })))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'askLocation', checked: Boolean(s.askLocation) }), 'Detect each new device\'s city from its position (the browser asks once; the time zone is used until then)')),
    h('div', { class: 'save-bar' }, h('button', { class: 'primary', type: 'submit' }, 'Save branding'), m));
  form.addEventListener('input', drawPreview);
  form.addEventListener('change', drawPreview);
  drawPreview();
  const photosPanel = await cityPhotos();
  form.after(photosPanel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = { 'branding.accent': accentChoice };
    for (const el of form.elements) {
      if (!el.name || el.name === 'branding.accentColorPicker') continue;
      patch[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    try {
      await api('PUT', '/settings', patch);
      say(m, 'Saved. Visitors see it on their next page load.');
      applyBrand();
    } catch (err) { say(m, err.message, false); }
  });
  return h('div', {}, form);
}

const CITY_NAMES = { dubai: 'Dubai', 'new-york': 'New York', boston: 'Boston', singapore: 'Singapore', melbourne: 'Melbourne' };
const cityKey = (name) => String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
async function cityPhotos() {
  const first = await api('GET', '/cities');
  let photos = first.photos ?? first;
  const names = { ...(first.names ?? {}), ...CITY_NAMES };
  const m = msg();
  const grid = h('div', { class: 'city-grid' });
  const nameOf = (key) => names[key] || key;
  const fetchCity = async (key, name) => {
    say(m, `Looking for ${name} on Wikimedia Commons…`);
    try { const r = await api('POST', `/cities/${key}/fetch`, { count: 3, name }); photos = r.photos; names[key] = name; say(m, r.added ? `${r.added} licensed photo${r.added === 1 ? '' : 's'} of ${name} added.` : `Nothing fetched: ${r.errors[0] || 'no suitable licensed photo found'}.`, Boolean(r.added)); draw(); }
    catch (err) { say(m, err.message, false); }
  };
  const draw = () => grid.replaceChildren(...[...new Set([...Object.keys(CITY_NAMES), ...Object.keys(photos)])].map((key) => {
    const name = nameOf(key);
    const list = photos[key] ?? [];
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 4_000_000) { say(m, 'Please use an image of up to 4 MB.', false); return; }
      try { photos = await api('POST', `/cities/${key}/photos`, { dataUrl: await readFile(f, 'dataUrl'), credit: '', name }); say(m, `Photo added for ${name}.`); draw(); } catch (err) { say(m, err.message, false); }
    } });
    return h('div', { class: 'city-card' },
      h('div', { class: 'spread' }, h('h3', {}, name), h('span', { class: `pill ${list.length ? 'ok' : 'warn'}` }, list.length ? `${list.length} photo${list.length === 1 ? '' : 's'}` : CITY_NAMES[key] ? 'skyline drawing' : 'no photos yet')),
      h('div', { class: 'thumbs' }, list.map((p, i) => h('figure', {}, h('img', { src: p.src, alt: '' }), h('figcaption', {}, p.credit || 'Uploaded'), h('button', { type: 'button', class: 'link danger', onclick: async () => { if (confirm('Remove this photo?')) { photos = await api('DELETE', `/cities/${key}/photos/${i}`); draw(); } } }, 'Remove')))),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'ghost sm', onclick: busy(() => fetchCity(key, name)) }, 'Fetch from Wikimedia Commons'),
        h('button', { type: 'button', class: 'ghost sm', onclick: () => file.click() }, 'Upload…'), file));
  }));
  draw();
  const addName = h('input', { placeholder: 'Any city — Riyadh, Mumbai, London…', style: 'max-width:320px' });
  return h('div', { class: 'panel', style: 'margin-top:18px' },
    h('h2', {}, 'City photography'),
    h('p', { class: 'hint' }, 'Any city in the world. A visitor\'s city is found from their device (position, else time zone, or typed), and its photos are fetched from Wikimedia Commons the first time someone from there arrives (Creative Commons or public domain only, landscape, 1600 px and wider, credit kept). Add a city ahead of an event, or upload your own photos. The five cities below also have a drawn skyline.'),
    h('div', { class: 'row-actions', style: 'margin-bottom:12px' }, addName, h('button', { type: 'button', class: 'primary sm', onclick: busy(async () => { const n = addName.value.trim(); if (!n) return; await fetchCity(cityKey(n), n); addName.value = ''; }) }, 'Add a city')),
    grid, m);
}

// ---------------------------------------------------------------------------
// Settings: Checkmarx One, scan defaults, Fusion, profiles, email, event
// ---------------------------------------------------------------------------
const ENGINE_CHOICES = [['sast', 'SAST'], ['sca', 'SCA (open source)'], ['kics', 'IaC Security'], ['apisec', 'API Security'], ['containers', 'Container Security'], ['microengines', 'Secrets & repo health']];
const SECTIONS = [
  { id: 'cxone', title: 'Checkmarx One', intro: 'One API key is enough: the tenant, region, IAM and API addresses are read from the key itself. Scans and results are fetched with it; nothing else talks to the tenant.', fields: [
    ['checkmarx.apiKey', 'API key', { secret: true, span: true, hint: 'Checkmarx One → Settings → Identity and access → API keys (refresh token)' }],
    ['mode', 'Scans', { options: [['auto', 'Automatic — real Checkmarx One scans whenever the API key is set (demo only without a key)'], ['live', 'Live — always the tenant, never the demo']] }],
    ['checkmarx.projectPrefix', 'Project name prefix', { hint: 'projects created for visitors are named prefix + owner/repo' }],
    ['checkmarx.defaultBranch', 'Default branch'],
    ['checkmarx.githubToken', 'GitHub token for private repositories', { secret: true }],
    ['checkmarx.pollIntervalMs', 'Poll interval (ms)', { type: 'number' }],
    ['checkmarx.scanTimeoutMs', 'Scan timeout (ms)', { type: 'number' }],
    ['checkmarx.baseUrl', 'API URL override', { placeholder: 'leave empty: derived from the key', advanced: true }],
    ['checkmarx.iamUrl', 'IAM URL override', { placeholder: 'leave empty: derived from the key', advanced: true }],
    ['checkmarx.tenant', 'Tenant override', { placeholder: 'leave empty: derived from the key', advanced: true }],
    ['checkmarx.allowCustomHost', 'Allow a Checkmarx One host outside checkmarx.net (single-tenant / private deployments)', { checkbox: true }],
  ] },
  { id: 'scan', title: 'Scan defaults', intro: 'What a Checkmate scan runs. These are the defaults; when the tenant offers more (engines, LLM models, presets) the visitor sees the tenant\'s own list and can adjust if allowed.', fields: [
    ['scan.engines', 'Engines a scan runs', { engines: true, hint: 'SAST and SCA are recommended for the booth; Fusion is switched on below' }],
    ['scan.fusion', 'Fusion on by default (scan.config.ai.fusionEnabled)', { checkbox: true }],
    ['scan.llmModel', 'Default Fusion model (scan.config.ai.llmModel)', { placeholder: 'empty: the tenant\'s default', hint: 'e.g. opus-5.5, mythos-5.1 — the tenant\'s list is shown to the visitor' }],
    ['scan.extendedAnalysis', 'LLM-based SAST analysis (scan.config.sast.extendedAnalysis)', { checkbox: true }],
    ['scan.presetName', 'SAST preset', { placeholder: 'empty: project default' }],
    ['scan.letVisitorChoose', 'Let the visitor choose the Fusion model (from the tenant\'s list) before the scan', { checkbox: true }],
    ['scan.extraConfig', 'Extra scan config (JSON array of {type, value}), merged last', { json: true, span: true, placeholder: '[{"type":"sca","value":{"exploitablePath":"true"}}]' }],
  ] },
  { id: 'fusion', title: 'Fusion', intro: 'How Fusion findings are recognised in scan results, and the application-level Fusion services (Dispatcher correlates a scanned application; Results serves risk scores and the application map).', fields: [
    ['fusion.queryIdZero', 'Treat SAST results with queryId 0 and a CWE-title query name as Fusion (verified fingerprint)', { checkbox: true }],
    ['fusion.markers', 'Words that mark a result as Fusion', { list: true }],
    ['fusion.correlate', 'Run Fusion correlation after the scan (POST /{applicationId}/correlate, then poll scan-status)', { checkbox: true }],
    ['fusion.dispatcherPath', 'Fusion Dispatcher base path', { placeholder: 'empty: probe /api/fusion-dispatcher, /api/fusion/dispatcher, …' }],
    ['fusion.resultsPath', 'Fusion Results base path', { placeholder: 'empty: probe /api/fusion-results, /api/fusion/results, …' }],
    ['fusion.timeoutMs', 'Correlation timeout (ms)', { type: 'number' }],
  ] },
  { id: 'assist', title: 'AI Triage & Remediation', intro: 'The one-click close of the loop on the outcome page: AI Triage (POST /api/ai-triage/triage, verdicts read back per vulnerability group) and AI Remediation (POST /api/remediation/remediate, fixes read from remediation-details). Simulated by default: the same stages run on the real scan findings without calling Checkmarx One AI. Switch Mode to Live to triage and fix for real (spends the tenant\'s AI credits).', fields: [
    ['assist.mode', 'Mode', { options: [['simulated', 'Simulated — the same steps on the real findings, no AI credits spent'], ['live', 'Live — Checkmarx One AI Triage and AI Remediation (spends AI credits)']] }],
    ['assist.enabled', 'Show Triage with AI and Remediate with AI on the outcome page', { checkbox: true }],
    ['assist.pollIntervalMs', 'Poll interval (ms)', { type: 'number' }],
    ['assist.timeoutMs', 'Time limit per run (ms)', { type: 'number' }],
  ] },
  { id: 'impact', title: 'Business impact', intro: 'The Business impact tab on the outcome page: what triaging and fixing the findings with Checkmarx One AI saves, in the visitor\'s currency (their city: Dubai AED, New York and Boston USD, Singapore SGD, Melbourne AUD). The arithmetic of CxMissionZero\'s Impact page and Cx Credits Calculator: hours by hand × a fully loaded hourly rate, plus the extra cost of the same fixes after release, less the credits when a credit price is set.', fields: [
    ['impact.enabled', 'Show Business impact on the outcome page', { checkbox: true }],
    ['impact.triageMinutes', 'Minutes to triage a finding by hand', { type: 'number' }],
    ['impact.fixMinutes', 'Minutes to fix a finding by hand', { type: 'number' }],
    ['impact.fpPercent', 'False positives assumed before AI Triage runs (%)', { type: 'number' }],
    ['impact.releaseMultiplier', 'A fix after release costs (× the fix before)', { type: 'number' }],
    ['impact.hourlyRate', 'Fully loaded engineering hour', { type: 'number', hint: '0: the region\'s rate (USD 110, AED 250, SGD 90, AUD 100, EUR 85, GBP 80 …)' }],
    ['impact.currency', 'Currency', { placeholder: 'empty: the visitor\'s region', hint: 'three letters, e.g. AED — one currency for every visitor' }],
    ['impact.creditPrice', 'Price of one Checkmarx One credit', { type: 'number', hint: '0: credits are counted, not priced' }],
    ['impact.fusionCreditsPer10k', 'Fusion credits per 10K lines of code', { type: 'number', hint: '0: Fusion scan credits left out' }],
  ] },
  { id: 'profiles', title: 'Visitors, samples & cities', intro: 'How visitors find themselves, the sample repositories offered to those without one, and the city photography.', fields: [
    ['profiles.lookup', 'Offer profile type-ahead on the visitor page', { checkbox: true }],
    ['profiles.minChars', 'Letters typed before profiles are offered', { type: 'number' }],
    ['samplesAutoScan', 'Scan each sample repository as soon as it is added, so its results are ready for visitors', { checkbox: true }],
    ['sampleReuseHours', 'Refresh a sample\'s results after (hours; 0 = never — results are always shown at once)', { type: 'number' }],
    ['cities.autoFetch', 'Fetch licensed city photography from Wikimedia Commons (for every visitor\'s city)', { checkbox: true }],
    ['publicBaseUrl', 'Public address (used in email links)', { placeholder: 'https://checkmate.example.com' }],
  ] },
  { id: 'smtp', title: 'Email', intro: 'Invitations and the "results are ready" mail. Test sends a message to the address you give.', fields: [
    ['smtp.host', 'SMTP host'],
    ['smtp.port', 'Port', { type: 'number' }],
    ['smtp.user', 'User'],
    ['smtp.pass', 'Password', { secret: true }],
    ['smtp.from', 'From address'],
    ['smtp.fromName', 'From name'],
    ['smtp.notify', 'Booth team address notified of each registration'],
    ['smtp.secure', 'TLS from the start (port 465)', { checkbox: true }],
    ['smtp.requireAuth', 'Server requires sign-in', { checkbox: true }],
    ['smtp.rejectUnauthorized', 'Verify the server certificate', { checkbox: true }],
  ] },
];

async function settings() {
  let s = await api('GET', '/settings');
  const m = msg();
  const connCard = h('div', { class: 'conn-card' });
  const drawConn = () => {
    const c = s.connection;
    const keySet = s['checkmarx.apiKey']?.set;
    connCard.replaceChildren(
      h('div', {}, h('span', {}, 'API key'), h('b', { class: keySet ? '' : 'muted' }, keySet ? 'Set' : 'Not set')),
      h('div', {}, h('span', {}, 'Tenant'), h('b', {}, c?.tenant ?? '—')),
      h('div', {}, h('span', {}, 'Region'), h('b', {}, c?.region ?? '—')),
      h('div', {}, h('span', {}, 'API'), h('b', {}, c?.baseUrl ?? '—')),
      h('div', {}, h('span', {}, 'Key expires'), h('b', {}, c?.expiresAt ? fmt(c.expiresAt) : '—')),
      h('div', {}, h('span', {}, 'Scans'), h('b', { class: s.effectiveMode === 'live' ? '' : 'muted' }, s.effectiveMode === 'live' ? 'Real (Checkmarx One)' : 'Demo')),
      h('div', {}, h('span', {}, 'AI Triage & Remediation'), h('b', { class: s.assistLive ? '' : 'muted' }, s.assistLive ? 'Live' : 'Simulated')),
      ...(s.connectionError ? [h('div', { style: 'grid-column:1/-1' }, h('span', {}, 'Problem'), h('b', { class: 'danger' }, s.connectionError))] : []));
  };
  drawConn();

  const field = ([key, label, opt = {}]) => {
    const v = s[key];
    if (opt.options) return h('label', { class: 'field' }, h('span', {}, label), h('select', { name: key }, opt.options.map(([val, text]) => h('option', { value: val, selected: v === val }, text))));
    if (opt.checkbox) return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: key, checked: Boolean(v) }), label);
    if (opt.engines) return h('fieldset', { class: 'field span2 engines-field', 'data-key': key }, h('legend', {}, label, opt.hint ? h('small', {}, ' · ', opt.hint) : null),
      h('div', { class: 'checks' }, ENGINE_CHOICES.map(([k, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-engine': k, checked: (v ?? []).includes(k) }), t))));
    if (opt.secret) return h('label', { class: `field ${opt.span ? 'span2' : ''}` }, h('span', {}, label, ' ', h('span', { class: 'secret-state' }, v?.set ? '(set — leave empty to keep)' : '(not set)'), opt.hint ? h('small', {}, ' · ', opt.hint) : null), h('input', { name: key, type: 'password', autocomplete: 'new-password', placeholder: v?.set ? '••••••••' : '' }));
    const value = opt.json ? (v?.length ? JSON.stringify(v) : '') : opt.list ? (v ?? []).join(', ') : v ?? '';
    return h('label', { class: `field ${opt.span ? 'span2' : ''}` }, h('span', {}, label, opt.hint ? h('small', {}, ' · ', opt.hint) : null),
      opt.json ? h('textarea', { name: key, rows: 2, placeholder: opt.placeholder, class: 'mono' }, value) : h('input', { name: key, type: opt.type ?? 'text', value, placeholder: opt.placeholder }));
  };
  const section = (sec) => {
    const checks = sec.fields.filter(([, , o]) => o?.checkbox);
    const inputs = sec.fields.filter(([, , o]) => !o?.checkbox);
    const extras = sec.id === 'cxone' ? [h('div', { class: 'row-actions span2', style: 'grid-column:1/-1' },
      h('button', { type: 'button', class: 'ghost sm', onclick: busy(async () => {
        say(m, 'Testing the connection…');
        try {
          const r = await api('POST', '/settings/test', {});
          say(m, `Connected to ${r.tenant} (${r.region})${r.projects != null ? ` — ${r.projects} projects visible` : ''}${r.as ? ` as ${r.as}` : ''}.`);
        } catch (err) { say(m, err.message, false); }
      }) }, 'Test Checkmarx One connection'))] : sec.id === 'smtp' ? [h('div', { class: 'row-actions', style: 'grid-column:1/-1' },
      h('input', { name: '_smtpTestTo', type: 'email', placeholder: 'you@company.com', style: 'max-width:280px' }),
      h('button', { type: 'button', class: 'ghost sm', onclick: busy(async () => {
        say(m, 'Testing the mail server…');
        try { await api('POST', '/settings/test-smtp', { to: form.elements._smtpTestTo.value }); say(m, 'Mail server OK — test message sent if you gave an address.'); } catch (err) { say(m, err.message, false); }
      }) }, 'Test email'))] : [];
    return h('section', { class: 'panel settings-section', id: `sec-${sec.id}` },
      h('h2', {}, sec.title), sec.intro ? h('p', { class: 'hint' }, sec.intro) : null,
      sec.id === 'cxone' ? connCard : null,
      h('div', { class: 'grid2' }, inputs.map(field), checks.length ? h('div', { class: 'checks' }, checks.map(field)) : null, extras));
  };

  const importReport = h('div', { class: 'import-report' });
  const importEnv = async (file) => {
    importReport.replaceChildren(h('span', { class: 'muted' }, `Reading ${file.name}…`));
    try {
      const text = await readFile(file);
      const r = await api('POST', '/settings/import-env', { text });
      const lines = [h('p', { class: 'msg ok' }, `Applied ${r.applied.length} setting${r.applied.length === 1 ? '' : 's'}: ${r.applied.join(', ')}.`)];
      if (r.ignored?.length) lines.push(h('p', { class: 'muted' }, `Ignored (not a Checkmate setting): ${r.ignored.join(', ')}`));
      if (r.check?.cxone) lines.push(h('p', { class: `msg ${r.check.cxone.ok ? 'ok' : 'bad'}` }, r.check.cxone.ok ? `Checkmarx One: connected to ${r.check.cxone.tenant} (${r.check.cxone.region}).${r.check.cxone.note ? ` ${r.check.cxone.note}` : ''}` : `Checkmarx One: ${r.check.cxone.error}`));
      if (r.check?.smtp) lines.push(h('p', { class: `msg ${r.check.smtp.ok ? 'ok' : 'bad'}` }, r.check.smtp.ok ? 'Mail server: OK.' : `Mail server: ${r.check.smtp.error}`));
      importReport.replaceChildren(...lines);
      setTimeout(render, 2500);
    } catch (err) {
      importReport.replaceChildren(h('p', { class: 'msg bad' }, err.message), ...(err.data?.ignored?.length ? [h('p', { class: 'muted' }, `Seen but not understood: ${err.data.ignored.join(', ')}`)] : []));
    }
  };

  const form = h('form', {},
    h('section', { class: 'panel settings-section', id: 'sec-env' },
      h('h2', {}, 'Configure from a .env file'),
      h('p', { class: 'hint' }, 'Upload the same .env you would give the container (CX_API_KEY, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, …). Values are stored in the data volume with owner-only permissions, applied at once, and the Checkmarx One and mail connections are checked. Secrets are never shown again.'),
      dropZone('.env file', '.env,text/plain', importEnv), importReport),
    SECTIONS.map(section),
    h('div', { class: 'save-bar' }, h('button', { class: 'primary', type: 'submit' }, 'Save settings'), m));

  // One section at a time, chosen on the left (no long scrolling); every section is saved together.
  const show = (id) => {
    settingsSection = id;
    form.querySelectorAll('.settings-section').forEach((el) => { el.hidden = el.id !== `sec-${id}`; });
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.sec === id));
    form.querySelector('.save-bar').hidden = id === 'env';
  };
  const navItem = (id, title, dot = '', note = '') => h('a', { href: `#sec-${id}`, 'data-sec': id, onclick: (e) => { e.preventDefault(); show(id); } }, h('span', { class: `dot ${dot}` }), h('span', {}, title, note ? h('small', {}, note) : null));
  const nav = h('nav', { class: 'settings-nav' },
    SECTIONS.map((sec) => {
      const dot = sec.id === 'cxone' ? (s['checkmarx.apiKey']?.set ? (s.connection ? 'ok' : 'bad') : 'bad') : sec.id === 'smtp' ? (s['smtp.host'] ? 'ok' : '') : sec.id === 'assist' ? (s.assistLive ? 'ok' : '') : '';
      const note = sec.id === 'cxone' ? (s.connection ? `${s.connection.tenant} · ${s.effectiveMode === 'live' ? 'real scans' : 'demo'}` : 'not connected') : sec.id === 'smtp' ? (s['smtp.host'] || 'outbox only') : sec.id === 'assist' ? (s.assistLive ? 'live' : 'simulated') : sec.id === 'scan' ? (s['scan.engines'] ?? []).join(', ').toUpperCase() : '';
      return navItem(sec.id, sec.title, dot, note);
    }),
    navItem('env', 'Upload a .env file', '', 'everything at once'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const sec of SECTIONS) {
      for (const [key, , opt = {}] of sec.fields) {
        if (opt.engines) { patch[key] = [...form.querySelectorAll(`[data-key="${key}"] [data-engine]`)].filter((i) => i.checked).map((i) => i.dataset.engine).join(','); continue; }
        const el = form.elements[key];
        if (!el) continue;
        if (opt.checkbox) patch[key] = el.checked;
        else if (opt.secret) { if (el.value) patch[key] = el.value; }
        else patch[key] = el.value;
      }
    }
    try {
      s = await api('PUT', '/settings', patch);
      drawConn();
      say(m, s.connectionError ? `Saved, but the key could not be used: ${s.connectionError}` : 'Saved. Changes apply immediately.', !s.connectionError);
      form.querySelectorAll('input[type=password]').forEach((i) => { i.value = ''; });
    } catch (err) {
      const errs = err.data?.errors ? Object.entries(err.data.errors).map(([k, v]) => `${k}: ${v}`).join(' · ') : err.message;
      say(m, errs, false);
    }
  });
  queueMicrotask(() => show(SECTIONS.some((x) => x.id === settingsSection) || settingsSection === 'env' ? settingsSection : 'cxone'));
  return h('div', { class: 'settings-layout' }, nav, form);
}
let settingsSection = 'cxone';

// ---------------------------------------------------------------------------
// Updates & integrity
// ---------------------------------------------------------------------------
const INTEGRITY_LABEL = {
  genuine: 'Genuine', tampered: 'Files changed', 'not-genuine': 'Not signed by the release workflow',
  unconfirmed: 'Not confirmed yet', unsigned: 'Development copy',
};

async function updates() {
  const s = await api('GET', '/updates');
  const m = msg();
  const integrity = s.integrity;
  const act = (fn) => busy(async () => { try { await fn(); } catch (err) { say(m, err.message, false); } });
  const poll = () => setTimeout(async () => {
    try {
      const st = await api('GET', '/updates');
      if (st.job?.state === 'running' || st.job?.state === 'switching') { say(m, st.job.step); poll(); } else render();
    } catch { setTimeout(() => location.reload(), 4000); }
  }, 1500);

  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'toolbar' }, h('h2', {}, 'Software integrity'),
        integrity ? h('span', { class: `pill ${integrity.state}` }, INTEGRITY_LABEL[integrity.state] ?? integrity.state) : h('span', { class: 'pill' }, 'Checking…')),
      h('p', {}, integrity?.summary ?? 'The first check runs a few seconds after start.'),
      integrity?.origin?.run ? h('p', { class: 'muted' }, 'Release workflow run: ', h('a', { href: integrity.origin.run, target: '_blank', rel: 'noopener' }, integrity.origin.run)) : null,
      integrity?.files && !integrity.files.ok ? h('dl', { class: 'kv' },
        ...[['Changed', integrity.files.changed], ['Missing', integrity.files.missing], ['Added', integrity.files.extra]].filter(([, l]) => l.length).flatMap(([k, l]) => [h('dt', {}, k), h('dd', { class: 'mono' }, l.join(', '))])) : null,
      h('button', { class: 'ghost sm', onclick: act(async () => { await api('POST', '/integrity/check', {}); render(); }) }, 'Check now')),

    h('div', { class: 'panel' },
      h('div', { class: 'toolbar' }, h('h2', {}, 'Updates'),
        s.updateAvailable ? h('span', { class: 'pill warn' }, `v${s.latest.version} available`) : h('span', { class: `pill ${s.lastCheck ? 'ok' : ''}` }, s.lastCheck ? 'Up to date' : 'Not checked yet')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Running'), h('dd', {}, `v${s.running.version} (${s.running.source === 'update' ? 'installed update' : 'image'})`),
        h('dt', {}, 'Image'), h('dd', { class: 'mono' }, s.image),
        h('dt', {}, 'Launcher'), h('dd', {}, s.supervised ? 'Yes — updates install and roll back from this page' : 'No — started with a custom command; update with podman pull'),
        h('dt', {}, 'Last check'), h('dd', {}, s.lastCheck ? `${fmt(s.lastCheck.at)}${s.lastCheck.error ? ` — ${s.lastCheck.error}` : ''}` : '—'),
        s.lastCheck?.warning ? [h('dt', {}, 'Note'), h('dd', {}, s.lastCheck.warning)] : null,
        h('dt', {}, 'Auto-update'), h('dd', {},
          h('label', { class: 'check switch' }, h('input', { type: 'checkbox', checked: s.settings.auto, onchange: act(async (e) => { await api('PUT', '/updates/settings', { auto: e.target.checked }); render(); }) }),
            s.settings.auto ? 'On — new releases install by themselves (checked every few minutes)' : 'Off'),
          s.settings.lastAutoResult ? h('small', { class: 'muted' }, `Last look ${fmt(s.settings.lastAutoAt)}: ${s.settings.lastAutoResult}`) : null),
        s.job ? [h('dt', {}, 'Current job'), h('dd', {}, `${s.job.state}: ${s.job.error || s.job.step}`)] : null),
      h('div', { class: 'row-actions', style: 'margin-top:12px' },
        h('button', { class: 'ghost sm', onclick: act(async () => { await api('POST', '/updates/check', {}); render(); }) }, 'Check for updates'),
        s.updateAvailable ? h('button', { class: 'primary sm', onclick: act(async () => { await api('POST', '/updates/install', { ref: s.latest.tags.find((t) => /^\d/.test(t)) ?? 'latest' }); say(m, 'Installing…'); poll(); }) }, `Update to v${s.latest.version}`) : null,
        h('button', { class: 'ghost sm', onclick: act(async () => { if (confirm('Restart the server? Visitors see "reconnecting" for a few seconds.')) { await api('POST', '/updates/restart', {}); say(m, 'Restarting…'); setTimeout(() => location.reload(), 5000); } }) }, 'Restart server')),
      m),

    s.lastCheck?.versions?.length ? h('div', { class: 'panel' }, h('h3', {}, 'Published versions'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Version', 'Built', 'Commit', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, s.lastCheck.versions.slice(0, 15).map((v) => {
          const installed = s.installed.some((i) => i.version === v.version);
          const running = v.version === s.running.version;
          return h('tr', {},
            h('td', {}, `v${v.version}`, running ? h('small', {}, 'running') : installed ? h('small', {}, 'installed') : null),
            h('td', {}, fmt(v.created)), h('td', { class: 'mono' }, v.revision || '—'),
            h('td', {}, running ? null : h('button', { class: 'link', onclick: act(async () => {
              if (installed) await api('POST', '/updates/switch', { version: v.version });
              else await api('POST', '/updates/install', { ref: v.tags.find((t) => /^\d/.test(t)) ?? v.digest });
              say(m, 'Switching…'); poll();
            }) }, installed ? 'Switch to' : 'Install and switch')));
        }))))) : null,

    s.events?.length ? h('div', { class: 'panel' }, h('h3', {}, 'Recent launcher events'),
      h('ul', { class: 'events' }, s.events.map((e) => h('li', {}, h('time', {}, fmt(e.at)), `${e.type}${e.from ? ` from v${e.from}` : ''}${e.to ? ` to v${e.to}` : ''}${e.reason ? ` — ${e.reason}` : ''}`)))) : null,
  );
}

// ---------------------------------------------------------------------------
async function activity() {
  const events = await api('GET', '/audit');
  return h('div', { class: 'panel' }, h('h2', {}, 'Activity'),
    events.length ? h('ul', { class: 'events' }, events.map((e) => h('li', {}, h('time', {}, fmt(e.at)), h('span', { class: `pill ${e.outcome === 'failure' ? 'bad' : ''}` }, e.type), h('span', {}, e.reason)))) : h('p', { class: 'muted' }, 'Nothing yet.'));
}

async function account() {
  const m = msg();
  const form = h('form', { class: 'panel', style: 'max-width:520px' },
    h('h2', {}, 'Change admin password'),
    mustChangePassword ? h('p', { class: 'msg bad' }, 'You are using the generated first password. Please choose your own.') : null,
    h('label', { class: 'field' }, h('span', {}, 'Current password'), h('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    h('label', { class: 'field', style: 'margin-top:12px' }, h('span', {}, 'New password (12+ characters)'), h('input', { name: 'next', type: 'password', autocomplete: 'new-password', minlength: 12, required: true })),
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'primary', type: 'submit' }, 'Change password')), m,
    h('p', { class: 'hint', style: 'margin-top:14px' }, 'Locked out? Run: podman exec checkmate node scripts/reset-admin.mjs'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/password', { current: form.current.value, next: form.next.value });
      mustChangePassword = false;
      say(m, 'Password changed.');
      form.reset();
    } catch (err) { say(m, err.message, false); }
  });
  return form;
}

applyBrand();
render();
