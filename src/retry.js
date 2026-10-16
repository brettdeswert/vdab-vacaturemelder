import { log } from './log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Voert een actie uit en probeert opnieuw bij tijdelijke fouten.
 * Belangrijk wanneer de pc net uit slaapstand komt: dan is het netwerk
 * meestal nog een halve minuut niet bruikbaar.
 */
export async function withRetry(naam, actie, { pogingen = 3, wachttijden = [5000, 20000] } = {}) {
  let laatsteFout;
  for (let poging = 1; poging <= pogingen; poging += 1) {
    try {
      return await actie();
    } catch (err) {
      laatsteFout = err;
      if (poging === pogingen) break;
      const wacht = wachttijden[Math.min(poging - 1, wachttijden.length - 1)];
      log(`${naam} mislukt (poging ${poging}/${pogingen}): ${err.message} — opnieuw over ${wacht / 1000}s`);
      await sleep(wacht);
    }
  }
  throw laatsteFout;
}

/**
 * Wacht tot vdab.be bereikbaar is, met een harde bovengrens.
 * Geeft false als er binnen die tijd geen verbinding is.
 */
export async function waitForNetwork({ timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let gemeld = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('https://www.vdab.be/vindeenjob', {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok || r.status < 500) return true;
    } catch {
      /* nog geen verbinding */
    }
    if (!gemeld) {
      log('Nog geen internetverbinding — wachten (max 2 minuten).');
      gemeld = true;
    }
    await sleep(Math.min(10_000, Math.max(0, deadline - Date.now())));
  }
  return false;
}
