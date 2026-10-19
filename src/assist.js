/**
 * Closing the loop: Checkmarx One AI Triage and AI Remediation, one click each.
 *
 * The contract is the one CxMissionZero uses in production:
 *   POST /api/ai-triage/triage            { scanID, buckets: [{ scannerType, resultIDs }] }
 *   GET  /api/ai-triage/triage/{projectId}/{groupId}            → verdict (triageStatus, analysis…)
 *   POST /api/remediation/remediate       { scanID, buckets: [{ scannerType, resultIDs: [one] }] }
 *   GET  /api/remediation/remediation-details/{scanId}/{alternateId} → results[0].data.file_changes…
 * AI-eligible findings are SAST and SCA (Fusion results are SAST results). groupId is the
 * similarityId for SAST and `<similarityId>#-#<packageIdentifier>#-#<projectId>` for SCA.
 *
 * In demo mode the same stages run against a simulation, so the experience can be shown
 * without spending credits; the data shapes are identical.
 */
import { config, assistLive } from './config.js';
import * as store from './store.js';
import { client } from './checkmarx.js';
import { lookup } from './knowledge.js';
import { audit } from './audit.js';

export const SCOPES = {
  fusion: { label: 'Fusion-only findings', pick: (f) => f.fusionOnly },
  'critical-high': { label: 'Critical and high', pick: (f) => ['CRITICAL', 'HIGH'].includes(f.severity) },
  all: { label: 'Everything AI can act on', pick: () => true },
};
const WAITING = new Set(['IN_PROGRESS', 'NOT_TRIAGED', 'PENDING', 'QUEUED', 'RUNNING', 'TO_VERIFY']);
const SAFE = new Set(['NOT_EXPLOITABLE', 'PROPOSED_NOT_EXPLOITABLE']);
export const VERDICT_WORDS = {
  VULNERABLE: 'Vulnerable', CONFIRMED: 'Confirmed', URGENT: 'Urgent', UNCERTAIN: 'Uncertain',
  PROPOSED_NOT_EXPLOITABLE: 'Probably not exploitable', NOT_EXPLOITABLE: 'Not exploitable', RISK_ACCEPTED: 'Risk accepted', FAILED: 'Triage failed',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const liveMode = () => assistLive();
const all = (s) => [...(s.fusionOnly ?? []), ...(s.others ?? [])];
const running = new Set();

/** Whether Checkmarx One AI can act on a finding, and if not, why. */
export function eligibility(f) {
  const type = String(f.underlyingType || '').toLowerCase();
  if (!['sast', 'sca'].includes(type)) return { ok: false, reason: `AI Triage and Remediation act on SAST and SCA findings; this one is ${f.engineLabel || type}.` };
  if (liveMode() && !f.alternateId) return { ok: false, reason: 'Checkmarx One returned no result id for this finding.' };
  return { ok: true };
}
export const scopeOf = (session, scope) => all(session).filter((f) => (SCOPES[scope] ?? SCOPES.all).pick(f) && eligibility(f).ok);
/** How many findings each scope would act on, for the buttons. */
export const scopeCounts = (session) => Object.fromEntries(Object.keys(SCOPES).map((k) => [k, scopeOf(session, k).length]));

const scannerType = (f) => String(f.underlyingType).toLowerCase();
const groupId = (f, projectId) => (scannerType(f) === 'sca' ? [f.similarityId, f.packageName, projectId].join('#-#') : f.similarityId);

function setAssist(id, kind, patch) {
  return store.update(id, (s) => {
    s.assist ??= {};
    s.assist[kind] = { ...(s.assist[kind] ?? {}), ...patch };
  });
}
function setItem(id, kind, findingId, patch) {
  return store.update(id, (s) => {
    const items = (s.assist[kind].items ??= {});
    items[findingId] = { ...(items[findingId] ?? {}), ...patch, at: new Date().toISOString() };
  });
}

// ---------------------------------------------------------------------------
// AI Triage
// ---------------------------------------------------------------------------
export function startTriage(id, scope = 'fusion', log = console) {
  const session = store.load(id);
  if (!session || session.stage !== 'complete') throw Object.assign(new Error('Results are not ready yet.'), { status: 409 });
  if (session.assist?.triage?.status === 'running') throw Object.assign(new Error('AI Triage is already running.'), { status: 409 });
  const targets = scopeOf(session, scope);
  if (!targets.length) throw Object.assign(new Error('Nothing in that scope can be triaged by AI.'), { status: 400 });
  const items = Object.fromEntries(targets.map((f) => [f.id, { status: 'queued' }]));
  setAssist(id, 'triage', { simulated: !liveMode(), status: 'running', scope, startedAt: new Date().toISOString(), finishedAt: null, requested: targets.length, items, error: null });
  audit({ type: 'assist', outcome: 'info', reason: `AI Triage started for ${session.repo.url}: ${targets.length} finding(s), scope ${scope}${liveMode() ? '' : ' (simulated)'}` });
  (liveMode() ? liveTriage(id, targets, log) : demoTriage(id, targets)).catch((e) => {
    log.error?.(`AI Triage for ${id} failed: ${e.message}`);
    setAssist(id, 'triage', { status: 'failed', error: e.message, finishedAt: new Date().toISOString() });
  });
  return store.load(id);
}

function finishTriage(id) {
  const s = store.load(id);
  const items = Object.values(s.assist.triage.items);
  const summary = { vulnerable: 0, notExploitable: 0, uncertain: 0, failed: 0 };
  for (const it of items) {
    if (it.status === 'failed') summary.failed += 1;
    else if (SAFE.has(it.verdict) || it.verdict === 'RISK_ACCEPTED') summary.notExploitable += 1;
    else if (it.verdict === 'UNCERTAIN') summary.uncertain += 1;
    else summary.vulnerable += 1;
  }
  setAssist(id, 'triage', { status: 'done', finishedAt: new Date().toISOString(), summary });
  audit({ type: 'assist', outcome: 'info', reason: `AI Triage finished for ${s.repo.url}: ${summary.vulnerable} vulnerable, ${summary.notExploitable} not exploitable, ${summary.uncertain} uncertain` });
  // One click, both steps: AI Remediation follows on what AI Triage kept.
  const chain = s.assist.chain;
  if (chain) {
    store.update(id, (x) => { delete x.assist.chain; });
    try { startRemediation(id, chain.scope); } catch (e) { setAssist(id, 'remediation', { status: 'idle', error: e.message }); }
  }
}

/** Triage, then fix what is real: one click (AI Remediation starts by itself when AI Triage ends). */
export function startFixAll(id, scope = 'fusion', log = console) {
  const session = store.load(id);
  if (session?.assist?.triage?.status === 'done') return startRemediation(id, scope, log);
  const started = startTriage(id, scope, log);
  store.update(id, (s) => { s.assist.chain = { scope, at: new Date().toISOString() }; });
  return store.load(id) ?? started;
}

/** Checkmarx One's AI Triage record, in the shape the page shows (as CxMissionZero reads it). */
export function triageFromBody(body) {
  if (!body) return null;
  const status = body.triageStatus || (body.jobStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : body.jobStatus === 'FAILED' ? 'FAILED' : '');
  if (!status) return null;
  const a = body.analysis || {};
  const first = (...v) => v.find((x) => typeof x === 'string' && x.trim())?.trim() || '';
  return {
    verdict: status,
    reachability: body.reachabilityStatus || a.reachability?.status || '',
    exploitability: body.exploitabilityStatus || a.exploitability?.status || '',
    confidence: a.confidence?.score || '',
    reason: first(body.reason, body.justification, body.explanation, body.reasoning, a.summary, a.exploitability?.reason, a.exploitability?.justification, a.reachability?.reason, body.summary),
  };
}

async function liveTriage(id, targets, log) {
  const session = store.load(id);
  const { projectId, scanId } = session.cx;
  const cx = client();
  const buckets = [];
  for (const type of ['sast', 'sca']) {
    const ids = [...new Set(targets.filter((f) => scannerType(f) === type).map((f) => f.alternateId))];
    if (ids.length) buckets.push({ scannerType: type, resultIDs: ids });
  }
  for (const f of targets) setItem(id, 'triage', f.id, { status: 'running' });
  const body = await cx.request('/api/ai-triage/triage', { method: 'POST', body: { scanID: scanId, buckets }, retries: 1 });
  setAssist(id, 'triage', { jobId: body?.triageID ?? body?.id ?? '', published: body?.published !== false });

  const deadline = Date.now() + Number(config.assist.timeoutMs);
  const pending = new Map(targets.map((f) => [f.id, f]));
  while (pending.size && Date.now() < deadline) {
    await sleep(Number(config.assist.pollIntervalMs));
    for (const [fid, f] of pending) {
      try {
        const rec = await cx.request(`/api/ai-triage/triage/${encodeURIComponent(projectId)}/${encodeURIComponent(groupId(f, projectId))}`, { retries: 1 });
        const t = triageFromBody(rec);
        if (!t || WAITING.has(t.verdict)) continue;
        setItem(id, 'triage', fid, { status: t.verdict === 'FAILED' ? 'failed' : 'done', ...t });
        pending.delete(fid);
      } catch (e) {
        if (e.status !== 404) log.warn?.(`AI Triage read failed for ${fid}: ${e.message}`);
      }
    }
  }
  for (const fid of pending.keys()) setItem(id, 'triage', fid, { status: 'failed', verdict: 'FAILED', reason: 'Checkmarx One had not returned a verdict within the time limit; it will appear in Checkmarx One when ready.' });
  finishTriage(id);
}

/** A stable pseudo-random number in [0,1) per finding, so the demo tells the same story every time. */
const hash01 = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };

