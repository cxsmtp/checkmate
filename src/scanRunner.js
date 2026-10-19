import { config, isLive } from './config.js';
import * as store from './store.js';
import * as cx from './checkmarx.js';
import { demoResults, demoScanOptions, demoFusion } from './demo.js';
import { classify } from './fusion.js';
import { explainFindings } from './explain.js';
import { buildOutcome } from './outcome.js';
import { send, scanCompleteEmail } from './mailer.js';
import * as samples from './samples.js';

/**
 * One visitor's journey after registration:
 *   options   → what the tenant offers (engines, Fusion, LLM models, presets) is fetched
 *   profile   → the visitor chooses (or the defaults are taken), and the scan starts
 *   project / application / scan / correlating → Checkmarx One works; the page follows live
 *   results   → /api/results + Fusion's risk-score changes and application map are merged
 *   complete  → the outcome is written and the team is told
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

function setStage(id, stage, extra = {}) {
  return store.update(id, (s) => {
    s.stage = stage;
    Object.assign(s, extra);
    s.timeline = [...(s.timeline ?? []), { stage, at: new Date().toISOString() }];
  });
}

const liveMode = () => isLive();

/** Step 1: find out what this tenant can run, and wait for the visitor's choice (or take the defaults). */
export async function prepareScan(id, log = console) {
  let options;
  try {
    options = liveMode() ? await cx.scanOptions() : demoScanOptions();
  } catch (err) {
    log.warn?.(`Could not read the tenant's scan options: ${err.message}`);
    options = { ...demoScanOptions(), source: 'defaults', warning: err.message };
  }
  const session = store.update(id, (s) => {
    s.options = options;
    s.stage = 'profile';
    s.timeline = [...(s.timeline ?? []), { stage: 'profile', at: new Date().toISOString() }];
  });
  if (!config.scan.letVisitorChoose) return startScan(id, {}, log);
  return session;
}

/** Step 2: the visitor's choice is fixed and the scan begins. */
export function startScan(id, choice = {}, log = console) {
  const session = store.load(id);
  if (!session) throw new Error('Session not found');
  if (session.stage !== 'profile') return session;
  const profile = cx.resolveProfile(session.options, choice);
  const updated = setStage(id, 'queued', { profile });
  runScan(id, log);
  return updated;
}

async function runLive(session, log) {
  const { repo, profile } = session;
  const branch = session.branch || config.checkmarx.defaultBranch;
  let { projectId, scanId, applicationId } = session.cx ?? {};

  if (!scanId) {
    setStage(session.id, 'creating-project');
    const projectName = `${config.checkmarx.projectPrefix}${repo.owner}-${repo.repo}`;
    const project = await cx.ensureProject(projectName, repo.url, branch);
    projectId = project.id;
    if (config.fusion.correlate && profile.fusion) {
      try {
        const application = await cx.ensureApplication(`${config.checkmarx.projectPrefix}${repo.owner}-${repo.repo}`, projectName);
        applicationId = application.id;
      } catch (err) {
        log.warn?.(`Application for Fusion correlation not available: ${err.message}`);
      }
    }
    setStage(session.id, 'starting-scan');
    const scan = await cx.startScan({ projectId, repoUrl: repo.url, branch, profile, tags: { checkmateSession: session.id } });
    scanId = scan.id;
    store.update(session.id, (s) => {
      s.cx = { projectId, scanId, applicationId, branch, url: cx.scanUiUrl(projectId, scanId), config: cx.buildScanConfig(profile) };
    });
  }

  setStage(session.id, 'scanning');
  const deadline = Date.now() + config.checkmarx.scanTimeoutMs;
  for (;;) {
    const scan = await cx.getScan(scanId);
    store.update(session.id, (s) => {
      s.cx = { ...s.cx, status: scan.status, engines: (scan.statusDetails ?? []).filter((d) => d.name !== 'general') };
    });
    if (cx.TERMINAL.has(scan.status)) {
      if (scan.status === 'Failed' || scan.status === 'Canceled') {
        const reason = (scan.statusDetails ?? []).filter((d) => d.details).map((d) => `${d.name}: ${d.details}`).join('; ');
        throw new Error(`Scan ${scan.status.toLowerCase()}${reason ? ` — ${reason}` : ''}`);
      }
      break;
    }
    if (Date.now() > deadline) throw new Error('The scan is taking longer than expected; its results will be in Checkmarx One.');
    await sleep(config.checkmarx.pollIntervalMs);
  }

  // Fusion correlation across the application: optional, never fatal.
  let fusion = { riskScores: [], map: null, status: 'skipped' };
  if (applicationId && config.fusion.correlate && profile.fusion) {
    setStage(session.id, 'correlating');
    try {
      await cx.startFusion(applicationId);
      const until = Date.now() + config.fusion.timeoutMs;
      for (;;) {
        const status = await cx.fusionStatus(applicationId);
        store.update(session.id, (s) => {
          s.fusionStage = { stage: Number(status.stage) || 0, description: status.stageDescription || status.scanStatus, status: status.scanStatus };
        });
        if (cx.FUSION_TERMINAL.has(status.scanStatus)) {
          if (status.scanStatus === 'Failed') throw new Error(status.errorMessage || 'Fusion scan failed');
          break;
        }
        if (Date.now() > until) throw new Error('Fusion correlation did not finish in time');
        await sleep(Math.min(config.checkmarx.pollIntervalMs, 10_000));
      }
      const [riskScores, map] = await Promise.all([cx.fusionRiskScores(applicationId, [scanId]), cx.fusionMap(applicationId)]);
      fusion = { riskScores, map, status: 'completed' };
    } catch (err) {
      log.warn?.(`Fusion correlation: ${err.message}`);
      fusion = { riskScores: [], map: null, status: 'unavailable', error: err.message };
    }
  }

  setStage(session.id, 'fetching-results');
  return { raw: await cx.getResults(scanId), fusion };
}

