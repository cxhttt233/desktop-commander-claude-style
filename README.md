# Desktop Commander Claude-style Statusline

Public patch set for **Desktop Commander 0.2.50** on Windows.

It adds a compact Claude Code-inspired terminal status line, Desktop Commander tool-traffic counters, multimodal/Base64 log compaction, and a faster Remote launcher.

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