function demoVerdict(f) {
  const kb = lookup(f);
  const where = f.file ? `${f.file.replace(/^\/[^/]+\//, '')}${f.line ? `:${f.line}` : ''}` : f.packageName || 'the flagged location';
  const r = hash01(f.id);
  if (f.fusionOnly) return { verdict: 'VULNERABLE', confidence: (0.86 + r * 0.11).toFixed(2), reachability: 'REACHABLE', exploitability: 'EXPLOITABLE', reason: f.fusionInsight || `${kb.whatItMeans} The path through ${where} is reachable from an external request.` };
  if (f.correlation?.direction === 'lowered') return { verdict: 'PROPOSED_NOT_EXPLOITABLE', confidence: (0.8 + r * 0.15).toFixed(2), reachability: 'NOT_REACHABLE', exploitability: 'NOT_EXPLOITABLE', reason: f.correlation.reason };
  if (f.correlation?.direction === 'raised') return { verdict: 'CONFIRMED', confidence: (0.88 + r * 0.1).toFixed(2), reachability: 'REACHABLE', exploitability: 'EXPLOITABLE', reason: f.correlation.reason };
  if (['CRITICAL', 'HIGH'].includes(f.severity)) return { verdict: 'VULNERABLE', confidence: (0.78 + r * 0.18).toFixed(2), reachability: 'REACHABLE', exploitability: 'EXPLOITABLE', reason: `${kb.whatItMeans} Input reaches ${where} without a sanitiser on the way.` };
  if (f.severity === 'MEDIUM') return r < 0.5
    ? { verdict: 'UNCERTAIN', confidence: (0.5 + r * 0.2).toFixed(2), reachability: 'REACHABLE', exploitability: 'UNKNOWN', reason: `${kb.whatItMeans} The code is reachable, but whether an attacker controls the input depends on the caller; a human should confirm.` }
    : { verdict: 'VULNERABLE', confidence: (0.7 + r * 0.2).toFixed(2), reachability: 'REACHABLE', exploitability: 'EXPLOITABLE', reason: `${kb.whatItMeans} Found at ${where}.` };
  return { verdict: 'PROPOSED_NOT_EXPLOITABLE', confidence: (0.82 + r * 0.14).toFixed(2), reachability: 'NOT_REACHABLE', exploitability: 'NOT_EXPLOITABLE', reason: `${where} is only reached from trusted, server-side code; no external input can influence it.` };
}

