import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from './config.js';

// Built on demand so SMTP settings saved in the admin panel apply without a restart.
let cached = { key: null, transport: null };
function getTransport() {
  const { host, port, secure, user, pass, requireAuth, rejectUnauthorized } = config.smtp;
  if (!host) return null;
  const key = JSON.stringify([host, port, secure, user, pass, requireAuth, rejectUnauthorized]);
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure,
        auth: requireAuth && user ? { user, pass } : undefined,
        tls: { rejectUnauthorized },
      }),
    };
  }
  return cached.transport;
}

/** Sends a test message; used by the admin panel's "Send a test email". */
export async function verifySmtp() {
  const transport = getTransport();
  if (!transport) throw new Error('No mail server is configured.');
  await transport.verify();
  return { ok: true, host: config.smtp.host };
}

// Without SMTP, emails land in data/outbox so nothing is silently lost.
const outbox = () => path.resolve(config.dataDir, 'outbox');
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fromHeader = () => {
  const address = config.smtp.from || config.smtp.user;
  return config.smtp.fromName && address ? `"${config.smtp.fromName.replace(/"/g, '')}" <${address}>` : address;
};

export async function send({ to, subject, text, html }) {
  const transport = getTransport();
  if (transport) {
    const info = await transport.sendMail({ from: fromHeader(), to, subject, text, html });
    return { delivered: true, messageId: info.messageId };
  }
  fs.mkdirSync(outbox(), { recursive: true });
  const file = path.join(outbox(), `${Date.now()}-${String(to).replace(/[^a-z0-9@._-]/gi, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify({ to, subject, text, html }, null, 2));
  return { delivered: false, queuedAt: file };
}

export function resultsLink(session) {
  return `${config.publicBaseUrl}/s/${session.id}?k=${session.accessKey}`;
}

/** The branded head of every email: logo or app name, company, accent rule. */
function head(title) {
  const b = config.branding;
  const accent = b.accentColor || '#5b2be0';
  const logo = b.logoUrl && /^https:/i.test(b.logoUrl) ? `<img src="${escape(b.logoUrl)}" alt="${escape(b.companyName || b.appName)}" height="${Number(b.logoHeight) || 36}" style="display:block;max-height:${Number(b.logoHeight) || 36}px">` : `<strong style="font-size:18px">${escape(b.appName)}</strong>`;
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1b1a2e">
  <div style="padding:18px 0;border-bottom:3px solid ${escape(accent)};display:flex;align-items:center;gap:12px">${logo}<span style="color:#67687e;font-size:13px;margin-left:auto">${escape(b.companyName)}</span></div>
  <h2 style="font-weight:600;margin:20px 0 8px">${escape(title)}</h2>`;
}
const foot = () => `<p style="color:#67687e;font-size:12px;border-top:1px solid #e3e1ee;padding-top:12px;margin-top:28px">${escape(config.branding.footer || `${config.event.name} · ${config.branding.companyName}`)} · This link is private to your team; please do not share it publicly.</p></div>`;

export function inviteEmail({ session, invitee, inviter }) {
  const link = resultsLink(session);
  const repo = session.repo.url;
  const subject = `${inviter.name} invited you to the ${config.event.name} security review of ${session.repo.owner}/${session.repo.repo}`;
  const text = [
    `Hi ${invitee.name || ''},`.trim(),
    '',
    `${inviter.name} (${inviter.email}) has invited you to the ${config.event.name} security review of ${repo}.`,
    'Checkmarx One is scanning the repository with Checkmarx Fusion switched on. The results page shows the issues Fusion found that rule-based tools missed, each explained in plain language.',
    '',
    `View the results: ${link}`,
  ].join('\n');
  const html = `${head('You are invited to a security review')}
<p>Hi ${escape(invitee.name)},</p>
<p><strong>${escape(inviter.name)}</strong> (${escape(inviter.email)}) has invited you to the ${escape(config.event.name)} security review of <code>${escape(repo)}</code>.</p>
<p>Checkmarx One is scanning the repository with <strong>Checkmarx Fusion</strong> switched on. The results page highlights what Fusion found that rule-based tools missed, each explained in plain language for engineers and executives.</p>
<p><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;background:${escape(config.branding.accentColor || '#5b2be0')};color:#fff;border-radius:6px;text-decoration:none">View the security results</a></p>${foot()}`;
  return { to: invitee.email, subject, text, html };
}

export function scanCompleteEmail({ session, to }) {
  const link = resultsLink(session);
  const o = session.outcome ?? {};
  const c = o.counts ?? {};
  const subject = `Your ${config.event.name} results: ${session.repo.owner}/${session.repo.repo}`;
  const text = `${o.headline ?? 'Your scan is complete.'}\n\n${c.total ?? 0} findings, ${c.fusionOnly ?? 0} found only by Checkmarx Fusion.\n\nView them: ${link}`;
  const html = `${head(o.headline ?? 'Your scan is complete')}
<p><strong>${c.total ?? 0}</strong> findings — <strong>${c.fusionOnly ?? 0}</strong> found only by Checkmarx Fusion. Exposure: <strong>${escape(o.exposure?.band ?? '')}</strong>.</p>
<p>${escape(o.verdict ?? '')}</p>
<p><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;background:${escape(config.branding.accentColor || '#5b2be0')};color:#fff;border-radius:6px;text-decoration:none">Open the results</a></p>${foot()}`;
  return { to, subject, text, html };
}

/** The developer brief: every fix AI Remediation wrote, with its patch, for the technical owner. */
export function fixesEmail({ session, to, fixes }) {
  const link = resultsLink(session);
  const repo = `${session.repo.owner}/${session.repo.repo}`;
  const subject = `${fixes.length} AI-written fix${fixes.length === 1 ? '' : 'es'} for ${repo} (${config.event.name})`;
  const block = ({ finding, fix, verdict }) => {
    const title = finding.explanation?.plainTitle || finding.title;
    const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : finding.packageName || '';
    return { title, where, severity: finding.severity, fusion: finding.fusionOnly, verdict: verdict?.verdict, summary: fix.summary, how: fix.how, why: fix.why, patch: (fix.changes ?? []).map((c) => `--- a/${c.path}\n+++ b/${c.path}\n${c.diff}`).join('\n'), prUrl: fix.prUrl };
  };
  const blocks = fixes.map(block);
  const text = [
    `Checkmarx One scanned ${repo} with Fusion during ${config.event.name}. AI Remediation wrote ${fixes.length} fix(es); each is below as a patch.`,
    '',
    ...blocks.flatMap((b, i) => [`${i + 1}. [${b.severity}] ${b.title}${b.fusion ? ' (found only by Fusion)' : ''}`, b.where ? `   Where: ${b.where}` : '', `   Fix: ${b.summary}`, b.how ? `   How: ${b.how}` : '', b.prUrl ? `   Pull request: ${b.prUrl}` : '', '', b.patch, '']),
    `Full results: ${link}`,
  ].filter((l) => l !== undefined).join('\n');
  const html = `${head(`${fixes.length} AI-written fix${fixes.length === 1 ? '' : 'es'} for ${repo}`)}
<p>Checkmarx One scanned <code>${escape(repo)}</code> with <strong>Fusion</strong> during ${escape(config.event.name)}. <strong>AI Remediation</strong> wrote the fixes below; each patch applies with <code>git apply</code>.</p>
${blocks.map((b, i) => `<div style="margin:18px 0;padding:14px 16px;border:1px solid #e3e1ee;border-radius:10px">
<p style="margin:0 0 4px"><strong>${i + 1}. ${escape(b.title)}</strong> <span style="font-size:12px;color:#67687e">${escape(b.severity)}${b.fusion ? ' · found only by Fusion' : ''}${b.verdict ? ` · AI Triage: ${escape(b.verdict.replace(/_/g, ' ').toLowerCase())}` : ''}</span></p>
${b.where ? `<p style="margin:0 0 8px;font-family:monospace;font-size:12.5px;color:#67687e">${escape(b.where)}</p>` : ''}
<p style="margin:0 0 6px"><strong>Fix:</strong> ${escape(b.summary)}</p>
${b.how ? `<p style="margin:0 0 6px"><strong>How:</strong> ${escape(b.how)}</p>` : ''}
${b.why ? `<p style="margin:0 0 6px;color:#67687e">${escape(b.why)}</p>` : ''}
${b.prUrl ? `<p style="margin:0 0 6px"><a href="${escape(b.prUrl)}">Open the pull request</a></p>` : ''}
<pre style="background:#15131f;color:#e8e6f2;padding:12px;border-radius:8px;font-size:12px;overflow:auto;white-space:pre">${escape(b.patch)}</pre></div>`).join('')}
<p><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;background:${escape(config.branding.accentColor || '#5b2be0')};color:#fff;border-radius:6px;text-decoration:none">Open the full results</a></p>${foot()}`;
  return { to, subject, text, html };
}

/** The board brief (public/board.js), as an email: the same page, in table layout for mail clients. */
export function boardEmail({ to, session, b }) {
  const link = resultsLink(session);
  const subject = `Board brief: ${b.company} — ${b.repo} secured against AI-era unknowns (${config.event.name})`;
  const kpis = b.kpis.map((k, i) => `<td style="width:25%;padding:10px;border:1px solid #e3e1ee;border-radius:8px;vertical-align:top;${i === 3 ? 'background:#1d5a38;color:#fff' : ''}"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.8">${escape(k.label)}</div><div style="font-size:24px;font-weight:700;margin:4px 0">${escape(k.value)}</div><div style="font-size:12px;opacity:.8">${escape(k.note)}</div></td>`).join('');
  const text = [
    b.headline, '',
    ...b.kpis.map((k) => `${k.label}: ${k.value} (${k.note})`), '',
    'Why it matters now:', ...b.why.map((w) => `- ${w}`), '',
    `Exposure: ${b.exposure.before} (${b.exposure.beforeBand}) → ${b.exposure.after} (${b.exposure.afterBand}) after AI fixes.`,
    `Cost: ${b.cost.hours} engineering hours saved; ${b.cost.credits} Checkmarx One credits (${b.cost.creditCost}); net saving ${b.cost.net}${b.cost.roi ? ` (${b.cost.roi}× return)` : ''}.`, '',
    'Process:', ...b.process.map((p) => `- ${p.step}: ${p.what}`), '',
    'Recommendations:', ...b.recommendations.map((r, i) => `${i + 1}. ${r}`), '',
    `Full results: ${link}`,
  ].join('\n');
  const html = `${head(`Board brief · ${b.company}`)}
<p style="font-size:17px;line-height:1.4"><strong>${escape(b.headline)}</strong></p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:6px;margin:8px -6px"><tr>${kpis}</tr></table>
<h3 style="margin:18px 0 6px">Why it matters now</h3><ul style="padding-left:18px;margin:0">${b.why.map((w) => `<li style="margin:4px 0">${escape(w)}</li>`).join('')}</ul>
<h3 style="margin:18px 0 6px">Exposure</h3><p style="margin:0">${b.exposure.before} (${escape(b.exposure.beforeBand)}) → <strong>${b.exposure.after} (${escape(b.exposure.afterBand)})</strong> after AI fixes.</p>
<h3 style="margin:18px 0 6px">Cost effectiveness</h3><p style="margin:0">${escape(String(b.cost.hours))} engineering hours saved at ${escape(b.cost.rate)}/h · value ${escape(b.cost.gross)} · ${b.cost.credits} credits (${escape(b.cost.creditCost)}) · <strong>net ${escape(b.cost.net)}${b.cost.roi ? ` · ${b.cost.roi}× return` : ''}</strong></p>
<h3 style="margin:18px 0 6px">The process${b.minutes ? ` · ${b.minutes} minute${b.minutes === 1 ? '' : 's'} end to end` : ''}</h3><ol style="padding-left:18px;margin:0">${b.process.map((p) => `<li style="margin:3px 0"><strong>${escape(p.step)}</strong> — ${escape(p.what)}</li>`).join('')}</ol>
<h3 style="margin:18px 0 6px">Recommendations to the board</h3><ol style="padding-left:18px;margin:0">${b.recommendations.map((r) => `<li style="margin:4px 0">${escape(r)}</li>`).join('')}</ol>
<p style="font-size:12px;color:#67687e;margin-top:14px">Prepared by ${escape(b.appName)} on Checkmarx One${b.tenant ? ` · tenant ${escape(b.tenant)}` : ''}${b.scan ? ` · scan ${escape(b.scan)}` : ''} · ${b.live ? 'live results' : 'demo results'}.</p>
<p><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;background:${escape(config.branding.accentColor || '#5b2be0')};color:#fff;border-radius:6px;text-decoration:none">Open the full results</a></p>${foot()}`;
  return { to, subject, text, html };
}
