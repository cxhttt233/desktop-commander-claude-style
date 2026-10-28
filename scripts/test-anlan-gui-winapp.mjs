import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { guiTools, buildGuiArgs, executeGuiTool } from './anlan-gui-winapp.mjs';

test('five compact GUI tools are available without adding another MCP connection', () => {
  assert.deepEqual(guiTools.map(x => x.name), ['gui_status', 'gui_windows', 'gui_inspect', 'gui_action', 'gui_screenshot']);
});
test('windows enumeration supports optional app filter', () => {
  assert.deepEqual(buildGuiArgs('gui_windows'), ['ui', 'list-windows', '--json']);
  assert.deepEqual(buildGuiArgs('gui_windows', { app: 'notepad' }), ['ui', 'list-windows', '--app', 'notepad', '--json']);
});
test('inspect uses a stable HWND and interactive elements by default', () => {
  assert.deepEqual(buildGuiArgs('gui_inspect', { hwnd: '12345' }), ['ui', 'inspect', '--interactive', '--window', '12345', '--json']);
});
test('UI operations pass positional arguments separately (no model-authored shell)', () => {
  assert.deepEqual(buildGuiArgs('gui_action', { action: 'set-value', selector: 'Edit', value: 'hello world & exit', app: 'notepad' }),
    ['ui', 'set-value', 'Edit', 'hello world & exit', '--app', 'notepad', '--json']);
  assert.deepEqual(buildGuiArgs('gui_action', { action: 'wait-for', selector: 'Save', timeout_ms: 1500, app: 'notepad', gone: true }),
    ['ui', 'wait-for', 'Save', '--gone', '--timeout', '1500', '--app', 'notepad', '--json']);
});
test('invalid targeting and unsafe selectors fail closed', () => {
  assert.throws(() => buildGuiArgs('gui_action', { action: 'invoke', selector: 'Save' }), /Specify app or hwnd/);
  assert.throws(() => buildGuiArgs('gui_action', { action: 'invoke', selector: '--help', app: 'notepad' }), /Invalid selector/);
  assert.throws(() => buildGuiArgs('gui_windows', { hwnd: '12; drop' }), /Invalid app or hwnd/);
  assert.throws(() => buildGuiArgs('gui_inspect', { app: 'a', hwnd: '123' }), /only one/);
  assert.throws(() => buildGuiArgs('gui_action', { action: 'set-value', selector: 'Edit', app: 'n' }), /requires text/);
});
test('screenshots use broker-generated local paths', () => {
  const shot = buildGuiArgs('gui_screenshot', { app: 'notepad' });
  assert(shot.args.includes('--output'));
  assert(path.isAbsolute(shot.file));
  assert(shot.file.endsWith('.png'));
  assert(shot.file.includes(path.join('winappcli', 'captures')));
});
test('local GUI adapter reports its backend and availability', async () => {
  const status = await executeGuiTool('gui_status');
  const data = JSON.parse(status.content[0].text);
  if (process.platform === 'win32') {
    assert.equal(data.ok, true);
    assert.equal(data.backend, 'Microsoft WinApp CLI / UI Automation');
  } else assert.equal(data.ok, false);
});