async function demoTriage(id, targets) {
  await sleep(900);
  for (const f of targets) {
    setItem(id, 'triage', f.id, { status: 'running' });
    await sleep(650 + hash01(f.id) * 900);
    setItem(id, 'triage', f.id, { status: 'done', ...demoVerdict(f) });
  }
  finishTriage(id);
}

// ---------------------------------------------------------------------------
// AI Remediation
// ---------------------------------------------------------------------------
export function startRemediation(id, scope = 'fusion', log = console) {
  const session = store.load(id);
  if (!session || session.stage !== 'complete') throw Object.assign(new Error('Results are not ready yet.'), { status: 409 });
  if (session.assist?.remediation?.status === 'running') throw Object.assign(new Error('AI Remediation is already running.'), { status: 409 });
  const triaged = session.assist?.triage?.items ?? {};
  const already = session.assist?.remediation?.items ?? {};
  // Findings AI Triage judged not exploitable are left alone; fixes already written are kept.
  const targets = scopeOf(session, scope).filter((f) => !SAFE.has(triaged[f.id]?.verdict) && triaged[f.id]?.verdict !== 'RISK_ACCEPTED' && already[f.id]?.status !== 'done');
  if (!targets.length) throw Object.assign(new Error('Nothing in that scope is left to remediate.'), { status: 400 });
  const items = { ...already, ...Object.fromEntries(targets.map((f) => [f.id, { status: 'queued' }])) };
  setAssist(id, 'remediation', { simulated: !liveMode(), status: 'running', scope, startedAt: new Date().toISOString(), finishedAt: null, requested: targets.length, items, error: null });
  audit({ type: 'assist', outcome: 'info', reason: `AI Remediation started for ${session.repo.url}: ${targets.length} finding(s), scope ${scope}${liveMode() ? '' : ' (simulated)'}` });
  (liveMode() ? liveRemediation(id, targets, log) : demoRemediation(id, targets)).catch((e) => {
    log.error?.(`AI Remediation for ${id} failed: ${e.message}`);
    setAssist(id, 'remediation', { status: 'failed', error: e.message, finishedAt: new Date().toISOString() });
  });
  return store.load(id);
}

