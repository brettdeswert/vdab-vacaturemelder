<# Verwijdert de geplande taak van de vacaturemelder. #>
param([string]$TaakNaam = "VDAB Vacaturemelder")

if (Get-ScheduledTask -TaskName $TaakNaam -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaakNaam -Confirm:$false
    Write-Host "Taak '$TaakNaam' verwijderd." -ForegroundColor Green
} else {
    Write-Host "Taak '$TaakNaam' bestaat niet."
}
