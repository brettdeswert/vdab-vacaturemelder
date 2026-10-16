import { config } from './config.js';
import { withRetry } from './retry.js';

const SITE = 'https://www.vdab.be';
const SEARCH_ENDPOINT = `${SITE}/rest/vindeenjob/v4/vacatureLight/zoek`;
const VACATURE_PAGE = `${SITE}/vindeenjob/vacatures`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 50;

/* De vindeenjob-API eist een vaste sleutel die in de publieke frontend-bundel
 * staat (header "vej-key-monitor"). Hij verandert maar zelden, maar we kunnen
 * hem automatisch opnieuw ophalen als VDAB hem vervangt. */
const FALLBACK_API_KEY = 'b277002f-e1fa-4fc5-868a-fdab633c3851';
let cachedApiKey = config.apiKey || null;

/** Parameters die in de zoek-URL meerdere keren kunnen voorkomen. */
const ARRAY_PARAMS = new Set([
  'diplomaNiveau',
  'arbeidsduur',
  'arbeidsregime',
  'arbeidscircuit',
  'jobdomein',
  'internationaal',
  'beroep',
  'ervaring',
  'rijbewijs',
  'attest',
]);

/** URL-parameter -> veld in de zoekcriteria van de API. */
const SIMPLE_MAPPING = {
  trefwoord: 'trefwoord',
  diplomaNiveau: 'diplomaCodes',
  sinds: 'onlineSindsCode',
  arbeidsduur: 'arbeidsduurCodes',
  arbeidsregime: 'arbeidsregimeCodes',
  arbeidscircuit: 'contractTypeCodes',
  jobdomein: 'jobdomeinCodes',
  internationaal: 'internationaalCodes',
  beroep: 'beroepCodes',
  ervaring: 'ervaringCodes',
  rijbewijs: 'rijbewijsCodes',
  attest: 'attestCodes',
  diploma: 'diplomaSpecifiek',
  deeldatabank: 'deeldatabank',
};

/**
 * Zet een "Vind een job"-zoek-URL om in de zoekcriteria die de API verwacht.
 * We sorteren altijd op datum, zodat de nieuwste vacatures op pagina 1 staan.
 */
export function criteriaFromSearchUrl(searchUrl) {
  const params = new URL(searchUrl).searchParams;
  const criteria = {};

  for (const [param, field] of Object.entries(SIMPLE_MAPPING)) {
    const values = params.getAll(param).filter((v) => v !== '');
    if (values.length === 0) continue;
    criteria[field] = ARRAY_PARAMS.has(param) ? values : values[0];
  }

  const locatie = params.get('locatie');
  const locatieCode = params.get('locatieCode');
  const afstand = params.get('afstand');
  const lat = params.get('lat');
  const lon = params.get('lon');
  if (locatie || locatieCode || afstand || (lat && lon)) {
    const loc = {};
    if (locatie) loc.locatiePostcodeGemeente = locatie;
    if (locatieCode) loc.locatieCode = locatieCode;
    if (afstand && Number.isFinite(Number.parseInt(afstand, 10))) {
      loc.straalInKilometer = Number.parseInt(afstand, 10);
    }
    if (lat && lon) {
      loc.geoLocatie = { latitude: Number.parseFloat(lat), longitude: Number.parseFloat(lon) };
    }
    criteria.locatieCriteria = loc;
  }

  const bedrijfId = params.get('bedrijfId');
  if (bedrijfId && Number.isFinite(Number.parseInt(bedrijfId, 10))) {
    criteria.bedrijfId = Number.parseInt(bedrijfId, 10);
  }

  criteria.sorteerVeld = 'DATUM';
  return criteria;
}