function finishRemediation(id) {
  const s = store.load(id);
  const items = Object.values(s.assist.remediation.items);
  const summary = { fixed: items.filter((i) => i.status === 'done').length, failed: items.filter((i) => i.status === 'failed').length, files: items.reduce((n, i) => n + (i.files ?? 0), 0) };
  setAssist(id, 'remediation', { status: 'done', finishedAt: new Date().toISOString(), summary });
  audit({ type: 'assist', outcome: 'info', reason: `AI Remediation finished for ${s.repo.url}: ${summary.fixed} fix(es) across ${summary.files} file(s)` });
}

/** An AI Remediation result, in the shape the page shows: null while running, {failed} or the fix. */
export function remediationFromBody(body) {
  const r = body?.results?.[0];
  if (!r) return null;
  const job = String(r.jobStatus || r.status || '').toUpperCase();
  if (job === 'FAILED' || r.data?.error) return { failed: r.data?.error || r.autoPr?.error_msg || 'AI Remediation failed.' };
  const data = r.data;
  if (!r.finishedAt && !data?.summary && !data?.file_changes?.length) return null;
  const changes = (data?.file_changes || []).filter((c) => typeof c.diff === 'string').map((c) => ({ path: String(c.file_path || ''), diff: c.diff, analysis: c.analysis ? String(c.analysis) : '' }));
  return {
    summary: data?.summary || data?.analysis?.what || '',
    how: data?.analysis?.how || '',
    why: data?.analysis?.why || '',
    prUrl: /^https?:\/\//i.test(String(r.autoPr?.url || '')) ? String(r.autoPr.url) : '',
    files: changes.length,
    changes,
    tests: (data?.test_creation?.test_files || []).map((t) => String(t?.file_path || '')).filter(Boolean),
  };
}

