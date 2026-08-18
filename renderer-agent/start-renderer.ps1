param([switch]$Once)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $env:CATV_RENDERER_API_URL) {
  $env:CATV_RENDERER_API_URL = Read-Host 'Render API URL (예: https://example.onrender.com)'
}
if (-not $env:CATV_RENDERER_DEVICE_TOKEN) {
  $credential = $null
  if (Get-Command Get-StoredCredential -ErrorAction SilentlyContinue) {
    $credential = Get-StoredCredential -Target 'CATV Straight Map Renderer'
  }
  if ($credential) {
    $env:CATV_RENDERER_DEVICE_TOKEN = $credential.GetNetworkCredential().Password
  } else {
    Write-Host 'Windows Credential Manager 대상 "CATV Straight Map Renderer"가 없어 이번 실행에만 token을 입력합니다.' -ForegroundColor Yellow
    $secure = Read-Host 'Renderer device token' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:CATV_RENDERER_DEVICE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
}
Set-Location -LiteralPath $root
$arguments = @('run', 'renderer:agent', '--')
if ($Once) { $arguments += '--once' }
& npm.cmd @arguments
exit $LASTEXITCODE
