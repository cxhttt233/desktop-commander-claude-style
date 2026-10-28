# Windows GUI for Anlan Local DC (WinApp CLI)

## What is added

The existing OpenAI Tunnel -> Anlan MCP broker -> Desktop Commander connection is unchanged.
On Windows the broker additionally exposes five native tools, with no extra MCP instance:

| Tool | Purpose |
| --- | --- |
| gui_status | Check WinApp CLI installation and readiness |
| gui_windows | List window titles, PIDs and HWNDs |
| gui_inspect | Read UI Automation tree; default interactive elements only |
| gui_action | Search, read values, invoke, set values, click, send keys, wait for state |
| gui_screenshot | Capture a specific app/window; optional image content |

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

## Agent workflow

1. gui_status({}) -> available: true.
2. gui_windows({app:"notepad"}) -> select the correct HWND.
3. gui_inspect({hwnd:"123456",interactive:true}) -> discover element selector.
4. gui_action({hwnd:"123456",action:"set-value",selector:"Edit",value:"Hello"}).
5. gui_action({hwnd:"123456",action:"get-value",selector:"Edit"}) -> verify result.
6. gui_screenshot({hwnd:"123456",include_image:false}) -> saved PNG path.
7. Use include_image:true only when model visual analysis is necessary.

Screenshots save under C:\Code\tools\winappcli\captures, outside the Git repository.
Default screenshots capture a specified window and related dialog, not the entire desktop.

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