async function liveRemediation(id, targets, log) {
  const session = store.load(id);
  const { scanId } = session.cx;
  const cx = client();
  for (const f of targets) {
    setItem(id, 'remediation', f.id, { status: 'running' });
    try {
      const body = await cx.request('/api/remediation/remediate', { method: 'POST', body: { scanID: scanId, buckets: [{ scannerType: scannerType(f), resultIDs: [f.alternateId] }] }, retries: 1 });
      setItem(id, 'remediation', f.id, { jobId: body?.remediationJobId ?? '' });
    } catch (e) {
      setItem(id, 'remediation', f.id, { status: 'failed', error: e.status === 402 ? 'Checkmarx One has no AI Remediation credits left.' : e.status === 403 ? 'This Checkmarx One account may not run AI Remediation.' : e.message });
      if (e.status === 402 || e.status === 403) { for (const g of targets.slice(targets.indexOf(f) + 1)) setItem(id, 'remediation', g.id, { status: 'failed', error: 'Not sent: an earlier request was refused.' }); break; }
    }
  }
  const deadline = Date.now() + Number(config.assist.timeoutMs);
  const pending = new Map(targets.filter((f) => store.load(id).assist.remediation.items[f.id].status === 'running').map((f) => [f.id, f]));
  while (pending.size && Date.now() < deadline) {
    await sleep(Number(config.assist.pollIntervalMs));
    for (const [fid, f] of pending) {
      try {
        const body = await cx.request(`/api/remediation/remediation-details/${encodeURIComponent(scanId)}/${encodeURIComponent(f.alternateId)}`, { retries: 1 });
        const fix = remediationFromBody(body);
        if (!fix) continue;
        setItem(id, 'remediation', fid, fix.failed ? { status: 'failed', error: fix.failed } : { status: 'done', ...fix });
        pending.delete(fid);
      } catch (e) {
        if (e.status !== 404) log.warn?.(`AI Remediation read failed for ${fid}: ${e.message}`);
      }
    }
  }
  for (const fid of pending.keys()) setItem(id, 'remediation', fid, { status: 'failed', error: 'Checkmarx One had not finished the fix within the time limit; it will appear in Checkmarx One when ready.' });
  finishRemediation(id);
}

