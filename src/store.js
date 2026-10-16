import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_DIR, config } from './config.js';

const STATE_FILE = resolve(DATA_DIR, 'seen.json');

/** Stabiele sleutel per zoekopdracht, zodat hernoemen de geschiedenis niet wist. */
export function searchKey(search) {
  return createHash('sha1').update(search.url).digest('hex').slice(0, 12);
}

function emptyState() {
  return { version: 1, searches: {} };
}

export function loadState() {
  if (!existsSync(STATE_FILE)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!parsed?.searches) return emptyState();
    return parsed;
  } catch {
    // Corrupte database: opnieuw beginnen is beter dan crashen.
    return emptyState();
  }
}

export function saveState(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), 'utf8');
  renameSync(tmp, STATE_FILE);
}

/** Geeft de vacature-ids die we voor deze zoekopdracht al kennen. */
export function knownIds(state, key) {
  return state.searches[key]?.ids ?? {};
}

export function isFirstRun(state, key) {
  return state.searches[key] === undefined;
}

/** Markeert ids als gezien en ruimt oude ids op. */
export function remember(state, key, search, ids, now = new Date()) {
  const entry = state.searches[key] ?? { naam: search.naam, url: search.url, ids: {} };
  entry.naam = search.naam;
  entry.url = search.url;
  entry.laatsteControle = now.toISOString();
  for (const id of ids) {
    if (!entry.ids[id]) entry.ids[id] = now.toISOString();
  }

  const cutoff = now.getTime() - config.pruneAfterDays * 86_400_000;
  for (const [id, seenAt] of Object.entries(entry.ids)) {
    const t = Date.parse(seenAt);
    if (Number.isFinite(t) && t < cutoff) delete entry.ids[id];
  }

  state.searches[key] = entry;
  return state;
}
