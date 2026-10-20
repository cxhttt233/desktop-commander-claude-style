@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Anlan Tunnel - Local DC Agents
REM Independent OpenAI Tunnel -> local Desktop Commander with task-isolated agents.
REM Never paste this file or the Runtime API key into a chat.
set "CONTROL_PLANE_API_KEY=sk-REPLACE-WITH-NEW-RUNTIME-KEY"
set "CONTROL_PLANE_TUNNEL_ID=tunnel_REPLACE_WITH_YOUR_TUNNEL_ID"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "ALL_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=localhost,127.0.0.1,::1"
set "DC_WORKSPACE_ROOT=C:\Code"
set "DC_AUTO_SPAWN=false"
set "DC_STATS_SERVER=false"
set "ANLAN_MAX_AGENTS=6"
set "NODE=C:\Program Files\nodejs\node.exe"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "BROKER=C:\Code\desktop-commander-claude-style\scripts\anlan-mcp-broker.mjs"
set "STATS=C:\Code\desktop-commander-claude-style\scripts\anlan-local-stats.mjs"
set "BROKER_ARG=C:/Code/desktop-commander-claude-style/scripts/anlan-mcp-broker.mjs"
set "TUNNEL=%~dp0tunnel-client.exe"

if "%CONTROL_PLANE_API_KEY%"=="sk-REPLACE-WITH-NEW-RUNTIME-KEY" (
  echo [ERROR] Set a newly issued Runtime API key in this BAT first.
  goto :end
)
if "%CONTROL_PLANE_TUNNEL_ID%"=="tunnel_REPLACE_WITH_YOUR_TUNNEL_ID" (
  echo [ERROR] Set the actual OpenAI Tunnel ID in this BAT first.
  goto :end
)
if not exist "%NODE%" (echo [ERROR] Node.js not found: "%NODE%" & goto :end)
if not exist "%TUNNEL%" (echo [ERROR] tunnel-client.exe not found next to BAT & goto :end)
if not exist "%BROKER%" (echo [ERROR] Local broker missing: "%BROKER%" & goto :end)
if not exist "%STATS%" (echo [ERROR] Stats runner missing: "%STATS%" & goto :end)
"%NODE%" --check "%BROKER%"
if errorlevel 1 goto :end

REM Do not create another dashboard process if 17891 is already in use.
netstat -ano | findstr /R /C:":17891 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Starting local 17891 dashboard...
  start "Anlan DC Stats 17891" /min "%NODE%" "%STATS%"
) else (
  echo [INFO] Existing 17891 listener detected, leaving it alone.
)

echo [INFO] Tunnel: %CONTROL_PLANE_TUNNEL_ID%
echo [INFO] DC workspace: %DC_WORKSPACE_ROOT%
echo [INFO] Local MCP broker, max agents: %ANLAN_MAX_AGENTS%
echo [INFO] Dashboard: http://127.0.0.1:17891
echo [INFO] Keep this window running. Ctrl+C stops only this Tunnel.
cd /d "%~dp0"
"%TUNNEL%" run --mcp.command "node %BROKER_ARG%"
echo [WARN] tunnel-client exited with code %ERRORLEVEL%.
:end
echo [INFO] Press any key to close.
pause >nul
endlocal
