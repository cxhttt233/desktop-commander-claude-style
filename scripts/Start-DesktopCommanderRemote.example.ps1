$ErrorActionPreference = 'Continue'
$dcRoot = Join-Path $env:LOCALAPPDATA 'DesktopCommander'
$packageRoot = Join-Path $dcRoot 'node_modules\@wonderwhy-er\desktop-commander'
$node = 'C:\Program Files\nodejs\node.exe'

$proxyUp = $false
$probe = [Net.Sockets.TcpClient]::new()
try {
    $task = $probe.ConnectAsync('127.0.0.1', 7890)
    if ($task.Wait(150) -and $probe.Connected) { $proxyUp = $true }
} catch { } finally { $probe.Dispose() }
if ($proxyUp) {
    $env:HTTP_PROXY = 'http://127.0.0.1:7890'
    $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
}

$verbCache = Join-Path $dcRoot 'claude-spinner-verbs.json'
$claudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
$extractor = Join-Path $PSScriptRoot 'extract-claude-verbs.py'
$refresh = -not (Test-Path $verbCache)
if (-not $refresh -and (Test-Path $claudeExe)) {
    $refresh = (Get-Item $claudeExe).LastWriteTimeUtc -gt (Get-Item $verbCache).LastWriteTimeUtc
}
if ($refresh -and (Test-Path $extractor)) { python $extractor *> $null }

# Optional gateway mode: allocate one temporary DC device/window per AI conversation.
$env:DC_AUTO_SPAWN = 'true'

Write-Host 'Desktop Commander Remote' -ForegroundColor Cyan
Write-Host 'Press Ctrl+C or close this window to stop.' -ForegroundColor DarkGray
& $node (Join-Path $packageRoot 'dist\index.js') remote