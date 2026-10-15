import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

// Without SMTP, emails land in data/outbox so nothing is silently lost.
const outbox = path.resolve(config.dataDir, 'outbox');

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function send({ to, subject, text, html }) {
  if (transport) {
    const info = await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { delivered: true, messageId: info.messageId };
  }
  fs.mkdirSync(outbox, { recursive: true });
  const file = path.join(outbox, `${Date.now()}-${String(to).replace(/[^a-z0-9@._-]/gi, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify({ to, subject, text, html }, null, 2));
  return { delivered: false, queuedAt: file };
}

export function resultsLink(session) {
  return `${config.publicBaseUrl}/s/${session.id}?k=${session.accessKey}`;
}

export function inviteEmail({ session, invitee, inviter }) {
  const link = resultsLink(session);
  const repo = session.repo.url;
  const subject = `${inviter.name} invited you to review security results for ${session.repo.owner}/${session.repo.repo}`;
  const text = [
    `Hi ${invitee.name || ''},`.trim(),
    '',
    `${inviter.name} (${inviter.email}) has invited you to the ${config.eventName} security review of ${repo}.`,
    'Checkmarx One is scanning the repository with Checkmarx Fusion switched on. The results page shows the issues Fusion found that rule-based tools missed, each explained in plain language.',
    '',
    `View the results: ${link}`,
    '',
    'This link is private to your team — please do not share it publicly.',
  ].join('\n');
  const html = `<p>Hi ${escape(invitee.name)},</p>
<p><strong>${escape(inviter.name)}</strong> (${escape(inviter.email)}) has invited you to the ${escape(config.eventName)} security review of <code>${escape(repo)}</code>.</p>
<p>Checkmarx One is scanning the repository with <strong>Checkmarx Fusion</strong> switched on. The results page highlights issues Fusion found that rule-based tools missed, each explained in plain language for engineers and executives.</p>
<p><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;background:#5b2be0;color:#fff;border-radius:6px;text-decoration:none">View the security results</a></p>
<p style="color:#666;font-size:12px">This link is private to your team — please do not share it publicly.</p>`;
  return { to: invitee.email, subject, text, html };
}

export function scanCompleteEmail({ session, to }) {
  const link = resultsLink(session);
  const s = session.summary ?? {};
  const subject = `Your ${config.eventName} scan results are ready: ${session.repo.owner}/${session.repo.repo}`;
  const text = `Your scan of ${session.repo.url} is complete. ${s.total ?? 0} issues found, ${s.fusionOnly ?? 0} of them found only by Checkmarx Fusion.\n\nView them: ${link}`;
  const html = `<p>Your scan of <code>${escape(session.repo.url)}</code> is complete.</p>
<p><strong>${s.total ?? 0}</strong> issues found — <strong>${s.fusionOnly ?? 0}</strong> of them found only by Checkmarx Fusion.</p>
<p><a href="${escape(link)}">View the results</a></p>`;
  return { to, subject, text, html };
}
