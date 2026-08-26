param(
  [string]$ApiUrl = 'https://ratis-transmission-webapp-yjd1870.onrender.com',
  [string]$TaskName = 'CATV Straight Map Renderer',
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'Renderer autostart can only be installed on Windows.'
}
if (-not $ApiUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The production Renderer API URL must use HTTPS.'
}

$scriptPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start-renderer.ps1')).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedScriptPath = '"' + $scriptPath + '"'
$quotedApiUrl = '"' + $ApiUrl.TrimEnd('/') + '"'
$arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedScriptPath -ApiUrl $quotedApiUrl"

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument $arguments `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts the CATV Excel/PDF renderer after user logon.'

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
if (-not $NoStart) {
  Start-ScheduledTask -TaskName $TaskName
}

$registered = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $registered.TaskName
  State = [string]$registered.State
  User = $identity
  Trigger = 'At user logon'
  Restart = 'Every 1 minute, up to 10 times after failure'
  ApiUrl = $ApiUrl.TrimEnd('/')
}
