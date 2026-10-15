const root = document.getElementById('admin');

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

const TABS = [
  ['registrations', 'Registrations'],
  ['samples', 'Sample repositories'],
  ['settings', 'Settings'],
  ['updates', 'Updates & integrity'],
  ['activity', 'Activity log'],
  ['account', 'Account'],
];
let tab = location.hash.slice(1) || 'registrations';
let mustChangePassword = false;

// ---------------------------------------------------------------------------
function renderLogin() {
  document.getElementById('logout').hidden = true;
  const m = msg();
  const form = h('form', { class: 'card login' },
    h('h2', {}, 'Sign in'),
    h('p', { class: 'muted' }, 'The first password is printed in the container log on first start (docker logs checkmate).'),
    h('label', {}, h('span', {}, 'Admin password'), h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
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
  const nav = h('nav', { class: 'admin-tabs' }, TABS.map(([k, label]) =>
    h('button', { class: `${k === tab ? 'active' : ''} ${k === 'account' && mustChangePassword ? 'alert' : ''}`, onclick: () => { tab = k; location.hash = k; render(); } }, label, k === 'account' && mustChangePassword ? ' •' : '')));
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(nav, body);
  const views = { registrations, samples, settings, updates, activity, account };
  try {
    body.replaceChildren(await (views[tab] ?? registrations)());
  } catch (err) {
    if (err.message !== 'Signed out') body.replaceChildren(h('p', { class: 'msg bad' }, err.message));
  }
}

document.getElementById('logout').onclick = async () => { await api('POST', '/logout', {}); renderLogin(); };

// ---------------------------------------------------------------------------
async function registrations() {
  const all = await api('GET', '/sessions');
  const visitors = all.filter((s) => s.kind !== 'sample-refresh');
  return h('div', {},
    h('div', { class: 'toolbar' },
      h('h2', {}, `Registrations (${visitors.length})`),
      h('div', { class: 'row-actions' },
        h('button', { class: 'secondary small', onclick: () => render() }, 'Refresh'),
        h('a', { class: 'secondary small', href: '/api/admin/sessions.csv', style: 'text-decoration:none' }, 'Download CSV'))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['When', 'Visitor', 'Technical contact', 'Team', 'Repository', 'Status', 'Results'].map((t) => h('th', {}, t)))),
      h('tbody', {}, visitors.length ? visitors.map((s) => h('tr', {},
        h('td', {}, fmt(s.createdAt)),
        h('td', {}, s.customer?.name, h('small', {}, s.customer?.email), s.customer?.company ? h('small', {}, s.customer.company) : null),
        h('td', {}, s.technical?.name, h('small', {}, s.technical?.email)),
        h('td', {}, s.team.map((t) => h('small', {}, `${t.name || t.email} · ${t.delivery}`))),
        h('td', {}, s.repo, s.theme ? h('small', {}, `📍 ${s.theme}`) : null, s.kind === 'sample' ? h('small', {}, s.reused ? 'Sample (reused scan)' : 'Sample') : null),
        h('td', {}, h('span', { class: `pill ${s.stage === 'complete' ? 'ok' : s.stage === 'error' ? 'bad' : 'warn'}` }, s.stage), s.error ? h('small', {}, s.error) : null,
          s.total != null ? h('small', {}, `${s.fusionOnly} Fusion-only / ${s.total} total`) : null),
        h('td', {}, h('a', { href: s.link, target: '_blank', rel: 'noopener' }, 'Open'), s.cxUrl ? h('small', {}, h('a', { href: s.cxUrl, target: '_blank', rel: 'noopener' }, 'Checkmarx One ↗')) : null),
      )) : h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No registrations yet.')))),
    ));
}

// ---------------------------------------------------------------------------
function sampleForm(sample, onDone) {
  const m = msg();
  const form = h('form', { class: 'card' },
    h('h3', {}, sample ? `Edit ${sample.name}` : 'Add a sample repository'),
    h('div', { class: 'sample-form' },
      h('label', {}, h('span', {}, 'Name'), h('input', { name: 'name', value: sample?.name ?? '', required: true })),
      h('label', {}, h('span', {}, 'GitHub URL'), h('input', { name: 'url', type: 'url', value: sample?.url ?? '', placeholder: 'https://github.com/org/repo', required: true })),
      h('label', {}, h('span', {}, 'Branch'), h('input', { name: 'branch', value: sample?.branch ?? '', placeholder: 'main' })),
      h('label', {}, h('span', {}, 'Language'), h('input', { name: 'language', value: sample?.language ?? '' })),
      h('label', { class: 'wide' }, h('span', {}, 'Short description (shown to visitors)'), h('input', { name: 'description', value: sample?.description ?? '', maxlength: 240 })),
      h('label', { class: 'check' }, h('input', { name: 'enabled', type: 'checkbox', checked: sample ? sample.enabled : true }), 'Show on the registration page')),
    h('div', { class: 'row-actions' },
      h('button', { class: 'primary small', type: 'submit' }, sample ? 'Save' : 'Add'),
      h('button', { class: 'secondary small', type: 'button', onclick: () => onDone() }, 'Cancel')),
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
  const view = h('div', {},
    h('div', { class: 'toolbar' },
      h('h2', {}, 'Sample repositories'),
      h('button', { class: 'primary small', onclick: () => slot.replaceChildren(sampleForm(null, render)) }, '+ Add repository')),
    h('p', { class: 'muted' }, 'Visitors without a repository of their own can pick one of these. "Scan now" runs a fresh Checkmarx One scan; visitors reuse the newest completed scan for the time set under Settings (so results appear instantly), then a new scan is started.'),
    slot, m,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Repository', 'Branch', 'Shown', 'Latest scan', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((s) => h('tr', {},
        h('td', {}, h('strong', {}, s.name), h('small', {}, s.url), s.language ? h('small', {}, s.language) : null),
        h('td', {}, s.branch || 'default'),
        h('td', {}, h('span', { class: `pill ${s.enabled ? 'ok' : ''}` }, s.enabled ? 'Yes' : 'Hidden')),
        h('td', {}, s.latest ? fmt(s.latest.completedAt) : '—'),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'link', onclick: async (e) => {
            e.target.disabled = true;
            try {
              const r = await api('POST', `/samples/${s.id}/scan`, {});
              say(m, `Scan started for ${s.name}. `, true);
              m.append(h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Follow it ↗'));
            } catch (err) { say(m, err.message, false); }
            e.target.disabled = false;
          } }, 'Scan now'),
          h('button', { class: 'link', onclick: () => slot.replaceChildren(sampleForm(s, render)) }, 'Edit'),
          h('button', { class: 'link danger', onclick: async () => { if (confirm(`Remove ${s.name}?`)) { await api('DELETE', `/samples/${s.id}`); render(); } } }, 'Remove'))),
      ))))));
  return view;
}

