import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGuiBatch, executeGuiTool } from './anlan-gui-winapp.mjs';

const target = { hwnd: '12345' };

test('batch validates one-to-eight predefined operations and same HWND', () => {
  assert.equal(validateGuiBatch({ ...target, steps: [{ tool: 'gui_inspect', interactive: true }, { tool: 'gui_screenshot' }] }), true);
  assert.throws(() => validateGuiBatch({ ...target, steps: [] }), /1\.\.8/);
  assert.throws(() => validateGuiBatch({ ...target, steps: Array.from({length:9}, () => ({tool:'gui_inspect'})) }), /1\.\.8/);
  assert.throws(() => validateGuiBatch({ steps: [{tool:'gui_inspect'}] }), /Specify an app or HWND/);
  assert.throws(() => validateGuiBatch({ ...target, steps: [{tool:'gui_action', action:'invoke', selector:'File', hwnd:'999'}] }), /Unknown step property/);
  assert.throws(() => validateGuiBatch({ ...target, steps: [{tool:'shell', command:'whoami'}] }), /Invalid step tool/);
});
test('dynamic selectors require earlier unique search, never arbitrary JS/shell', () => {
  assert.equal(validateGuiBatch({ ...target, steps: [
    { tool:'gui_action', action:'search', selector:'文件' },
    { tool:'gui_action', action:'invoke', selector_from_step:0 }
  ] }), true);
  assert.throws(() => validateGuiBatch({ ...target, steps: [{tool:'gui_action',action:'invoke',selector_from_step:0}] }), /previous search/);
  assert.throws(() => validateGuiBatch({ ...target, steps: [
    { tool:'gui_inspect' }, { tool:'gui_action', action:'invoke', selector_from_step:0 }
  ] }), /previous search/);
  assert.throws(() => validateGuiBatch({ ...target, steps: [
    { tool:'gui_action', action:'search', selector:'File' }, { tool:'gui_action', action:'invoke', selector:'Close', selector_from_step:0 }
  ] }), /previous search/);
  assert.throws(() => validateGuiBatch({ ...target, steps: [{tool:'gui_action',action:'set-value',selector:'Edit'}] }), /requires text/);
});
test('only final screenshot may return pixels and duration stays bounded', () => {
  assert.throws(() => validateGuiBatch({ ...target, steps:[{tool:'gui_screenshot',include_image:true},{tool:'gui_inspect'}] }), /Only final screenshot/);
  assert.throws(() => validateGuiBatch({ ...target, max_duration_ms:100000, steps:[{tool:'gui_inspect'}] }), /max_duration_ms/);
});
test('invalid batch fails before changing desktop', async () => {
  if (process.platform !== 'win32') return;
  const response = await executeGuiTool('gui_batch', { hwnd: '12345', steps: [{ tool:'gui_action', action:'invoke', selector_from_step:0 }] });
  assert.equal(response.isError, true);
  const data=JSON.parse(response.content[0].text);
  assert.equal(data.failed_step,0);
  assert.equal(data.results.length,0);
});
