<#
    Registreert de vacaturemelder als geplande taak in Windows, zo ingesteld dat
    hij ook doorloopt wanneer je niet aan de pc zit.

    Gebruik:
        powershell -ExecutionPolicy Bypass -File .\install-taak.ps1
        powershell -ExecutionPolicy Bypass -File .\install-taak.ps1 -IntervalMinuten 30

    Met -OokAlsIkAfgemeldBen draait de taak ook wanneer je afgemeld bent.
    Dat vereist Windows-beheerdersrechten (start PowerShell dan als administrator).
#>
param(
    [int]$IntervalMinuten = 15,
    [string]$TaakNaam = "VDAB Vacaturemelder",
    [switch]$OokAlsIkAfgemeldBen,
    [switch]$WekOokOpBatterij
)

$ErrorActionPreference = "Stop"

$projectMap = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js niet gevonden in PATH. Installeer Node.js via https://nodejs.org" }
if (-not (Test-Path (Join-Path $projectMap "node_modules"))) {
    throw "node_modules ontbreekt. Voer eerst 'npm install' uit in $projectMap"
}
if (-not (Test-Path (Join-Path $projectMap ".env"))) {
    throw ".env ontbreekt. Kopieer .env.example naar .env en vul je mailgegevens in."
}

$actie = New-ScheduledTaskAction -Execute $node -Argument "src/index.js check" -WorkingDirectory $projectMap

# Startpunt in het verleden + onbeperkte herhaling. Geen -RepetitionDuration
# opgeven: dat betekent "oneindig". Een expliciete maximale duur wordt door de
# Taakplanner geweigerd (HRESULT 0x80041318).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinuten)

#  StartWhenAvailable  haalt gemiste rondes in zodra de pc weer aan is
#  WakeToRun           wekt de pc uit slaapstand voor een controle
#  RestartCount        probeert opnieuw als de ronde onverwacht afbreekt
$instellingen = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$registratie = @{
    TaskName    = $TaakNaam
    Action      = $actie
    Trigger     = $trigger
    Settings    = $instellingen
    Description = "Controleert VDAB op nieuwe vacatures en mailt ze."
    Force       = $true
}

if ($OokAlsIkAfgemeldBen) {
    $isAdmin = (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent())
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "-OokAlsIkAfgemeldBen vereist beheerdersrechten. Start PowerShell als administrator en voer dit script opnieuw uit."
    }
    $registratie.Principal = New-ScheduledTaskPrincipal `
        -UserId ([Security.Principal.WindowsIdentity]::GetCurrent()).Name `
        -LogonType S4U -RunLevel Limited
}

Register-ScheduledTask @registratie | Out-Null

# Zonder toegestane wektimers negeert Windows de WakeToRun-instelling.
try {
    powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
    if ($WekOokOpBatterij) {
        powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
    }
    powercfg /setactive SCHEME_CURRENT | Out-Null
    $wektimers = "aan op netstroom" + $(if ($WekOokOpBatterij) { " en op batterij" } else { " (op batterij uit, spaart accu)" })
} catch {
    $wektimers = "kon niet worden aangezet: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Taak '$TaakNaam' geregistreerd." -ForegroundColor Green
Write-Host "  Interval        : elke $IntervalMinuten minuten"
Write-Host "  Na herstart     : ja, gemiste rondes worden ingehaald"
Write-Host "  Uit slaapstand  : ja, wektimers $wektimers"
Write-Host "  Afgemeld        : $(if ($OokAlsIkAfgemeldBen) { 'ja' } else { 'nee - draait zolang je aangemeld bent (vergrendeld scherm is prima)' })"
Write-Host ""
Write-Host "Nu meteen testen:  Start-ScheduledTask -TaskName '$TaakNaam'"
Write-Host "Status bekijken:   Get-ScheduledTaskInfo -TaskName '$TaakNaam'"
Write-Host "Logboek:           $(Join-Path $projectMap 'data\vacature-melder.log')"
