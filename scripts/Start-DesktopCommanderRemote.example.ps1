$ErrorActionPreference = 'Continue'
$dcRoot = Join-Path $env:LOCALAPPDATA 'DesktopCommander'
$packageRoot = Join-Path $dcRoot 'node_modules\@wonderwhy-er\desktop-commander'
$node = 'C:\Program Files\nodejs\node.exe'

$logDir = Join-Path $dcRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$startupLog = Join-Path $logDir 'remote-startup.log'
function Write-StartupLog {
    param([string]$Message)
    $timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff K')
    Add-Content -Path $startupLog -Value "[$timestamp] $Message" -Encoding UTF8
}

$proxyUp = $false
$probe = [Net.Sockets.TcpClient]::new()
try {
    $task = $probe.ConnectAsync('127.0.0.1', 7890)
    if ($task.Wait(150) -and $probe.Connected) { $proxyUp = $true }
} catch { } finally { $probe.Dispose() }
if ($proxyUp) {
    $env:HTTP_PROXY = 'http://127.0.0.1:7890'
    $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
    $env:NO_PROXY = 'localhost,127.0.0.1'
    $env:NODE_USE_ENV_PROXY = '1'
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
$env:DC_STATS_SERVER = 'true'

$entry = Join-Path $packageRoot 'dist\index.js'
$nodeVersion = try { (& $node --version 2>$null | Select-Object -First 1) } catch { 'unknown' }
Write-StartupLog "START pid=$PID node=$nodeVersion proxy=$proxyUp script=$PSCommandPath"
Write-Host 'Desktop Commander Remote' -ForegroundColor Cyan
Write-Host 'Press Ctrl+C or close this window to stop.' -ForegroundColor DarkGray
try {
    & $node $entry remote
    Write-StartupLog "EXIT pid=$PID code=$LASTEXITCODE"
}
catch {
    Write-StartupLog "ERROR pid=$PID type=$($_.Exception.GetType().FullName) message=$($_.Exception.Message)"
    throw
}