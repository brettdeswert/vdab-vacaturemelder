# VDAB Vacaturemelder

Stuurt je een e-mail zodra er een **nieuwe vacature** verschijnt op je VDAB
"Vind een job"-zoekopdracht. Draait lokaal op je eigen pc, zonder VDAB-account.

De ingestelde zoekopdracht is:
**ICT-jobs, 40 km rond 2018 Antwerpen, alle ervaringsniveaus** (`searches.json`).

---

## 1. Installeren

Node.js 20 of nieuwer is nodig (`node -v` om te controleren).

```powershell
cd C:\Users\Deswe\Desktop\Vacature-Applicatie
npm install
```

## 2. E-mail instellen

Kopieer `.env.example` naar `.env` en vul je gegevens in:

```powershell
Copy-Item .env.example .env
notepad .env
```

Voor Gmail (jouw adres):

1. Zet 2-stapsverificatie aan op je Google-account.
2. Maak een **app-wachtwoord** via <https://myaccount.google.com/apppasswords>
   (kies "Mail" → "Windows"). Je krijgt 16 letters.
3. Zet dat app-wachtwoord bij `SMTP_PASS`. Je gewone Gmail-wachtwoord werkt niet.

Test daarna of het verzenden lukt:

```powershell
npm run test-mail
```

## 3. Nulmeting

De huidige vacatures zijn al ingelezen, dus je krijgt alleen mails over
vacatures die **vanaf nu** verschijnen. Wil je opnieuw beginnen:

```powershell
Remove-Item data\seen.json
npm run seed
```

## 4. Laten draaien

### Optie A — als Windows-taak (aanbevolen)

Blijft werken na een herstart en vraagt geen open venster:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-taak.ps1
```

Standaard elke 15 minuten. Anders: `-IntervalMinuten 30`.
Meteen uitproberen: `Start-ScheduledTask -TaskName "VDAB Vacaturemelder"`.
Weghalen: `powershell -ExecutionPolicy Bypass -File .\verwijder-taak.ps1`.

#### Blijft dit werken als ik er niet bij ben?

| Situatie                            | Werkt het? | Waarom                                                       |
| ----------------------------------- | ---------- | ------------------------------------------------------------ |
| Je loopt weg, scherm vergrendeld    | ja         | de taak heeft geen zichtbaar venster nodig                   |
| Pc in slaapstand                    | ja         | `WakeToRun` wekt de pc; wektimers staan aan op netstroom     |
| Laptop op batterij in slaapstand    | nee        | bewust uit om de accu te sparen — aanzetten met `-WekOokOpBatterij` |
| Pc herstart of was even uit         | ja         | `StartWhenAvailable` haalt de gemiste ronde in               |
| Internet nog niet terug na ontwaken | ja         | de app wacht tot 2 minuten op verbinding en probeert opnieuw |
| Je bent afgemeld van Windows        | alleen met `-OokAlsIkAfgemeldBen` | vereist beheerdersrechten          |
| Pc helemaal uit, bv. op reis        | nee        | niets op je pc kan dan draaien — zie "Altijd aan" hieronder  |

Wil je dat het ook doorloopt wanneer je afgemeld bent, start PowerShell dan
**als administrator** en voer uit:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-taak.ps1 -OokAlsIkAfgemeldBen
```

Zonder beheerdersrechten weigert Windows dat (`Toegang geweigerd`); de taak
draait dan zolang je aangemeld bent, een vergrendeld scherm meegerekend.

#### Altijd aan, ook met de pc uit

Gaat je pc dagen uit, dan mist de melder die periode. Bij de eerste controle
daarna krijg je alles wat je gemist hebt in één mail (tot `MAX_AGE_DAYS` oud),
dus je loopt geen vacature kwijt zolang ze nog online staat. Wil je ook mail
terwijl je pc uit staat, dan moet de controle ergens anders draaien — vraag me
om een opzet met GitHub Actions of een kleine server.

### Optie B — in een venster

```powershell
npm start
```

Controleert meteen en daarna elke 15 minuten. Stoppen met `Ctrl+C`.

---

## Commando's