// ---------------------------------------------------------------------------
const SETTINGS_LAYOUT = [
  ['Event', [
    ['eventName', 'Event name'],
    ['publicBaseUrl', 'Public address (used in email links)', { placeholder: 'https://checkmate.example.com' }],
    ['mode', 'Mode', { options: [['demo', 'Demo (sample findings, no tenant)'], ['live', 'Live (Checkmarx One tenant)']] }],
    ['sampleReuseHours', 'Reuse a sample\'s scan for (hours, 0 = always rescan)', { type: 'number' }],
    ['defaultCity', 'City theme', { options: [['auto', 'Per visitor (location / time zone)'], ['dubai', 'Dubai'], ['new-york', 'New York'], ['boston', 'Boston'], ['singapore', 'Singapore'], ['melbourne', 'Melbourne']] }],
    ['askLocation', 'Ask each new device for its location', { checkbox: true }],
  ]],
  ['Checkmarx One tenant', [
    ['checkmarx.baseUrl', 'Base URL', { placeholder: 'https://ast.checkmarx.net' }],
    ['checkmarx.iamUrl', 'IAM URL', { placeholder: 'https://iam.checkmarx.net' }],
    ['checkmarx.tenant', 'Tenant'],
    ['checkmarx.apiKey', 'API key', { secret: true }],
    ['checkmarx.clientId', 'OAuth client ID (instead of API key)'],
    ['checkmarx.clientSecret', 'OAuth client secret', { secret: true }],
    ['checkmarx.projectPrefix', 'Project name prefix'],
    ['checkmarx.defaultBranch', 'Default branch'],
    ['checkmarx.githubToken', 'GitHub token for private repositories', { secret: true }],
  ]],
  ['Fusion', [
    ['checkmarx.engines', 'Engines (comma separated)', { list: true }],
    ['checkmarx.fusionScanConfig', 'Scan config that switches Fusion on (JSON array)', { json: true, placeholder: '[{"type":"sast","value":{"fusion":"true"}}]' }],
    ['fusion.markers', 'Words that mark a result as Fusion (comma separated)', { list: true }],
  ]],
  ['Plain-language explanations', [
    ['anthropic.apiKey', 'Anthropic API key (optional)', { secret: true }],
    ['anthropic.model', 'Model'],
    ['anthropic.maxFindingsToExplain', 'Findings explained by Claude per scan', { type: 'number' }],
  ]],
  ['Email', [
    ['smtp.host', 'SMTP host'],
    ['smtp.port', 'SMTP port', { type: 'number' }],
    ['smtp.secure', 'Use TLS from the start (port 465)', { checkbox: true }],
    ['smtp.user', 'SMTP user'],
    ['smtp.pass', 'SMTP password', { secret: true }],
    ['smtp.from', 'From address'],
    ['smtp.notify', 'Team address notified of each registration'],
  ]],
];

