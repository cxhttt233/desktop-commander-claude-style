# Desktop Commander Claude-style Statusline

Public patch set for **Desktop Commander 0.2.50** on Windows.

It adds a compact Claude Code-inspired terminal status line, Desktop Commander tool-traffic counters, multimodal/Base64 log compaction, a faster Remote launcher, and an optional multi-conversation auto-spawn mode.

```text
✻ DC idle  ↓ 1.07K  ↑ 8.42K  · 13
✽ Ponder   ↓ 1.12K  ↑ 9.03K  · 14
```

## Features

- Fixed one-line bottom status area; logs scroll above it.
- Fixed positions for `↓`, `↑`, and call count.
- `↓` input bytes and call count start animating immediately when a tool call begins.
- `↑` output bytes settle from the real tool result when it becomes available; non-streaming tools are not given fake output growth.
- Spinner/activity text remains active while the numeric odometer settles, then stops together.
- `↓` / `↑` measure cumulative Desktop Commander tool payload bytes for the current process.
- Images/audio/blob/raw Base64 bodies are summarized in local logs instead of flooding the terminal.
- Claude-style whimsical verbs are extracted locally from an installed Claude Code binary; the generated cache is not committed.
- Windows launcher uses a ~150 ms TCP proxy probe and only refreshes the verb cache after Claude Code changes.
- Optional R17 gateway mode allocates a temporary `deviceId` for a new AI conversation and opens a separate visible Desktop Commander window for it.
- Auto-spawned devices share the gateway's local MCP engine and refresh-token authority. Each temporary device gets only a lightweight Realtime Presence socket using the gateway's current access token; refresh tokens are never copied into child processes.
- Temporary devices are deleted after 24 hours without a tool call. Worktrees, branches, repositories, and working directories remain user-controlled.
- Gateway mode is opt-in per real device, so other physical/VM Desktop Commander devices keep their normal behavior.

## Auto-spawn mode

Enable it only on the Desktop Commander instance you want to act as the entry gateway:

```powershell
$env:DC_AUTO_SPAWN = 'true'
```

The first non-management tool call to that gateway returns `DC_INSTANCE_ASSIGNED` with a new `deviceId` plus a short recovery rule. Before retrying the original call, register a short Chinese task label with `# DC_AGENT_META` and `TASK=<6-20字中文任务>`. Desktop Commander intercepts this metadata command instead of executing it, persists the label in `instance.json`, publishes it as `capabilities.dc_auto_spawn_v1.task_label`, and shows `子 Agent · <任务>` in a fixed header. The returned recovery rule tells the AI to keep using that conversation's device, call `list_devices` before claiming Desktop Commander is unavailable, recover only a child whose `task_label` matches the conversation, and allocate a new child from the gateway if no match exists.

## Install

Tested with `@wonderwhy-er/desktop-commander` **0.2.50**.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The installer creates a timestamped backup and **does not restart Desktop Commander**.

For the faster launcher, adapt `scripts/Start-DesktopCommanderRemote.example.ps1`.

## Scope

This is a Desktop Commander tool-traffic meter, not a model context/reasoning token meter. Activity verbs are presentation only and do not represent hidden reasoning stages.

## Privacy

No device IDs, auth tokens, email addresses, local usernames, absolute user-profile paths, or generated Claude verb cache are committed.

## Upstream

Desktop Commander: https://github.com/wonderwhy-er/DesktopCommanderMCP

Desktop Commander is MIT licensed. This is an independent customization and is not affiliated with the upstream project, Anthropic, or OpenAI.