async function runDemo(session) {
  const engines = [...session.profile.engines.map((name) => ({ name, status: 'Queued' })), ...(session.profile.fusion ? [{ name: 'ai', status: 'Queued' }] : [])];
  const scanId = `demo-${session.id.slice(0, 8)}`;
  store.update(session.id, (s) => {
    s.cx = { projectId: 'demo', scanId, applicationId: 'demo-app', status: 'Running', engines, demo: true, config: cx.buildScanConfig(session.profile) };
  });
  setStage(session.id, 'scanning');
  for (let i = 0; i < engines.length; i++) {
    engines[i].status = 'Running';
    store.update(session.id, (s) => { s.cx.engines = engines.map((e) => ({ ...e })); });
    await sleep(2200);
    engines[i].status = 'Completed';
  }
  store.update(session.id, (s) => { s.cx.status = 'Completed'; s.cx.engines = engines.map((e) => ({ ...e })); });
  let fusion = { riskScores: [], map: null, status: 'skipped' };
  if (session.profile.fusion) {
    setStage(session.id, 'correlating');
    const steps = ['Mapping microservices', 'Reading cloud resources', 'Correlating findings across engines', 'Scoring exploitable paths'];
    for (let i = 0; i < steps.length; i++) {
      store.update(session.id, (s) => { s.fusionStage = { stage: Math.round(((i + 1) / steps.length) * 100), description: steps[i], status: 'In Progress' }; });
      await sleep(1800);
    }
    fusion = { ...demoFusion(scanId), status: 'completed' };
  }
  setStage(session.id, 'fetching-results');
  const raw = demoResults().filter((r) => session.profile.fusion || !(r.type === 'sast' && r.data?.queryId === 0));
  return { raw, fusion };
}

export async function runScan(id, log = console) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const session = store.load(id);
    const { raw, fusion } = liveMode() ? await runLive(session, log) : await runDemo(session);

    const { fusionOnly, others, summary } = classify(raw);
    attachFusionCorrelation(fusionOnly, others, fusion);
    setStage(id, 'explaining', { summary });
    explainFindings(fusionOnly, others);
    const outcome = buildOutcome(fusionOnly, others, { profile: session.profile, repoName: `${session.repo.owner}/${session.repo.repo}` });
    outcome.correlation = { status: fusion.status, error: fusion.error, changed: fusion.riskScores.length, raised: fusion.riskScores.filter((r) => r.newRiskValue > r.oldRiskValue).length, lowered: fusion.riskScores.filter((r) => r.newRiskValue < r.oldRiskValue).length };

    const done = setStage(id, 'complete', { fusionOnly, others, summary, outcome, fusionMap: fusion.map, completedAt: new Date().toISOString() });
    if (done.sampleId) samples.recordScan(done.sampleId, done.id, done.completedAt, !done.cx?.demo);
    if (done.kind === 'sample-refresh') return;

    const recipients = [done.customer?.email, done.technical?.email].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const to of recipients) {
      await send(scanCompleteEmail({ session: done, to })).catch((e) => log.warn?.(`Completion email to ${to} failed: ${e.message}`));
    }
  } catch (err) {
    log.error?.(`Scan for session ${id} failed: ${err.message}`);
    setStage(id, 'error', { error: err.message });
  } finally {
    running.delete(id);
  }
}

/** Fusion's risk-score changes land on the findings they are about (by result id). */
function attachFusionCorrelation(fusionOnly, others, fusion) {
  const byId = new Map([...fusionOnly, ...others].map((f) => [f.id, f]));
  for (const r of fusion.riskScores ?? []) {
    const f = byId.get(String(r.resultId)) ?? byId.get(decodeURIComponent(String(r.resultId)));
    if (!f) continue;
    f.correlation = {
      oldRisk: Number(r.oldRiskValue) || 0,
      newRisk: Number(r.newRiskValue) || 0,
      direction: r.newRiskValue > r.oldRiskValue ? 'raised' : r.newRiskValue < r.oldRiskValue ? 'lowered' : 'unchanged',
      with: r.correlatedEngine || '',
      reason: r.resultInfo || '',
    };
  }
  // A Fusion finding's own words, when the result carried them (demo, or a future API field).
}

/** Picks up scans that were in flight when the server restarted. */
export function resumeInFlight(log = console) {
  for (const s of store.listAll()) {
    if (['complete', 'error', 'profile'].includes(s.stage)) continue;
    if (s.stage === 'options') prepareScan(s.id, log);
    else if (liveMode() && s.cx?.scanId) runScan(s.id, log);
    else if (!liveMode()) runScan(s.id, log);
    else setStage(s.id, 'error', { error: 'The server restarted before the scan started. Please register again.' });
  }
}

/** A visitor picked a sample whose recent scan can be reused: they get those results at once. */
export function reuseSampleScan(id, sourceId) {
  const source = store.load(sourceId);
  if (source?.stage !== 'complete') return false;
  // Never show a simulated result as a real one, or the other way round.
  if (Boolean(source.cx?.demo) === liveMode()) return false;
  const { fusionOnly, others, summary, outcome, fusionMap, cx: scan, completedAt, profile } = source;
  setStage(id, 'complete', { fusionOnly, others, summary, outcome, fusionMap, cx: scan, completedAt, profile, reusedFrom: { sessionId: sourceId, completedAt } });
  return true;
}