// --- The demo's fixes: one secure pattern per kind of weakness -----------------
const FIXES = {
  sqli: { summary: 'Bind the user input as a query parameter instead of concatenating it into the SQL string.', how: 'The query is rewritten with a placeholder and the value passed separately, so the database never interprets input as SQL.', why: 'Parameterised queries remove the injection entirely rather than filtering characters.', before: ["const rows = await db.query(`SELECT * FROM products WHERE name LIKE '%${q}%'`);"], after: ['const rows = await db.query(\'SELECT * FROM products WHERE name LIKE ?\', [`%${q}%`]);'] },
  xss: { summary: 'Encode the value for HTML before it is written into the page.', how: 'Output goes through the framework\'s escaper; a Content-Security-Policy header is added as defence in depth.', why: 'Encoding at output is the one place that covers every path the value can take.', before: ['res.send(`<h1>Results for ${req.query.q}</h1>`);'], after: ["res.set('Content-Security-Policy', \"default-src 'self'\");", 'res.send(`<h1>Results for ${escapeHtml(req.query.q)}</h1>`);'] },
  authz: { summary: 'Check that the record belongs to the signed-in user before returning it.', how: 'The lookup is scoped to the current customer and a 404 is returned otherwise, so object ids cannot be enumerated.', why: 'Ownership must be enforced on the server for every object, not only in the UI.', before: ['const order = await orderService.findById(req.params.id);', 'res.json(order);'], after: ['const order = await orderService.findById(req.params.id);', "if (!order || order.customerId !== req.user.id) return res.status(404).json({ error: 'Not found' });", 'res.json(order);'] },
  authn: { summary: 'Bind the reset token to the account it was issued for.', how: 'The token lookup returns the user it belongs to; the email in the request body is no longer trusted.', why: 'A token proves possession for one account only; the account must come from the token, never from the request.', before: ['const token = await Token.verify(req.body.token);', 'const user = await User.findByEmail(req.body.email);'], after: ['const token = await Token.verify(req.body.token);', 'const user = await User.findById(token.userId);', "if (!user) return res.status(400).json({ error: 'Invalid or expired token' });"] },
  race: { summary: 'Make the check and the update one atomic database operation.', how: 'A conditional update claims the coupon only if it is still unused; concurrent requests see zero rows affected.', why: 'A check followed by a separate write can always interleave; the database must arbitrate.', before: ['if (coupon.used) throw new Error(\'Coupon already used\');', 'coupon.used = true; await coupon.save();'], after: ["const claimed = await Coupon.updateOne({ _id: coupon._id, used: false }, { $set: { used: true, usedAt: new Date() } });", "if (!claimed.modifiedCount) throw new Error('Coupon already used');"] },
  secrets: { summary: 'Move the credential out of the source into the environment and rotate it.', how: 'The literal is replaced by a configuration lookup that fails fast when unset; the old value must be revoked.', why: 'Anything committed to a repository should be treated as public.', before: ["const apiKey = 'sk_live_51H7xF9kLmNoPqRsTuVwXyZ';"], after: ['const apiKey = process.env.PAYMENT_API_KEY;', "if (!apiKey) throw new Error('PAYMENT_API_KEY is not set');"] },
  path: { summary: 'Resolve the path and refuse anything outside the allowed directory.', how: 'The requested name is joined to the base folder, normalised, and checked to still start with that folder.', why: 'Rejecting "../" by string matching is bypassable; comparing resolved paths is not.', before: ["const file = path.join(UPLOADS, req.params.name);"], after: ['const file = path.resolve(UPLOADS, req.params.name);', "if (!file.startsWith(path.resolve(UPLOADS) + path.sep)) return res.status(400).end();"] },
  ssrf: { summary: 'Allow-list the hosts the server may fetch and block internal ranges.', how: 'The URL is parsed, its host compared to an allow-list, and private/link-local addresses refused before the request is made.', why: 'Only an allow-list stops requests to cloud metadata and internal services.', before: ['const r = await fetch(req.query.url);'], after: ['const u = new URL(req.query.url);', "if (!ALLOWED_HOSTS.has(u.hostname) || u.protocol !== 'https:') return res.status(400).end();", 'const r = await fetch(u, { redirect: \'error\' });'] },
  redirect: { summary: 'Only redirect to relative paths within the application.', how: 'The destination is accepted only when it starts with a single slash.', why: 'Absolute destinations from input are the whole phishing problem.', before: ['res.redirect(req.query.next);'], after: ["const next = String(req.query.next || '/');", "res.redirect(/^\\/(?!\\/)/.test(next) ? next : '/');"] },
  crypto: { summary: 'Replace the weak algorithm with a modern one.', how: 'Password hashing moves to bcrypt with a work factor; other digests move to SHA-256.', why: 'MD5 and SHA-1 are reversible in practice for passwords and collidable for integrity.', before: ["const hash = crypto.createHash('md5').update(password).digest('hex');"], after: ['const hash = await bcrypt.hash(password, 12);'] },
  csrf: { summary: 'Require a CSRF token (or SameSite cookies) on state-changing requests.', how: 'The csurf middleware is mounted and the form carries the token.', why: 'Browsers send cookies cross-site unless told not to; the server must verify intent.', before: ["app.post('/account/email', updateEmail);"], after: ["app.use(csrf({ cookie: { sameSite: 'strict', httpOnly: true } }));", "app.post('/account/email', updateEmail);"] },
  iac: { summary: 'Set the resource to the secure value the finding expects.', how: 'Public access is blocked and encryption at rest switched on in the template.', why: 'Policy as code keeps the fix from regressing.', before: ['  acl    = "public-read"'], after: ['  acl    = "private"', '  server_side_encryption_configuration { rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } } }'] },
  logging: { summary: 'Return a generic error and keep the detail in the server log.', how: 'The stack trace no longer reaches the response; a correlation id is returned instead.', why: 'Internal details help an attacker plan the next step.', before: ['res.status(500).send(err.stack);'], after: ["logger.error({ err, requestId: req.id });", "res.status(500).json({ error: 'Something went wrong', requestId: req.id });"] },
  sca: { summary: 'Upgrade the package to the fixed version.', how: 'The dependency is bumped in the manifest and the lockfile regenerated.', why: 'The fix already exists upstream; staying behind keeps a public exploit path open.' },
  default: { summary: 'Validate the input before it reaches the sensitive call.', how: 'A strict schema check rejects anything unexpected at the boundary.', why: 'Allow-listing at the edge is the most general defence for this class of weakness.', before: ['const value = req.body.value;'], after: ["const value = schema.parse(req.body).value;"] },
};

