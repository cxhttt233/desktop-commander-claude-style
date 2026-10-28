# Windows GUI for Anlan Local DC (WinApp CLI)

## What is added

The existing OpenAI Tunnel -> Anlan MCP broker -> Desktop Commander connection is unchanged.
On Windows the broker additionally exposes six native tools, with no extra MCP instance:

| Tool | Purpose |
| --- | --- |
| gui_status | Check WinApp CLI installation and readiness |
| gui_windows | List window titles, PIDs and HWNDs |
| gui_inspect | Read UI Automation tree; default interactive elements only |
| gui_action | Search, read values, invoke, set values, click, send keys, wait for state |
| gui_screenshot | Capture a specific app/window; optional image content |
| gui_batch | Execute 1–8 GUI steps sequentially in a single RemotePC call, stop on error |

The broker passes fixed, validated arguments directly to Microsoft's native CLI via Node spawn with shell=false.
Only the winapp ui command family is exposed; it cannot run arbitrary winapp/package/shell commands.
Mutating actions and screenshots require an explicit app or HWND. Prefer HWND when multiple windows are present.
Use UIA invoke/set-value for efficient operations; click/send-keys are fallback input injection.
No automatic per-app approval is built into this adapter: ChatGPT plugin access is governed by its existing permissions. Review interactive/destructive actions accordingly.

## Installing on Windows 11 x64

WinApp CLI 0.7.1 was installed under C:\Code\tools\winappcli on the test computer:

    npm install @microsoft/winappcli@0.7.1 --prefix C:\Code\tools\winappcli --cache C:\Code\tools\npm-cache --no-audit --no-fund --ignore-scripts

The expected executable is:

    C:\Code\tools\winappcli\node_modules\@microsoft\winappcli\bin\win-x64\winapp.exe

This is an independent local npm installation, not an overwrite of Desktop Commander.
If you install elsewhere, set ANLAN_WINAPP_PATH to the absolute path of winapp.exe before starting the broker.
Set ANLAN_GUI_ENABLED=false to omit these tools. On Linux and macOS the broker never exposes them.

After updating the broker code, restart the existing Tunnel/Broker process once and refresh the plugin's tool discovery. Do not start a second Tunnel with the same ID. Existing DC tools and local statistics stay intact.

## Agent execution guidance (advertised by the Broker)

The Broker appends this guidance to its MCP tool descriptions (including `start_process`, `gui_windows`, `gui_batch` and `gui_screenshot`), so agents see it during tool discovery.

**There is no fixed API > CLI > GUI hierarchy. Choose the method that reliably meets the user's intent with the fewest calls and least execution overhead.** Do not go hunting for an API, or replace a requested GUI demonstration with a backend operation merely because it is technically available.

- For routine local file, process, log and data work, existing CLI/structured DC tools are usually effective.
- If interacting with an actual desktop application is part of the task, operate its UI. Prefer known UI Automation controls (`invoke`/`set-value`/`get-value`), with keyboard or clipboard fallback for inaccessible editors.
- Avoid unnecessary screenshot capture and visual reasoning. Use them for visual tasks, inaccessible controls or unresolved ambiguity; they are not mandatory for every GUI step.
- **Verify the actual result**, not just a tool's success status. Prefer UIA readback, file contents, logs, process/data state or another reliable structured check.
- Reduce repeated Tunnel calls with `gui_batch` and targeted UIA selectors; full control-tree scans can also be expensive.

This is advisory metadata, not a new constraint or a change to Desktop Commander's execution permissions.

## Agent workflow

1. gui_status({}) -> available: true.
2. gui_windows({app:"notepad"}) -> select the correct HWND.
3. gui_inspect({hwnd:"123456",interactive:true}) -> discover element selector.
4. gui_action({hwnd:"123456",action:"set-value",selector:"Edit",value:"Hello"}).
5. gui_action({hwnd:"123456",action:"get-value",selector:"Edit"}) -> verify result.
6. Confirm the real outcome via gui_action/get-value or a CLI/file/log check where available.
7. If and only if visual verification is actually needed, call gui_screenshot; set include_image:true only when model vision is necessary.

Screenshots save under C:\Code\tools\winappcli\captures, outside the Git repository.
Default screenshots capture a specified window and related dialog, not the entire desktop.

## GUI batch (one remote call, multiple local steps)

The batch tool reduces the number of round trips across ChatGPT -> Tunnel -> Local DC. The caller supplies **one app or HWND** and 1–8 predeclared steps. Actions are executed in order with per-step execution times; the batch stops at the first error. It does not interpret JavaScript or shell code.

For example, a dynamic selector can be carried safely from a previous *unique* UIA search (search must return exactly one match):

```json
{
  "hwnd": "123456",
  "steps": [
    {"tool":"gui_action","action":"search","selector":"文件"},
    {"tool":"gui_action","action":"invoke","selector_from_step":0},
    {"tool":"gui_inspect","interactive":true}
  ]
}
```

The screenshot remains a local PNG unless the **final** step explicitly requests `include_image:true`. To prevent oversized responses, the batch limits inspect results to 30 elements per window and search results to 15 matches in its text output; dynamic selector resolution still uses the full internal search result. Batches cannot change the target window or run arbitrary shell commands. Default duration budget: 45s, maximum 90s, checked before each step (in-progress steps finish normally).

**Measured on LinkRuboh (Windows 11 + Notepad, 2026-10-28):** the four-step search -> invoke -> inspect -> screenshot batch completed locally in **4.81 seconds** (1.07+0.87+1.32+1.55s). This saves remote round trips; it is not a claim that UIA's individual native operations have become faster.

## Limits and safety

- A logged-in, unlocked Windows desktop is required for OS-wide mouse/keyboard input; read-only UIA calls may work while locked.
- Elevated programs and the UAC secure desktop have different permissions.
- Canvas/self-drawn or some Electron controls may expose incomplete accessibility trees; use screenshots as fallback.
- The adapter forbids arbitrary command execution, validates selectors/targets, and times out GUI operations.
- UIA selectors may change after re-rendering; refresh via gui_inspect.
- Microsoft's WinApp CLI is public preview. Verify future upgrades, and do not commit installed binaries.

## Tests

    node --test scripts/test-anlan-gui-winapp.mjs
    node scripts/test-anlan-mcp-broker.mjs

WinApp CLI has been verified against a real Chrome window for window listing, interactive inspection and PNG capture. The screenshots are not committed.

Upstream: https://github.com/microsoft/winappCli
