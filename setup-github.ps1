<#
    Zet de vacaturemelder in GitHub Actions, zodat hij elk kwartier draait ook
    wanneer je pc uit staat.

    Doet achtereenvolgens:
      1. GitHub-repository aanmaken en de code pushen
      2. Je mailgegevens uit .env als repository secrets zetten
      3. Een eerste run starten en het resultaat tonen

    Vereist: git, GitHub CLI (gh) en een ingevulde .env.

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

$gebruiker = (gh api user --jq .login).Trim()
$repo = "$gebruiker/$RepoNaam"

# ---- 1. Repository ----------------------------------------------------------
gh repo view $repo 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Repository $repo bestaat al." -ForegroundColor Yellow
    if (-not (git remote 2>$null | Select-String -Quiet "^origin$")) {
        git remote add origin "https://github.com/$repo.git"
    }
    git push -u origin main
} else {
    $zichtbaarheid = if ($Prive) { "--private" } else { "--public" }
    Write-Host "Repository $repo aanmaken ($(if ($Prive) { 'privé' } else { 'publiek' }))..."
    gh repo create $RepoNaam $zichtbaarheid --source=. --remote=origin --push `
        --description "Mailt me zodra er een nieuwe vacature op VDAB verschijnt"
    if ($LASTEXITCODE -ne 0) { throw "Aanmaken van de repository is mislukt." }
}

if ($Prive) {
    Write-Host ""
    Write-Host "Let op: bij een privé-repo verbruiken de runs je gratis Actions-minuten" -ForegroundColor Yellow
    Write-Host "(2000/maand). Elk kwartier is daarvoor te vaak; zet de cron in" -ForegroundColor Yellow
    Write-Host ".github\workflows\vacature-melder.yml op '0 */1 * * *' (elk uur) of maak de repo publiek." -ForegroundColor Yellow
}

# ---- 2. Secrets -------------------------------------------------------------
# Waarden komen uit .env en worden via stdin doorgegeven, nooit op de opdrachtregel.
$teZetten = @("SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_TO")
$env_regels = @{}
foreach ($regel in Get-Content ".env") {
    $t = $regel.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $naam = $t.Substring(0, $i).Trim()
    $waarde = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    $env_regels[$naam] = $waarde
}

Write-Host ""
foreach ($naam in $teZetten) {
    $waarde = $env_regels[$naam]
    if ([string]::IsNullOrWhiteSpace($waarde)) {
        Write-Host "  $naam  overgeslagen (niet ingevuld in .env)" -ForegroundColor Yellow
        continue
    }
    $waarde | gh secret set $naam --repo $repo
    if ($LASTEXITCODE -eq 0) { Write-Host "  $naam  gezet" -ForegroundColor Green }
    else { Write-Host "  $naam  MISLUKT" -ForegroundColor Red }
}

# ---- 3. Eerste run ----------------------------------------------------------
Write-Host ""
Write-Host "Eerste run starten..."
gh workflow run "vacature-melder.yml" --repo $repo
Start-Sleep -Seconds 20
gh run list --repo $repo --workflow "vacature-melder.yml" --limit 3

Write-Host ""
Write-Host "Klaar. De melder draait nu elk kwartier in de cloud." -ForegroundColor Green
Write-Host "  Runs bekijken : gh run list --repo $repo"
Write-Host "  Logs van laatste run : gh run view --repo $repo --log"
Write-Host "  In de browser : https://github.com/$repo/actions"
Write-Host ""
Write-Host "Zet nu de lokale Windows-taak uit, anders krijg je elke vacature twee keer:" -ForegroundColor Yellow
Write-Host "  Disable-ScheduledTask -TaskName 'VDAB Vacaturemelder'"
