# Changelog

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