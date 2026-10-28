// Optional Windows GUI adapter for Anlan's existing local DC broker.
// Uses Microsoft's winapp CLI/UI Automation; never executes model-authored shell strings.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const workspace = process.env.DC_WORKSPACE_ROOT || 'C:\\Code';
const npmRoot = path.join(workspace, 'tools', 'winappcli');
const cli = process.env.ANLAN_WINAPP_PATH || path.join(npmRoot, 'node_modules', '@microsoft', 'winappcli', 'bin', 'win-x64', 'winapp.exe');
const captureDir = path.join(workspace, 'tools', 'winappcli', 'captures');
const MAX_OUTPUT = 160_000;
const MAX_IMAGE = 5 * 1024 * 1024;
const ARG_LIMIT = 12_000;
const field = (description, extra = {}) => ({ type: 'string', description, ...extra });
const locationFields = {
  app: field('App name/title or PID from gui_windows; use either app or hwnd, not both.'),
  hwnd: field('Window handle from gui_windows (decimal HWND); preferred for multiple windows.')
};
const location = {
  type: 'object', properties: locationFields, additionalProperties: false
};
export const guiTools = [
  { name: 'gui_status', description: 'Check availability of local Windows UI Automation via Microsoft winapp CLI; no desktop interaction.', inputSchema: { type: 'object', properties: {} } },
  { name: 'gui_windows', description: 'List local Windows desktop windows using WinApp UIA; optionally filter by application. Returns JSON containing HWNDs.', inputSchema: location },
  { name: 'gui_inspect', description: 'Read a Windows application accessibility/UIA control tree; prefer interactive=true for a compact actionable list. Select a window using app or hwnd.', inputSchema: { type: 'object', properties: { ...locationFields, selector: field('Optional control selector for a subtree.'), interactive: { type: 'boolean', description: 'Only actionable controls, lower token usage (default true).' }, depth: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false } },
  { name: 'gui_action', description: 'Search/read/operate an element in a Windows app. Use inspect first; prefer invoke/set-value UIA patterns over click/send-keys (which inject mouse/keyboard events). Target app or hwnd is mandatory; selectors may change after UI updates.', inputSchema: { type: 'object', properties: {
    ...locationFields,
    action: { type: 'string', enum: ['search', 'get-value', 'invoke', 'set-value', 'click', 'send-keys', 'wait-for'], description: 'UI operation.' },
    selector: field('UIA slug or element name; for send-keys this is the key sequence (e.g. Ctrl+A).'),
    value: field('Text to enter for set-value, or expected value for wait-for.'),
    timeout_ms: { type: 'integer', minimum: 100, maximum: 30000, description: 'For wait-for only; default 5000ms.' },
    gone: { type: 'boolean', description: 'For wait-for: wait until selector disappears.' }
  }, required: ['action', 'selector'], additionalProperties: false } },
  { name: 'gui_screenshot', description: 'Capture a Windows app/window to a PNG under C:\\Code. Only return image pixels when include_image=true; otherwise return the saved path to minimize tokens.', inputSchema: { type: 'object', properties: { ...locationFields, selector: field('Optional control selector to crop.'), include_image: { type: 'boolean', description: 'Include PNG as image in MCP response for visual analysis (default false).' } }, additionalProperties: false } }
];

export function buildGuiArgs(name, params = {}) {
  if (!guiTools.some(t => t.name === name) || name === 'gui_status') throw new Error('Unsupported GUI tool');
  const a = params || {};
  const app = String(a.app ?? '').trim();
  const hwnd = String(a.hwnd ?? '').trim();
  if (app && hwnd) throw new Error('Pass only one of app or hwnd');
  if (app.length > 200 || hwnd.length > 30 || (hwnd && !/^[0-9]+$/.test(hwnd)))
    throw new Error('Invalid app or hwnd');
  if (name !== 'gui_windows' && !app && !hwnd) throw new Error('Specify app or hwnd (use gui_windows first)');
  const target = app ? ['--app', app] : hwnd ? ['--window', hwnd] : [];
  const selector = (needed = true) => {
    const s = String(a.selector ?? '');
    if (needed && !s.trim()) throw new Error('selector is required');
    if (s.length > 250 || s.trim().startsWith('-')) throw new Error('Invalid selector');
    return s;
  };
  const withJson = v => ['ui', ...v, ...target, '--json'];
  if (name === 'gui_windows') return withJson(['list-windows']);
  if (name === 'gui_inspect') {
    const args = ['inspect'];
    if (a.selector) args.push(selector());
    if (a.interactive !== false) args.push('--interactive');
    if (a.depth !== undefined) {
      if (!Number.isInteger(a.depth) || a.depth < 1 || a.depth > 10) throw new Error('depth must be 1..10');
      args.push('--depth', String(a.depth));
    }
    return withJson(args);
  }
  if (name === 'gui_action') {
    const action = String(a.action || '');
    if (!['search', 'get-value', 'invoke', 'set-value', 'click', 'send-keys', 'wait-for'].includes(action)) throw new Error('Unsupported GUI action');
    const key = selector();
    const args = [action, key];
    if (action === 'set-value') {
      if (typeof a.value !== 'string' || a.value.length > ARG_LIMIT || a.value.startsWith('--'))
        throw new Error('set-value requires text (max 12000 characters, cannot start with --)');
      args.push(a.value);
    }
    if (action === 'wait-for') {
      const ms = a.timeout_ms ?? 5000;
      if (!Number.isInteger(ms) || ms < 100 || ms > 30000) throw new Error('timeout_ms must be 100..30000');
      if (a.gone === true) args.push('--gone');
      if (a.value !== undefined) {
        if (typeof a.value !== 'string' || a.value.length > 1000) throw new Error('Invalid wait-for value');
        args.push('--value', a.value);
      }
      args.push('--timeout', String(ms));
    }
    return withJson(args);
  }
  // The screenshot output file path is fully generated here; caller cannot choose arbitrary paths.
  if (name === 'gui_screenshot') {
    const filename = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.png';
    const file = path.join(captureDir, filename);
    return { args: withJson(['screenshot', ...(a.selector ? [selector()] : []), '--output', file]), file };
  }
}
const reply = (obj, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], ...(isError ? { isError: true } : {}) });

