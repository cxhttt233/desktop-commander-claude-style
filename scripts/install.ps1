param(
    [string]$PackageRoot = (Join-Path $env:LOCALAPPDATA 'DesktopCommander\node_modules\@wonderwhy-er\desktop-commander')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $PackageRoot ('dc-custom-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot | Out-Null

foreach ($rel in @('dist\server.js','dist\remote-device\device.js')) {
    $src = Join-Path $PackageRoot $rel
    $dst = Join-Path $backupRoot $rel
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
    Copy-Item $src $dst -Force
}

python (Join-Path $PSScriptRoot 'apply.py') $PackageRoot
Copy-Item (Join-Path $repoRoot 'overrides\dc-traffic-meter.js') (Join-Path $PackageRoot 'dist\dc-traffic-meter.js') -Force
Copy-Item (Join-Path $repoRoot 'overrides\remote-device\dc-content-summary.js') (Join-Path $PackageRoot 'dist\remote-device\dc-content-summary.js') -Force
Copy-Item (Join-Path $repoRoot 'overrides\remote-device\dc-terminal-status.js') (Join-Path $PackageRoot 'dist\remote-device\dc-terminal-status.js') -Force

$node = 'C:\Program Files\nodejs\node.exe'
& $node --check (Join-Path $PackageRoot 'dist\server.js')
& $node --check (Join-Path $PackageRoot 'dist\remote-device\device.js')
& $node --check (Join-Path $PackageRoot 'dist\remote-device\dc-terminal-status.js')

Write-Host "Installed. Backup: $backupRoot" -ForegroundColor Green
Write-Host 'Desktop Commander was not restarted.' -ForegroundColor Yellow