/** Haalt de API-sleutel uit de publieke frontend-bundel van vdab.be. */
async function discoverApiKey() {
  const page = await fetch(VACATURE_PAGE, { headers: { 'User-Agent': USER_AGENT } });
  if (!page.ok) throw new Error(`vdab.be gaf status ${page.status} voor de vacaturepagina`);
  const html = await page.text();
  const bundle = html.match(/https:\/\/www\.vdab\.be\/webapps\/vindeenjob\/main-[A-Za-z0-9]+\.js/);
  if (!bundle) throw new Error('kon de frontend-bundel niet terugvinden in de pagina');
  const js = await fetch(bundle[0], { headers: { 'User-Agent': USER_AGENT } }).then((r) => r.text());
  const key = js.match(/vej-key-monitor['"`],\s*['"`]([0-9a-f-]{36})['"`]/i);
  if (!key) throw new Error('kon de API-sleutel niet terugvinden in de frontend-bundel');
  return key[1];
}

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  try {
    cachedApiKey = await discoverApiKey();
  } catch {
    cachedApiKey = FALLBACK_API_KEY;
  }
  return cachedApiKey;
}

async function postSearch(criteria, pagina, apiKey) {
  // Netwerkfouten en serverstoringen opnieuw proberen; een afwijzing van de
  // sleutel (401/403) geven we meteen terug, die wordt hierboven opgelost.
  return withRetry(`Zoekopdracht ophalen (pagina ${pagina + 1})`, async () => {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Referer: VACATURE_PAGE,
        Origin: SITE,
        'vej-key-monitor': apiKey,
      },
      body: JSON.stringify({ criteria, pagina, paginaGrootte: PAGE_SIZE, zoekmodus: 'C2' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 500) {
      throw new Error(`VDAB-API gaf status ${response.status}`);
    }
    return response;
  });
}

/** Normaliseert één API-resultaat naar het formaat dat de rest van de app gebruikt. */
function normalise(raw) {
  const id = String(raw?.id?.id ?? '');
  return {
    id,
    titel: raw?.vacaturefunctie?.naam ?? 'Vacature',
    bedrijf: raw?.vacatureBedrijfsnaam ?? 'Onbekende werkgever',
    locatie: raw?.tewerkstellingsLocatieRegioOfAdres ?? '',
    contract: raw?.vacaturefunctie?.arbeidscircuitLijn ?? '',
    ervaring: raw?.ervaring ?? '',
    tijdsregeling: Array.isArray(raw?.tijdsregeling) ? raw.tijdsregeling.join(', ') : '',
    knelpuntberoep: Boolean(raw?.knelpuntberoep),
    aantalJobs: raw?.aantalJobs ?? 1,
    gepubliceerd: raw?.eerstePublicatieDatum ?? null,
    url: `${VACATURE_PAGE}/${id}`,
  };
}

/**
 * Haalt de nieuwste vacatures voor een zoek-URL op (nieuwste eerst).
 * Retourneert { vacatures, totaalAantal }.
 */
export async function fetchVacatures(searchUrl, { maxPages = config.maxPages } = {}) {
  const criteria = criteriaFromSearchUrl(searchUrl);
  let apiKey = await getApiKey();
  const vacatures = [];
  const gezien = new Set();
  let totaalAantal = 0;

  for (let pagina = 0; pagina < maxPages; pagina += 1) {
    let response = await postSearch(criteria, pagina, apiKey);

    // Sleutel afgekeurd? Eén keer opnieuw ophalen en opnieuw proberen.
    if (response.status === 401 || response.status === 403) {
      cachedApiKey = null;
      const fresh = await discoverApiKey().catch(() => null);
      if (fresh && fresh !== apiKey) {
        cachedApiKey = fresh;
        apiKey = fresh;
        response = await postSearch(criteria, pagina, apiKey);
      }
    }
    if (!response.ok) {
      throw new Error(`VDAB-API gaf status ${response.status} (pagina ${pagina + 1})`);
    }

    const data = await response.json();
    totaalAantal = data?.totaalAantal ?? totaalAantal;
    const batch = Array.isArray(data?.resultaten) ? data.resultaten : [];
    for (const raw of batch) {
      const vacature = normalise(raw);
      if (!vacature.id || gezien.has(vacature.id)) continue;
      gezien.add(vacature.id);
      vacatures.push(vacature);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  return { vacatures, totaalAantal };
}