async function run(exe, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let oversized = false;
    const child = spawn(exe, args, {
      shell: false, windowsHide: true, cwd: workspace,
      env: { ...process.env, WINAPP_CLI_UPDATE_CHECK: '0', WINAPP_CLI_TELEMETRY_OPTOUT: '1', WINAPP_CLI_CACHE_DIRECTORY: path.join(npmRoot, 'cache') }
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const collect = (chunk, prop) => {
      const value = chunk.toString('utf8');
      if (prop === 'out') stdout += value;
      else stderr += value;
      if (stdout.length + stderr.length > MAX_OUTPUT) { oversized = true; child.kill(); }
    };
    child.stdout.on('data', x => collect(x, 'out'));
    child.stderr.on('data', x => collect(x, 'err'));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, oversized });
    });
  });
}
export async function executeGuiTool(name, args = {}) {
  if (process.platform !== 'win32') return reply({ ok: false, error: 'Windows only' }, true);
  if (name === 'gui_status') return reply({ ok: true, available: existsSync(cli), backend: 'Microsoft WinApp CLI / UI Automation', cli });
  if (!existsSync(cli)) return reply({ ok: false, error: 'WinApp CLI not installed. Install @microsoft/winappcli inside C:\\Code\\tools\\winappcli.', cli }, true);
  try {
    const cmd = buildGuiArgs(name, args);
    if (name === 'gui_screenshot') mkdirSync(captureDir, { recursive: true });
    const file = name === 'gui_screenshot' ? cmd.file : undefined;
    const command = name === 'gui_screenshot' ? cmd.args : cmd;
    const timeout = name === 'gui_action' && args.action === 'wait-for' ? Math.min(35000, (args.timeout_ms ?? 5000) + 7000) : 18000;
    const res = await run(cli, command, timeout);
    const ok = res.code === 0 && !res.oversized;
    let data;
    try { data = JSON.parse(res.stdout); } catch { data = res.stdout.trim(); }
    const summary = { ok, exit_code: res.code, ...(res.signal ? { signal: res.signal } : {}), ...(res.oversized ? { error: 'Output exceeds 160KB' } : {}), ...(res.stderr.trim() ? { stderr: res.stderr.trim().slice(0, 4000) } : {}), data, ...(file && ok ? { image_path: file } : {}) };
    const output = reply(summary, !ok);
    if (file && ok && args.include_image === true && existsSync(file) && statSync(file).size <= MAX_IMAGE) {
      output.content.push({ type: 'image', data: readFileSync(file).toString('base64'), mimeType: 'image/png' });
    }
    return output;
  } catch (err) {
    return reply({ ok: false, error: String(err?.message || err) }, true);
  }
}