async function settings() {
  const current = await api('GET', '/settings');
  const m = msg();
  const testMsg = msg();
  const field = ([key, label, opt = {}]) => {
    const v = current[key];
    if (opt.options) return h('label', {}, h('span', {}, label), h('select', { name: key }, opt.options.map(([val, text]) => h('option', { value: val, selected: v === val }, text))));
    if (opt.checkbox) return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: key, checked: Boolean(v) }), label);
    if (opt.secret) return h('label', {}, h('span', {}, label, ' ', h('span', { class: 'secret-state' }, v?.set ? '(set — leave blank to keep)' : '(not set)')), h('input', { name: key, type: 'password', autocomplete: 'new-password' }));
    const value = opt.json ? (v?.length ? JSON.stringify(v) : '') : opt.list ? (v ?? []).join(',') : v ?? '';
    return h('label', {}, h('span', {}, label), h(opt.json ? 'textarea' : 'input', { name: key, type: opt.type ?? 'text', value: opt.json ? undefined : value, placeholder: opt.placeholder, rows: opt.json ? 3 : undefined }, opt.json ? value : null));
  };
  const form = h('form', { class: 'card' },
    h('div', { class: 'settings-grid' }, SETTINGS_LAYOUT.map(([title, fields]) => h('section', { class: 'settings-section' }, h('h3', {}, title), fields.map(field)))),
    h('div', { class: 'row-actions' },
      h('button', { class: 'primary', type: 'submit' }, 'Save settings'),
      h('button', { class: 'secondary', type: 'button', onclick: async () => {
        say(testMsg, 'Testing…');
        try {
          const r = await api('POST', '/settings/test', {});
          say(testMsg, `Connected to Checkmarx One${r.projects != null ? ` (${r.projects} projects visible)` : ''}.`);
        } catch (err) { say(testMsg, err.message, false); }
      } }, 'Test Checkmarx One connection')),
    m, testMsg,
    h('p', { class: 'muted' }, 'Secrets are stored in the data volume (readable only by the app) and never shown again. Checkmarx One addresses must be https on checkmarx.net.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const [, fields] of SETTINGS_LAYOUT) {
      for (const [key, , opt = {}] of fields) {
        const el = form.elements[key];
        if (opt.checkbox) patch[key] = el.checked;
        else if (opt.secret) { if (el.value) patch[key] = el.value; }
        else patch[key] = el.value;
      }
    }
    try {
      await api('PUT', '/settings', patch);
      say(m, 'Saved. Changes apply immediately.');
      form.querySelectorAll('input[type=password]').forEach((i) => { i.value = ''; });
    } catch (err) { say(m, err.message, false); }
  });
  return form;
}

// ---------------------------------------------------------------------------
const INTEGRITY_LABEL = {
  genuine: 'Genuine', tampered: 'Files changed', 'not-genuine': 'Not signed by the release workflow',
  unconfirmed: 'Not confirmed yet', unsigned: 'Development copy',
};

