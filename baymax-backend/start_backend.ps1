$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

$existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

if (Test-Path .\.venv\Scripts\Activate.ps1) {
  & .\.venv\Scripts\Activate.ps1
}

uvicorn app.main:app --host 0.0.0.0 --port 8000
