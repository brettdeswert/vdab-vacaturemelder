import nodemailer from 'nodemailer';
import { config } from './config.js';

/**
 * Controleert de SMTP-instellingen en meldt wat er mis is, zonder ooit een
 * wachtwoord te tonen. Alleen vormkenmerken (lengte, aantal spaties), zodat
 * dit veilig in een publiek logboek van GitHub Actions kan staan.
 */
export async function smtpCheck() {
  const pass = config.smtp.pass ?? '';
  const regels = [
    `SMTP_HOST   : ${config.smtp.host || '(leeg!)'}`,
    `SMTP_PORT   : ${config.smtp.port}   secure=${config.smtp.secure}`,
    `SMTP_USER   : lengte ${config.smtp.user.length}, bevat @ ${config.smtp.user.includes('@') ? 'ja' : 'NEE'}`,
    `SMTP_PASS   : lengte ${pass.length}, spaties ${(pass.match(/ /g) ?? []).length}, zonder spaties ${pass.replace(/ /g, '').length}`,
    `              begint/eindigt op witruimte: ${pass !== pass.trim() ? 'JA (probleem!)' : 'nee'}`,
    `MAIL_FROM   : ${config.mailFrom}`,
    `MAIL_TO     : ${config.mailTo.join(', ')}`,
  ];

  try {
    const ip = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
    regels.push(`Publiek IP  : ${ip}`);
  } catch {
    regels.push('Publiek IP  : onbekend');
  }

  console.log(regels.join('\n'));
  console.log('');

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  try {
    await transporter.verify();
    console.log('Aanmelden bij de mailserver: GELUKT');
    return true;
  } catch (err) {
    console.log(`Aanmelden bij de mailserver: MISLUKT — ${err.message}`);
    // Gmail weigert app-wachtwoorden soms vanaf datacenter-adressen, ook als
    // ze lokaal wel werken. Dan is de login niet fout maar de afzender-IP.
    if (/535|BadCredentials|Invalid login/i.test(err.message)) {
      console.log('');
      console.log('Dit is een weigering van de login zelf. Mogelijke oorzaken:');
      console.log('  1. Het app-wachtwoord is ingetrokken of verkeerd overgenomen.');
      console.log('  2. De mailprovider vertrouwt dit IP-adres niet (komt voor bij');
      console.log('     Gmail vanaf cloudservers zoals GitHub Actions).');
    }
    return false;
  }
}
