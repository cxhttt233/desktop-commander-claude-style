# Anlan RemotePC Broker: Windows / Linux shared core

The only maintained Broker implementation is `scripts/anlan-mcp-broker.mjs`.
Both platforms use exactly the same source file, with environment-specific launchers.
Avoid making Linux-only copies of the Broker logic.

## Compatible with existing behavior

- All 26 Desktop Commander tools and four isolated-agent tools.
- `agent_create`, `agent_call`, `agent_list`, `agent_close`.
- Full/minimal discovery (`ANLAN_DISCOVERY_MODE=full|minimal`, default full).
- Configurable child pool (`ANLAN_MAX_AGENTS`, default 6) and idle timeout
  (`ANLAN_AGENT_IDLE_MS`, default 24 hours; minimum 60 seconds).
- Preserve `content`, `structuredContent` and MCP `_meta` from child DC calls.
  Never append token usage strings to `content`; the native meter lives at
  `_meta.dcTokenMeter`. This usage is an estimate, not the model's API bill.
- `ANLAN_DC_MAIN_STATS_SERVER=true` enables the DC-hosted 17891 stats server
  (Linux). Leave unset for Windows, which uses the separate
  `scripts/anlan-local-stats.mjs` process.
- `ANLAN_DC_PACKAGE_ROOT`: absolute path to the installed DC package.
  On Windows, the default is under `%LOCALAPPDATA%\DesktopCommander\node_modules`.
  On Linux, this is configured by `scripts/start-anlan-broker-linux.sh`.

## Windows

Continue using `scripts/Start-AnlanTunnel-Agents.bat`. It loads
`scripts/anlan-mcp-broker.mjs` from this repository. For active sessions,
relaunch the Tunnel when convenient after updating the repository.
The dashboard remains independent of the Broker's process.

## Linux

Runtime location: `/home/ubuntu/.local/anlan-dc/`.
Copy `scripts/anlan-mcp-broker.mjs` there (same filename, same SHA-256 hash).
Copy `scripts/start-anlan-broker-linux.sh` to
`/home/ubuntu/.local/anlan-dc/start-local-agents.sh`, preserving executable mode.
The systemd `anlan-mcp-tunnel.service` uses that launcher; it must not be
replaced with a different `mcp.command` path.

Before switching: preserve backups of the old Broker and launcher, validate
with `node --check`, and run the portable smoke test using:

```sh
ANLAN_DC_PACKAGE_ROOT=/home/ubuntu/.local/anlan-dc/app/node_modules/@wonderwhy-er/desktop-commander \
 ANLAN_BROKER_FILE=/home/ubuntu/.local/anlan-dc/anlan-mcp-broker.mjs \
 node /home/ubuntu/.local/anlan-dc/test-anlan-broker-portable.mjs
```

Then restart the Tunnel during a safe window and verify Linux `get_config`,
`_meta.dcTokenMeter`, the 17891 loopback listener, and agent invocation.
If the Tunnel does not reconnect, restore the saved files and restart.

## Smoke tests

On Windows:

```powershell
node --check scripts/anlan-mcp-broker.mjs
node scripts/test-anlan-broker-portable.mjs
node scripts/test-anlan-mcp-broker.mjs
```

Test both discovery modes. Test that tool results keep native token metadata,
config cards keep `structuredContent`, and child-agent tool results remain valid.

## Important limitations

Whether ChatGPT renders usage information is controlled partly by its client.
Matching Broker responses is necessary for consistency but not proof that the
ChatGPT UI will display exactly the same interface on every connection.
