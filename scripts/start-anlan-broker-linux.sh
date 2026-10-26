#!/bin/sh
# Anlan Broker Linux launcher: same core module as Windows.
set -eu
export HOME="${HOME:-/home/ubuntu}"
export ANLAN_DC_PACKAGE_ROOT="${ANLAN_DC_PACKAGE_ROOT:-$HOME/.local/anlan-dc/app/node_modules/@wonderwhy-er/desktop-commander}"
export ANLAN_MAX_AGENTS="${ANLAN_MAX_AGENTS:-3}"
export ANLAN_AGENT_IDLE_MS="${ANLAN_AGENT_IDLE_MS:-900000}"
export ANLAN_DISCOVERY_MODE="${ANLAN_DISCOVERY_MODE:-full}"
export ANLAN_DC_MAIN_STATS_SERVER=true
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROME_DOWNLOAD=true
exec /usr/bin/node "$HOME/.local/anlan-dc/anlan-mcp-broker.mjs"
