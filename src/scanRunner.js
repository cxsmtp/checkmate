import { config } from './config.js';
import * as store from './store.js';
import * as cx from './checkmarx.js';
import { demoResults } from './demo.js';
import { classify } from './fusion.js';
import { explainFindings, executiveSummary } from './explain.js';
import { send, scanCompleteEmail } from './mailer.js';
import * as samples from './samples.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

function setStage(id, stage, extra = {}) {
  return store.update(id, (s) => {
    s.stage = stage;
    Object.assign(s, extra);
    s.timeline = [...(s.timeline ?? []), { stage, at: new Date().toISOString() }];
  });
}

async function runLive(session) {
  const { repo } = session;
  const branch = session.branch || config.checkmarx.defaultBranch;
  let { projectId, scanId } = session.cx ?? {};

  if (!scanId) {
    setStage(session.id, 'creating-project');
    const project = await cx.ensureProject(`${config.checkmarx.projectPrefix}${repo.owner}-${repo.repo}`, repo.url, branch);
    projectId = project.id;
    setStage(session.id, 'starting-scan');
    const scan = await cx.startScan({ projectId, repoUrl: repo.url, branch, tags: { checkmateSession: session.id } });
    scanId = scan.id;
    store.update(session.id, (s) => {
      s.cx = { projectId, scanId, branch, url: cx.scanUiUrl(projectId, scanId) };
    });
  }

  setStage(session.id, 'scanning');
  const deadline = Date.now() + config.checkmarx.scanTimeoutMs;
  for (;;) {
    const scan = await cx.getScan(scanId);
    store.update(session.id, (s) => {
      s.cx = { ...s.cx, status: scan.status, engines: scan.statusDetails ?? [] };
    });
    if (cx.TERMINAL.has(scan.status)) {
      if (scan.status === 'Failed' || scan.status === 'Canceled') {
        const reason = (scan.statusDetails ?? []).filter((d) => d.details).map((d) => `${d.name}: ${d.details}`).join('; ');
        throw new Error(`Scan ${scan.status.toLowerCase()}${reason ? ` — ${reason}` : ''}`);
      }
      break;
    }
    if (Date.now() > deadline) throw new Error('Scan is taking longer than expected; results will be in Checkmarx One.');
    await sleep(config.checkmarx.pollIntervalMs);
  }

  setStage(session.id, 'fetching-results');
  return cx.getResults(scanId);
}

async function runDemo(session) {
  const engines = ['sast', 'sca', 'kics', 'secrets', 'fusion'].map((name) => ({ name, status: 'Queued' }));
  store.update(session.id, (s) => {
    s.cx = { projectId: 'demo', scanId: `demo-${session.id.slice(0, 8)}`, status: 'Running', engines, demo: true };
  });
  setStage(session.id, 'scanning');
  for (let i = 0; i < engines.length; i++) {
    await sleep(3000);
    engines[i].status = 'Completed';
    store.update(session.id, (s) => {
      s.cx.engines = engines.map((e, j) => (j === i + 1 ? { ...e, status: 'Running' } : e));
    });
  }
  store.update(session.id, (s) => {
    s.cx.status = 'Completed';
  });
  setStage(session.id, 'fetching-results');
  return demoResults();
}

export async function runScan(id, log = console) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const session = store.load(id);
    const raw = config.mode === 'live' ? await runLive(session) : await runDemo(session);

    const { fusionOnly, others, summary } = classify(raw);
    setStage(id, 'explaining', { summary });
    await explainFindings(fusionOnly, others, log);
    const executive = await executiveSummary(fusionOnly, others, summary, `${session.repo.owner}/${session.repo.repo}`, log);

    const done = setStage(id, 'complete', { fusionOnly, others, summary, executive, completedAt: new Date().toISOString() });
    if (done.sampleId) samples.recordScan(done.sampleId, done.id, done.completedAt);
    if (done.kind === 'sample-refresh') return; // started from the admin panel: nobody to email

    const recipients = [done.customer.email, done.technical.email].filter((v, i, a) => a.indexOf(v) === i);
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

/** Picks up scans that were in flight when the server restarted. */
export function resumeInFlight(log = console) {
  for (const s of store.listAll()) {
    if (!['complete', 'error'].includes(s.stage)) {
      if (config.mode === 'live' && s.cx?.scanId) runScan(s.id, log);
      else if (config.mode !== 'live') runScan(s.id, log);
      else setStage(s.id, 'error', { error: 'Server restarted before the scan was started. Please register again.' });
    }
  }
}

/**
 * A visitor picked a sample whose recent scan can be reused: they get those
 * results at once (the page says when that scan ran).
 */
export function reuseSampleScan(id, sourceId) {
  const source = store.load(sourceId);
  if (source?.stage !== 'complete') return false;
  const { fusionOnly, others, summary, executive, cx: scan, completedAt } = source;
  setStage(id, 'complete', { fusionOnly, others, summary, executive, cx: scan, completedAt, reusedFrom: { sessionId: sourceId, completedAt } });
  return true;
}
