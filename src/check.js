import { config, loadSearches } from './config.js';
import { fetchVacatures } from './vdab.js';
import { loadState, saveState, knownIds, isFirstRun, remember, searchKey } from './store.js';
import { sendNewVacatures } from './mailer.js';
import { log } from './log.js';
import { waitForNetwork } from './retry.js';

function tooOld(vacature, now) {
  if (config.maxAgeDays <= 0) return false;
  const t = Date.parse(vacature.gepubliceerd ?? '');
  if (!Number.isFinite(t)) return false;
  return t < now.getTime() - config.maxAgeDays * 86_400_000;
}

/**
 * Eén controleronde: alle zoekopdrachten ophalen, nieuwe vacatures bepalen,
 * één mail sturen en de database bijwerken.
 *
 * @param {object} options
 * @param {boolean} options.seedOnly  Alleen de huidige stand opslaan, niets mailen.
 */
export async function runCheck({ seedOnly = false } = {}) {
  const now = new Date();
  if (!(await waitForNetwork())) {
    log('Geen internetverbinding — deze ronde overgeslagen, niets verloren.');
    return { nieuw: 0, fouten: 1 };
  }
  const searches = loadSearches();
  const state = loadState();
  const groups = [];
  let fouten = 0;

  for (const search of searches) {
    const key = searchKey(search);
    try {
      const { vacatures, totaalAantal } = await fetchVacatures(search.url);
      const eersteKeer = isFirstRun(state, key);
      const bekend = knownIds(state, key);

      let nieuw = vacatures.filter((v) => !bekend[v.id]);
      const alleIds = vacatures.map((v) => v.id);

      if (seedOnly || (eersteKeer && !config.notifyOnFirstRun)) {
        log(
          `${search.naam}: ${vacatures.length} vacatures ingelezen (van ${totaalAantal} in totaal) —`,
          seedOnly ? 'database gevuld, geen mail.' : 'eerste controle, geen mail.',
        );
        remember(state, key, search, alleIds, now);
        continue;
      }

      const verouderd = nieuw.filter((v) => tooOld(v, now)).length;
      nieuw = nieuw.filter((v) => !tooOld(v, now));

      log(
        `${search.naam}: ${vacatures.length} opgehaald, ${nieuw.length} nieuw` +
          (verouderd > 0 ? `, ${verouderd} overgeslagen (ouder dan ${config.maxAgeDays} dagen)` : ''),
      );

      if (nieuw.length > 0) {
        nieuw.sort((a, b) => Date.parse(b.gepubliceerd ?? 0) - Date.parse(a.gepubliceerd ?? 0));
        groups.push({
          search,
          vacatures: nieuw.slice(0, config.maxItemsPerMail),
          extra: Math.max(0, nieuw.length - config.maxItemsPerMail),
        });
      }
      remember(state, key, search, alleIds, now);
    } catch (err) {
      fouten += 1;
      log(`FOUT bij "${search.naam}": ${err.message}`);
    }
  }

  if (groups.length > 0) {
    try {
      const { subject, totaal } = await sendNewVacatures(groups);
      log(`Mail verstuurd naar ${config.mailTo.join(', ')} — "${subject}" (${totaal} vacatures)`);
    } catch (err) {
      // Mail mislukt: ids niet opslaan, zodat de volgende ronde opnieuw probeert.
      log(`FOUT bij versturen mail: ${err.message}`);
      log('De nieuwe vacatures blijven bewaard voor de volgende ronde.');
      return { nieuw: 0, fouten: fouten + 1 };
    }
  }

  saveState(state);
  const nieuw = groups.reduce((sum, g) => sum + g.vacatures.length + g.extra, 0);
  if (nieuw === 0 && !seedOnly) log('Geen nieuwe vacatures.');
  return { nieuw, fouten };
}