async function updates() {
  const s = await api('GET', '/updates');
  const m = msg();
  const integrity = s.integrity;
  const act = (fn) => async (e) => {
    e.target.disabled = true;
    try { await fn(); } catch (err) { say(m, err.message, false); }
    e.target.disabled = false;
  };
  const poll = () => setTimeout(async () => {
    try {
      const st = await api('GET', '/updates');
      if (st.job?.state === 'running' || st.job?.state === 'switching') { say(m, st.job.step); poll(); } else render();
    } catch { setTimeout(() => location.reload(), 4000); }
  }, 1500);

  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('h2', {}, 'Software integrity'),
        integrity ? h('span', { class: `pill ${integrity.state}` }, INTEGRITY_LABEL[integrity.state] ?? integrity.state) : h('span', { class: 'pill' }, 'Checking…')),
      h('p', {}, integrity?.summary ?? 'The first check runs a few seconds after start.'),
      integrity?.origin?.run ? h('p', { class: 'muted' }, 'Release workflow run: ', h('a', { href: integrity.origin.run, target: '_blank', rel: 'noopener' }, integrity.origin.run)) : null,
      integrity?.files && !integrity.files.ok ? h('dl', { class: 'kv' },
        ...[['Changed', integrity.files.changed], ['Missing', integrity.files.missing], ['Added', integrity.files.extra]].filter(([, l]) => l.length).flatMap(([k, l]) => [h('dt', {}, k), h('dd', { class: 'mono' }, l.join(', '))])) : null,
      h('button', { class: 'secondary small', onclick: act(async () => { await api('POST', '/integrity/check', {}); render(); }) }, 'Check now')),

    h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('h2', {}, 'Updates'),
        s.updateAvailable ? h('span', { class: 'pill warn' }, `v${s.latest.version} available`) : h('span', { class: `pill ${s.lastCheck ? 'ok' : ''}` }, s.lastCheck ? 'Up to date' : 'Not checked yet')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Running'), h('dd', {}, `v${s.running.version} (${s.running.source === 'update' ? 'installed update' : 'image'})`),
        h('dt', {}, 'Image'), h('dd', { class: 'mono' }, s.image),
        h('dt', {}, 'Launcher'), h('dd', {}, s.supervised ? 'Yes — updates install and roll back from this page' : 'No — started with a custom command; update with docker pull'),
        h('dt', {}, 'Last check'), h('dd', {}, s.lastCheck ? `${fmt(s.lastCheck.at)}${s.lastCheck.error ? ` — ${s.lastCheck.error}` : ''}` : '—'),
        s.lastCheck?.warning ? [h('dt', {}, 'Note'), h('dd', {}, s.lastCheck.warning)] : null,
        h('dt', {}, 'Auto-update'), h('dd', {},
          h('label', { class: 'check switch' }, h('input', { type: 'checkbox', checked: s.settings.auto, onchange: act(async (e) => { await api('PUT', '/updates/settings', { auto: e.target.checked }); render(); }) }),
            s.settings.auto ? 'On — new releases install by themselves (checked every few minutes)' : 'Off'),
          s.settings.lastAutoResult ? h('small', { class: 'muted' }, `Last look ${fmt(s.settings.lastAutoAt)}: ${s.settings.lastAutoResult}`) : null),
        s.job ? [h('dt', {}, 'Current job'), h('dd', {}, `${s.job.state}: ${s.job.error || s.job.step}`)] : null),
      h('div', { class: 'row-actions', style: 'margin-top:12px' },
        h('button', { class: 'secondary small', onclick: act(async () => { await api('POST', '/updates/check', {}); render(); }) }, 'Check for updates'),
        s.updateAvailable ? h('button', { class: 'primary small', onclick: act(async () => { await api('POST', '/updates/install', { ref: s.latest.tags.find((t) => /^\d/.test(t)) ?? 'latest' }); say(m, 'Installing…'); poll(); }) }, `Update to v${s.latest.version}`) : null,
        h('button', { class: 'secondary small', onclick: act(async () => { if (confirm('Restart the server? Visitors see "reconnecting" for a few seconds.')) { await api('POST', '/updates/restart', {}); say(m, 'Restarting…'); setTimeout(() => location.reload(), 5000); } }) }, 'Restart server')),
      m),

    s.lastCheck?.versions?.length ? h('div', { class: 'card' }, h('h3', {}, 'Published versions'),
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

    s.events?.length ? h('div', { class: 'card' }, h('h3', {}, 'Recent launcher events'),
      h('ul', { class: 'events' }, s.events.map((e) => h('li', {}, h('time', {}, fmt(e.at)), `${e.type}${e.from ? ` from v${e.from}` : ''}${e.to ? ` to v${e.to}` : ''}${e.reason ? ` — ${e.reason}` : ''}`)))) : null,
  );
}

// ---------------------------------------------------------------------------
async function activity() {
  const events = await api('GET', '/audit');
  return h('div', { class: 'card' }, h('h2', {}, 'Activity log'),
    events.length ? h('ul', { class: 'events' }, events.map((e) => h('li', {}, h('time', {}, fmt(e.at)), h('span', { class: `pill ${e.outcome === 'failure' ? 'bad' : ''}` }, e.type), ' ', e.reason))) : h('p', { class: 'muted' }, 'Nothing yet.'));
}

async function account() {
  const m = msg();
  const form = h('form', { class: 'card', style: 'max-width:520px' },
    h('h2', {}, 'Change admin password'),
    mustChangePassword ? h('p', { class: 'msg bad' }, 'You are using the generated first password. Please choose your own.') : null,
    h('label', {}, h('span', {}, 'Current password'), h('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    h('label', {}, h('span', {}, 'New password (12+ characters)'), h('input', { name: 'next', type: 'password', autocomplete: 'new-password', minlength: 12, required: true })),
    h('button', { class: 'primary', type: 'submit' }, 'Change password'), m,
    h('p', { class: 'muted' }, 'Locked out? Run: docker exec checkmate node scripts/reset-admin.mjs'));
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

render();