function demoFix(f) {
  const kb = lookup(f);
  const key = f.underlyingType === 'sca' ? 'sca' : kb.key && FIXES[kb.key] ? kb.key : 'default';
  const t = FIXES[key];
  let changes;
  if (key === 'sca') {
    const name = (f.packageName || 'package').replace(/^[A-Za-z]+-/, '').split('-')[0];
    const fixed = f.recommendedVersion || 'latest';
    changes = [{ path: 'package.json', diff: `@@ -12,3 +12,3 @@\n   "dependencies": {\n-    "${name}": "${(f.packageName || '').split('-').pop() || '*'}",\n+    "${name}": "${fixed}",\n` }];
  } else {
    const file = (f.file || 'src/app.js').replace(/^\/[^/]+\//, '');
    const line = Math.max(1, (f.line || 10) - 1);
    const ctx = f.nodes?.[0]?.method ? `// in ${f.nodes[0].method}()` : '// …';
    changes = [{ path: file, diff: `@@ -${line},${t.before.length + 1} +${line},${t.after.length + 1} @@\n ${ctx}\n${t.before.map((l) => `-${l}`).join('\n')}\n${t.after.map((l) => `+${l}`).join('\n')}\n` }];
  }
  return { summary: t.summary, how: t.how, why: t.why, files: changes.length, changes, tests: key === 'sca' ? [] : [`test/${changes[0].path.replace(/^src\//, '').replace(/\.[a-z]+$/, '')}.security.test.js`] };
}

async function demoRemediation(id, targets) {
  await sleep(1200);
  for (const f of targets) {
    setItem(id, 'remediation', f.id, { status: 'running' });
    await sleep(1400 + hash01(f.id) * 1600);
    setItem(id, 'remediation', f.id, { status: 'done', ...demoFix(f) });
  }
  finishRemediation(id);
}

/** Resumes polls that were in flight when the server restarted (marks them to retry by hand). */
export function resumeAssist() {
  for (const s of store.listAll()) {
    for (const kind of ['triage', 'remediation']) {
      if (s.assist?.[kind]?.status === 'running') setAssist(s.id, kind, { status: 'failed', error: 'The server restarted while this was running. Run it again; Checkmarx One keeps any job it already started.', finishedAt: new Date().toISOString() });
    }
  }
}

/** The fixes of a session, joined to their findings, for the developer email and the page. */
export function fixes(session) {
  const items = session.assist?.remediation?.items ?? {};
  const verdicts = session.assist?.triage?.items ?? {};
  return all(session).filter((f) => items[f.id]?.status === 'done').map((f) => ({ finding: f, fix: items[f.id], verdict: verdicts[f.id] ?? null }));
}
