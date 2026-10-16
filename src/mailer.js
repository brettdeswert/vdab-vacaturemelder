import nodemailer from 'nodemailer';
import { config, missingMailConfig } from './config.js';
import { withRetry } from './retry.js';

let transporter = null;

function getTransporter() {
  const missing = missingMailConfig();
  if (missing.length > 0) {
    throw new Error(
      `Mailconfiguratie onvolledig. Vul deze velden in .env in: ${missing.join(', ')}`,
    );
  }
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('nl-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function vacatureHtml(v) {
  const meta = [v.bedrijf, v.locatie, v.contract, v.ervaring, v.tijdsregeling]
    .filter(Boolean)
    .map(escape)
    .join(' &middot; ');
  const badge = v.knelpuntberoep
    ? '<span style="background:#fff3cd;color:#664d03;border-radius:3px;padding:1px 6px;font-size:12px;margin-left:6px;">knelpuntberoep</span>'
    : '';
  const jobs = v.aantalJobs > 1 ? ` (${v.aantalJobs} plaatsen)` : '';
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e6e6e6;">
        <a href="${escape(v.url)}" style="font-size:16px;font-weight:600;color:#0057b8;text-decoration:none;">${escape(v.titel)}</a>${badge}
        <div style="color:#444;font-size:14px;margin-top:4px;">${meta}${jobs}</div>
        <div style="color:#777;font-size:12px;margin-top:4px;">Online sinds ${escape(formatDate(v.gepubliceerd))}</div>
      </td>
    </tr>`;
}

function buildHtml(groups, totaal) {
  const blocks = groups
    .map(({ search, vacatures, extra }) => {
      const rows = vacatures.map(vacatureHtml).join('');
      const meer =
        extra > 0
          ? `<p style="font-size:14px;color:#555;">En nog <strong>${extra}</strong> andere nieuwe vacature(s) &mdash; <a href="${escape(search.url)}" style="color:#0057b8;">bekijk de volledige zoekopdracht</a>.</p>`
          : '';
      return `
        <h2 style="font-size:15px;color:#333;margin:28px 0 0;text-transform:uppercase;letter-spacing:.04em;">${escape(search.naam)}</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${rows}</table>
        ${meer}`;
    })
    .join('');

  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
    <p style="margin:0 0 4px;font-size:13px;color:#0057b8;font-weight:600;">VDAB Vacaturemelder</p>
    <h1 style="font-size:22px;margin:0;color:#111;">${totaal} nieuwe vacature${totaal === 1 ? '' : 's'}</h1>
    ${blocks}
    <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e6e6e6;font-size:12px;color:#888;">
      Automatisch verstuurd door je lokale VDAB-vacaturemelder.
    </p>
  </div>
</body></html>`;
}

function buildText(groups, totaal) {
  const lines = [`${totaal} nieuwe vacature(s) op VDAB`, ''];
  for (const { search, vacatures, extra } of groups) {
    lines.push(`== ${search.naam} ==`);
    for (const v of vacatures) {
      lines.push(`- ${v.titel} | ${v.bedrijf} | ${v.locatie}`);
      lines.push(`  ${[v.contract, v.ervaring].filter(Boolean).join(' | ')}`);
      lines.push(`  online sinds ${formatDate(v.gepubliceerd)}`);
      lines.push(`  ${v.url}`);
    }
    if (extra > 0) lines.push(`... en nog ${extra} andere: ${search.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Bouwt de mail op zonder hem te versturen.
 * groups: [{ search, vacatures, extra }]
 */
export function renderMail(groups) {
  const totaal = groups.reduce((sum, g) => sum + g.vacatures.length + g.extra, 0);
  const eerste = groups[0]?.vacatures[0];
  const subject =
    totaal === 1 && eerste
      ? `Nieuwe VDAB-vacature: ${eerste.titel} (${eerste.bedrijf})`
      : `${totaal} nieuwe VDAB-vacatures`;
  return { subject, totaal, text: buildText(groups, totaal), html: buildHtml(groups, totaal) };
}

/** Verstuurt één mail met alle nieuwe vacatures. */
export async function sendNewVacatures(groups) {
  const { subject, totaal, text, html } = renderMail(groups);
  await withRetry('Mail versturen', () =>
    getTransporter().sendMail({
      from: config.mailFrom,
      to: config.mailTo.join(', '),
      subject,
      text,
      html,
    }),
  );
  return { subject, totaal };
}

/** Stuurt een testmail om de SMTP-instellingen te controleren. */
export async function sendTestMail() {
  await getTransporter().verify();
  await getTransporter().sendMail({
    from: config.mailFrom,
    to: config.mailTo.join(', '),
    subject: 'Test: VDAB Vacaturemelder werkt',
    text: 'Dit is een testmail. Je SMTP-instellingen werken.',
    html: '<p>Dit is een testmail. Je SMTP-instellingen werken. 👍</p>',
  });
}
