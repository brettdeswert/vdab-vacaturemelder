import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';

const LOG_FILE = resolve(DATA_DIR, 'vacature-melder.log');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function rotateIfNeeded() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    /* loggen mag nooit de app doen crashen */
  }
}

export function log(...parts) {
  const stamp = new Date().toLocaleString('nl-BE');
  const line = `[${stamp}] ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    rotateIfNeeded();
    appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    /* zie boven */
  }
}
