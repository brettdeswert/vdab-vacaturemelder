<#
    Zet de vacaturemelder in GitHub Actions, zodat hij elk kwartier draait ook
    wanneer je pc uit staat.

    Doet achtereenvolgens:
      1. Controleren of je GitHub-token workflows mag pushen
      2. Repository aanmaken en de code pushen
      3. Je mailgegevens uit .env als repository secrets zetten
      4. Een eerste run starten en het resultaat tonen

    Vereist: git, GitHub CLI (gh) en een ingevulde .env.
    Veilig om opnieuw uit te voeren: bestaande repo en secrets worden bijgewerkt.

    Gebruik:
        powershell -ExecutionPolicy Bypass -File .\setup-github.ps1
        powershell -ExecutionPolicy Bypass -File .\setup-github.ps1 -RepoNaam mijn-melder -Prive
#>
param(
    [string]$RepoNaam = "vdab-vacaturemelder",
    [switch]$Prive
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

foreach ($tool in @("git", "gh")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool niet gevonden in PATH."
    }
}
if (-not (Test-Path ".env")) { throw ".env ontbreekt; vul eerst je mailgegevens in." }

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Niet ingelogd bij GitHub. Voer eerst 'gh auth login' uit." }

# ---- 1. Scope-controle ------------------------------------------------------
# GitHub weigert een push die een bestand onder .github/workflows/ aanraakt
# wanneer het token de 'workflow'-scope mist. Dat lossen we hier meteen op.
function Get-GhScopes {
    $status = (gh auth status 2>&1) -join "`n"
    $m = [regex]::Match($status, "Token scopes:\s*(.+)")
    if ($m.Success) { return $m.Groups[1].Value }
    return ""
}

if ((Get-GhScopes) -notmatch '\bworkflow\b') {
    Write-Host "Je GitHub-token mag nog geen workflows pushen." -ForegroundColor Yellow
    Write-Host "Er opent nu een browservenster om dat eenmalig toe te staan ('workflow'-scope)."
    Write-Host ""
    gh auth refresh -h github.com -s workflow
    if ($LASTEXITCODE -ne 0 -or (Get-GhScopes) -notmatch '\bworkflow\b') {
        throw "De 'workflow'-scope is niet toegekend. Voer handmatig uit: gh auth refresh -h github.com -s workflow"
    }
    Write-Host "Scope toegekend." -ForegroundColor Green
    Write-Host ""
}

$gebruiker = (gh api user --jq .login).Trim()
$repo = "$gebruiker/$RepoNaam"

# ---- 2. Repository en push --------------------------------------------------
gh repo view $repo 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Repository $repo bestaat al."
    if (-not (git remote 2>$null | Select-String -Quiet "^origin$")) {
        git remote add origin "https://github.com/$repo.git"
    }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) {
        throw "De push is mislukt. Zie de melding hierboven; bij 'without ``workflow`` scope' voer je uit: gh auth refresh -h github.com -s workflow"
    }
} else {
    $zichtbaarheid = if ($Prive) { "--private" } else { "--public" }
    Write-Host "Repository $repo aanmaken ($(if ($Prive) { 'privé' } else { 'publiek' }))..."
    gh repo create $RepoNaam $zichtbaarheid --source=. --remote=origin --push `
        --description "Mailt me zodra er een nieuwe vacature op VDAB verschijnt"
    if ($LASTEXITCODE -ne 0) { throw "Aanmaken van de repository is mislukt." }
}
Write-Host "Code gepusht." -ForegroundColor Green

if ($Prive) {
    Write-Host ""
    Write-Host "Let op: bij een privé-repo verbruiken de runs je gratis Actions-minuten" -ForegroundColor Yellow
    Write-Host "(2000/maand). Elk kwartier is daarvoor te vaak; zet de cron in" -ForegroundColor Yellow
    Write-Host ".github\workflows\vacature-melder.yml op '0 */1 * * *' (elk uur) of maak de repo publiek." -ForegroundColor Yellow
}

# ---- 3. Secrets -------------------------------------------------------------
# Waarden komen uit .env en gaan via stdin, nooit via de opdrachtregel.
$teZetten = @("SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_TO")
$envRegels = @{}
foreach ($regel in Get-Content ".env") {
    $t = $regel.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $envRegels[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
}

Write-Host ""
$secretsOk = $true
foreach ($naam in $teZetten) {
    $waarde = $envRegels[$naam]
    if ([string]::IsNullOrWhiteSpace($waarde)) {
        Write-Host "  $naam  overgeslagen (niet ingevuld in .env)" -ForegroundColor Yellow
        continue
    }
    $waarde | gh secret set $naam --repo $repo 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $naam  gezet" -ForegroundColor Green }
    else { Write-Host "  $naam  MISLUKT" -ForegroundColor Red; $secretsOk = $false }
}
if (-not $secretsOk) { throw "Niet alle secrets konden worden gezet." }

# ---- 4. Eerste run ----------------------------------------------------------
Write-Host ""
Write-Host "Eerste run starten..."
# Na een push heeft GitHub even nodig voor de workflow bekend is.
$gestart = $false
foreach ($poging in 1..8) {
    gh workflow run "vacature-melder.yml" --repo $repo 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $gestart = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $gestart) {
    Write-Host "Kon de run niet starten. Start hem handmatig via" -ForegroundColor Yellow
    Write-Host "  https://github.com/$repo/actions" -ForegroundColor Yellow
} else {
    Start-Sleep -Seconds 20
    gh run list --repo $repo --workflow "vacature-melder.yml" --limit 3
}

Write-Host ""
Write-Host "Klaar. De melder draait nu elk kwartier in de cloud." -ForegroundColor Green
Write-Host "  Runs bekijken        : gh run list --repo $repo"
Write-Host "  Logs van laatste run : gh run view --repo $repo --log"
Write-Host "  In de browser        : https://github.com/$repo/actions"
Write-Host ""
Write-Host "Zet nu de lokale Windows-taak uit, anders krijg je elke vacature twee keer:" -ForegroundColor Yellow
Write-Host "  Disable-ScheduledTask -TaskName 'VDAB Vacaturemelder'"
