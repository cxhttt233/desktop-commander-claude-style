# Changelog

## R17

- Add optional gateway mode for multi-conversation Desktop Commander use without changing the ChatGPT plugin.
- A first tool call to the gateway allocates a temporary device row and returns a dedicated `deviceId`; the caller retries on that device and keeps using it for the conversation.
- Open one independent visible Desktop Commander window per temporary device, with its own Claude-style activity/status display.
- Keep one refresh-token/session authority and one local MCP engine in the gateway; child windows never copy or refresh the gateway refresh token.
- Give each temporary device a lightweight Realtime Presence socket authorized with the gateway's current access token, and synchronize token rotation from the gateway.
- Dispatch temporary-device tool calls concurrently through the shared local MCP client after their independent Presence doorbells arrive.
- Keep real multi-device behavior unchanged unless `DC_AUTO_SPAWN=true` is explicitly enabled on a device.
- Delete temporary devices, windows, and profile metadata after 24 hours without tool activity; do not manage worktrees or repositories.
- Disable Windows QuickEdit only inside auto-spawn worker consoles so accidental selection cannot freeze status/output until Enter or Esc is pressed.
- Stabilize Claude-style activity verbs across consecutive short calls: reuse the same word across idle gaps, keep it through settling, and only rotate during sustained work after roughly 12–20 seconds.
- Add a fixed child-agent task header. New auto-spawn sessions request a `# DC_AGENT_META` / `TASK=...` label, persist it in `instance.json`, and show `子 Agent · <任务>` at the top without executing or counting the metadata command.
- Add lightweight main-Remote startup lifecycle logging (`START`, `EXIT`, `ERROR`) without redirecting stdout/stderr or changing TTY behavior, for diagnosing intermittent launcher failures.
- Add a concise AI recovery hint to `DC_INSTANCE_ASSIGNED` / `DC_AGENT_META_OK`, and publish the Chinese task label as `dc_auto_spawn_v1.task_label` so `list_devices` can recover the correct conversation child instead of declaring DC unavailable too early.
- Clean up orphaned temporary devices on gateway restart and delete a temporary device if its window crashes.

## R16

- Start `↓` input-byte and call-count animation as soon as the tool call reaches the remote device.
- Pass real `tool_args` into the statusline and count their serialized UTF-8 bytes immediately.
- Keep `↑` output accounting truthful: it updates from the real result when the tool returns, with no fabricated streaming.
- Reconcile local live counters with server cumulative telemetry monotonically so concurrent calls cannot make counters move backward.
- Cap the completion settle animation for a quicker Claude-like handoff back to idle.

## R15

- Use only the confirmed-safe `✻` glyph for every spinner frame.
- Animate the spinner with ANSI brightness/color pulsing instead of switching Unicode star characters.
- This avoids tofu/boxed glyphs during animation on Windows Terminal fonts while keeping visible activity.

## R14

- Removed Unicode variation selectors that rendered as a boxed glyph in some Windows terminals.
- Compacted the status field to 8 columns; arrows and counters now sit much closer to the activity label.
- Added a safety column after each Unicode arrow so 2-cell arrow rendering cannot be overwritten by the counter.
- Counter settling now triggers an immediate verb change and uses faster verb cadence while numbers animate.
- Idle state now reads `DC idle`; activity words are selected from the short Claude-style pool to keep the line compact.

## R13

- Compact fixed-column status line.
- Fixed positions for input, output, and call count.
- Text-presentation spinner glyphs to reduce emoji/tofu-box rendering.
- Spinner/activity verb remains active while counters settle, then stops together.
- Claude-style verb cache extracted locally and refreshed only when Claude Code changes.
- Fast local proxy probe instead of `Get-NetTCPConnection`.
- Multimodal payload accounting and Base64 log compaction.