$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

$existing = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# Kill orphaned Chromium/Puppeteer processes that still hold the wwebjs session profile
$wwebSession = (Join-Path $PSScriptRoot ".wwebjs_cache\session").ToLower()
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Name -match 'chrome.exe|msedge.exe|chromium.exe') -and
    $_.CommandLine -and
    ($_.CommandLine.ToLower().Contains($wwebSession) -or $_.CommandLine.ToLower().Contains('wwebjs'))
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

$sessionPath = Join-Path $PSScriptRoot ".wwebjs_cache\session"
$locks = @('SingletonLock', 'SingletonSocket', 'SingletonCookie')
foreach ($lock in $locks) {
  $lockFile = Join-Path $sessionPath $lock
  if (Test-Path $lockFile) {
    Remove-Item -Force -ErrorAction SilentlyContinue $lockFile
  }
}

node server.js
