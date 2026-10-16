import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = resolve(ROOT, 'data');

/** Minimale .env-parser, zodat het project geen extra dependency nodig heeft. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(ROOT, '.env'));

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key, fallback) => {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (['true', '1', 'ja', 'yes'].includes(v)) return true;
  if (['false', '0', 'nee', 'no'].includes(v)) return false;
  return fallback;
};

/* Vangnet: een onzichtbare \r of spatie rond een waarde laat de SMTP-login
 * mislukken met een nietszeggende foutmelding. Dat gebeurt makkelijk bij het
 * overzetten naar GitHub secrets of bij een handmatig gevulde .env. */
const str = (key, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 465),
    secure: bool('SMTP_SECURE', num('SMTP_PORT', 465) === 465),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
  },
  mailFrom: str('MAIL_FROM') || str('SMTP_USER'),
  mailTo: str('MAIL_TO')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  intervalMinutes: Math.max(1, num('CHECK_INTERVAL_MINUTES', 15)),
  maxPages: Math.max(1, num('MAX_PAGES', 2)),
  notifyOnFirstRun: bool('NOTIFY_ON_FIRST_RUN', false),
  maxItemsPerMail: Math.max(1, num('MAX_ITEMS_PER_MAIL', 25)),
  maxAgeDays: num('MAX_AGE_DAYS', 14),
  pruneAfterDays: Math.max(1, num('PRUNE_AFTER_DAYS', 90)),
  apiKey: (process.env.VDAB_API_KEY ?? '').trim(),
};

/** Leest searches.json en valideert de zoekopdrachten. */
export function loadSearches() {
  const path = resolve(ROOT, 'searches.json');
  if (!existsSync(path)) {
    throw new Error(`searches.json niet gevonden in ${ROOT}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`searches.json is geen geldige JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('searches.json moet een niet-lege lijst met zoekopdrachten zijn.');
  }
  return parsed.map((entry, i) => {
    if (!entry?.url) throw new Error(`Zoekopdracht ${i + 1} in searches.json heeft geen "url".`);
    return {
      naam: entry.naam?.trim() || `Zoekopdracht ${i + 1}`,
      url: entry.url.trim(),
    };
  });
}

/** Controleert of de mailconfiguratie compleet is. Geeft een lijst ontbrekende velden terug. */
export function missingMailConfig() {
  const missing = [];
  if (!config.smtp.host) missing.push('SMTP_HOST');
  if (!config.smtp.user) missing.push('SMTP_USER');
  if (!config.smtp.pass) missing.push('SMTP_PASS');
  if (!config.mailFrom) missing.push('MAIL_FROM');
  if (config.mailTo.length === 0) missing.push('MAIL_TO');
  return missing;
}
