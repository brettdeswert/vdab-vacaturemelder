#!/usr/bin/env node
import { config, loadSearches, missingMailConfig } from './config.js';
import { runCheck } from './check.js';
import { fetchVacatures } from './vdab.js';
import { sendTestMail, renderMail } from './mailer.js';
import { smtpCheck } from './smtpcheck.js';
import { log } from './log.js';

const USAGE = `VDAB Vacaturemelder

Gebruik: node src/index.js <commando>

  watch       Blijft draaien en controleert elke ${config.intervalMinutes} minuten (standaard)
  check       Voert één controle uit en stopt (voor Windows Taakplanner)
  seed        Leest de huidige vacatures in zonder te mailen (nulmeting)
  list        Toont de nieuwste vacatures van je zoekopdrachten in de terminal
  preview     Schrijft een voorbeeldmail naar data/preview.html (verstuurt niets)
  test-mail   Verstuurt een testmail om je SMTP-instellingen te controleren
  smtp-check  Controleert de mailinstellingen en meldt wat er mis is
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function watch() {
  const missing = missingMailConfig();
  if (missing.length > 0) {
    log(`Kan niet starten: vul ${missing.join(', ')} in .env in (zie .env.example).`);
    process.exitCode = 1;
    return;
  }

  log(`Watch-modus gestart — controle elke ${config.intervalMinutes} minuten. Stop met Ctrl+C.`);
  let stoppen = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stoppen = true;
      log('Afsluiten...');
      process.exit(0);
    });
  }

  while (!stoppen) {
    try {
      await runCheck();
    } catch (err) {
      log(`FOUT tijdens controle: ${err.message}`);
    }
    // Kleine spreiding zodat we de VDAB-server niet elke keer op de seconde raken.
    const jitter = Math.floor(Math.random() * 60_000);
    await sleep(config.intervalMinutes * 60_000 + jitter);
  }
}

async function list() {
  for (const search of loadSearches()) {
    const { vacatures, totaalAantal } = await fetchVacatures(search.url, { maxPages: 1 });
    console.log(`\n== ${search.naam} — ${totaalAantal} resultaten ==`);
    for (const v of vacatures.slice(0, 15)) {
      const datum = v.gepubliceerd ? new Date(v.gepubliceerd).toLocaleString('nl-BE') : '?';
      console.log(`${datum}  ${v.titel} — ${v.bedrijf} (${v.locatie})`);
      console.log(`                    ${v.url}`);
    }
  }
}

async function preview() {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { DATA_DIR } = await import('./config.js');
  const groups = [];
  for (const search of loadSearches()) {
    const { vacatures } = await fetchVacatures(search.url, { maxPages: 1 });
    groups.push({ search, vacatures: vacatures.slice(0, 5), extra: 2 });
  }
  const { subject, html } = renderMail(groups);
  mkdirSync(DATA_DIR, { recursive: true });
  const out = resolve(DATA_DIR, 'preview.html');
  writeFileSync(out, html, 'utf8');
  log(`Voorbeeldmail geschreven naar ${out} — onderwerp: "${subject}"`);
}

const commando = process.argv[2] ?? 'watch';

switch (commando) {
  case 'watch':
    await watch();
    break;
  case 'check': {
    const { fouten } = await runCheck();
    if (fouten > 0) process.exitCode = 1;
    break;
  }
  case 'seed':
    await runCheck({ seedOnly: true });
    break;
  case 'list':
    await list();
    break;
  case 'preview':
    await preview();
    break;
  case 'smtp-check':
    if (!(await smtpCheck())) process.exitCode = 1;
    break;
  case 'test-mail':
    try {
      await sendTestMail();
      log(`Testmail verstuurd naar ${config.mailTo.join(', ')}.`);
    } catch (err) {
      log(`Testmail mislukt: ${err.message}`);
      process.exitCode = 1;
    }
    break;
  case '--help':
  case '-h':
  case 'help':
    console.log(USAGE);
    break;
  default:
    console.log(`Onbekend commando: ${commando}\n`);
    console.log(USAGE);
    process.exitCode = 1;
}
