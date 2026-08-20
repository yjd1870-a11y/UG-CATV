param([switch]$Once)

$ErrorActionPreference = 'Stop'

function Get-WindowsGenericCredentialPassword([string]$TargetName) {
  if (-not ('Catv.WindowsCredential' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Catv {
  public static class WindowsCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
      public uint Flags;
      public uint Type;
      public string TargetName;
      public string Comment;
      public long LastWritten;
      public uint CredentialBlobSize;
      public IntPtr CredentialBlob;
      public uint Persist;
      public uint AttributeCount;
      public IntPtr Attributes;
      public string TargetAlias;
      public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    public static string ReadPassword(string target) {
      IntPtr pointer;
      if (!CredRead(target, 1, 0, out pointer)) return null;
      try {
        var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
        return credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0
          ? null
          : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
      } finally {
        CredFree(pointer);
      }
    }
  }
}
'@
  }
  return [Catv.WindowsCredential]::ReadPassword($TargetName)
}

$root = Split-Path -Parent $PSScriptRoot
$bundledPoppler = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin'
if (-not (Get-Command pdfinfo.exe -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $bundledPoppler 'pdfinfo.exe'))) {
  $env:PATH = "$bundledPoppler;$env:PATH"
}
if (-not $env:CATV_RENDERER_API_URL) {
  $env:CATV_RENDERER_API_URL = Read-Host 'Render API URL (예: https://example.onrender.com)'
}
if (-not $env:CATV_RENDERER_DEVICE_TOKEN) {
  $credential = $null
  $storedPassword = $null
  if (Get-Command Get-StoredCredential -ErrorAction SilentlyContinue) {
    $credential = Get-StoredCredential -Target 'CATV Straight Map Renderer'
  }
  if ($credential) {
    $env:CATV_RENDERER_DEVICE_TOKEN = $credential.GetNetworkCredential().Password
  } else {
    $storedPassword = Get-WindowsGenericCredentialPassword 'CATV Straight Map Renderer'
  }
  if (-not $env:CATV_RENDERER_DEVICE_TOKEN -and $storedPassword) {
    $env:CATV_RENDERER_DEVICE_TOKEN = $storedPassword
  }
  if (-not $env:CATV_RENDERER_DEVICE_TOKEN) {
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