| Commando            | Wat het doet                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm start`         | Blijft draaien en controleert op interval                           |
| `npm run check`     | Eén controle, dan stoppen (wat de Windows-taak gebruikt)            |
| `npm run seed`      | Huidige stand inlezen zonder te mailen                              |
| `npm run list`      | Nieuwste vacatures in de terminal tonen                             |
| `npm run test-mail` | Testmail versturen                                                  |
| `node src/index.js preview` | Voorbeeldmail naar `data\preview.html` schrijven            |

## Zoekopdrachten aanpassen of toevoegen

Stel je zoekopdracht samen op <https://www.vdab.be/vindeenjob/vacatures>,
kopieer de URL uit de adresbalk en zet die in `searches.json`:

```json
[
  { "naam": "ICT - 40 km rond 2018 Antwerpen", "url": "https://www.vdab.be/vindeenjob/vacatures?..." },
  { "naam": "Helpdesk Gent", "url": "https://www.vdab.be/vindeenjob/vacatures?trefwoord=helpdesk&locatie=9000%20Gent&afstand=20" }
]
```

Alle filters uit de VDAB-URL worden overgenomen: trefwoord, locatie en afstand,
jobdomein, beroep, ervaring, diploma, arbeidsduur, arbeidsregime, contracttype,
rijbewijs, attesten en bedrijf. Sorteren gebeurt altijd op datum, zodat de
nieuwste vacatures zeker gezien worden. Meerdere zoekopdrachten komen samen in
één mail.

## Instellingen in `.env`

| Variabele                | Standaard | Betekenis                                                      |
| ------------------------ | --------- | -------------------------------------------------------------- |
| `CHECK_INTERVAL_MINUTES` | `15`      | Interval in watch-modus                                         |
| `MAX_PAGES`              | `2`       | Pagina's van 50 resultaten per zoekopdracht (100 nieuwste)      |
| `MAX_AGE_DAYS`           | `14`      | Vacatures ouder dan dit nooit mailen (`0` = geen limiet)        |
| `MAX_ITEMS_PER_MAIL`     | `25`      | Maximum aantal vacatures dat in detail in de mail komt          |
| `NOTIFY_ON_FIRST_RUN`    | `false`   | Ook mailen bij de allereerste controle                          |
| `PRUNE_AFTER_DAYS`       | `90`      | Hoe lang gemelde vacature-ids bewaard blijven                   |
| `VDAB_API_KEY`           | leeg      | Vaste API-sleutel; leeg = automatisch ophalen van vdab.be       |

## Hoe het werkt

De vacaturepagina van VDAB wordt door JavaScript opgebouwd, dus HTML uitlezen
werkt niet. In plaats daarvan gebruikt deze app dezelfde interne API als de
website zelf:

```
POST https://www.vdab.be/rest/vindeenjob/v4/vacatureLight/zoek
```

Die vraagt één vaste header (`vej-key-monitor`) die in de publieke frontend van
vdab.be staat. De app haalt die sleutel automatisch op en, als VDAB hem ooit
vervangt, opnieuw op bij een 403. Dat is ook het enige onderdeel dat kan breken
bij een grote herbouw van de VDAB-site — dan tonen de logs `VDAB-API gaf status ...`.

Per zoekopdracht worden de ids van gevonden vacatures bijgehouden in
`data\seen.json`. Alles wat daar nog niet in staat, is nieuw en gaat de mail in.
Mislukt het versturen, dan worden de ids niet opgeslagen en probeert de volgende
ronde het opnieuw — je mist dus niets.

## Bestanden

```
searches.json      de zoekopdrachten die gevolgd worden
.env               je mailinstellingen (staat niet in git)
src/config.js      configuratie en .env inlezen
src/vdab.js        VDAB-URL omzetten naar API-vraag + resultaten ophalen
src/store.js       welke vacatures al gemeld zijn
src/mailer.js      mail opbouwen en versturen
src/retry.js       opnieuw proberen bij netwerkproblemen
src/check.js       één controleronde
src/index.js       commando's
data\seen.json     database van gemelde vacatures
data\*.log         logboek
```

## Problemen oplossen

| Melding                                   | Oplossing                                                            |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `Mailconfiguratie onvolledig`             | `.env` ontbreekt of is niet volledig ingevuld                        |
| `Invalid login` / `535`                   | Gebruik een Gmail-app-wachtwoord, niet je gewone wachtwoord          |
| `VDAB-API gaf status 403`                 | Sleutel veranderd; opnieuw proberen, of `VDAB_API_KEY` leegmaken     |
| Geen mails, wel "0 nieuw" in de log       | Er zijn echt geen nieuwe vacatures; controleer met `npm run list`    |
| Taak draait niet                          | `Get-ScheduledTaskInfo -TaskName "VDAB Vacaturemelder"`              |
| `Toegang geweigerd` bij installeren       | `-OokAlsIkAfgemeldBen` vraagt een PowerShell als administrator       |
| `Geen internetverbinding` in de log       | Ronde overgeslagen, niets verloren; de volgende ronde haalt in       |
