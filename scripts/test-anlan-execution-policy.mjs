import test from 'node:test';
import assert from 'node:assert/strict';
import { withLocalDcGuidance, LOCAL_DC_EXECUTION_POLICY } from './anlan-execution-policy.mjs';

test('Local DC priority is explicit and includes real-outcome verification', () => {
  assert.match(LOCAL_DC_EXECUTION_POLICY, /API\/SDK/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /CLI\/shell/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /UI Automation/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /Screenshots/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /Verify the real outcome/);
});

test('broker description augmentation retains tool schema without mutating source', () => {
  const tool = { name: 'gui_screenshot', description: 'Capture window.', inputSchema: { type: 'object', properties: { hwnd: { type: 'string' } } } };
  const result = withLocalDcGuidance(tool);
  assert.notStrictEqual(result, tool);
  assert.equal(result.name, tool.name);
  assert.strictEqual(result.inputSchema, tool.inputSchema);
  assert.equal(tool.description, 'Capture window.');
  assert.match(result.description, /LAST-RESORT VISUAL FALLBACK/);
  assert.match(result.description, /Do NOT screenshot routinely/);
});

test('API/CLI and GUI entrypoints advertise priority; batch minimizes round trips', () => {
  for (const name of ['start_process', 'gui_windows']) {
    const desc = withLocalDcGuidance({ name, description: 'Original description' }).description;
    assert.match(desc, /API\/SDK/);
    assert.match(desc, /CLI\/shell/);
    assert.match(desc, /UI Automation/);
  }
  assert.match(withLocalDcGuidance({name:'gui_batch'}).description, /remote round trips/);
  assert.match(withLocalDcGuidance({name:'gui_action'}).description, /does not prove/);
});

test('unrelated tools remain unchanged and mode minimal is compatible', () => {
  const other = { name: 'list_directory', description:'List directories', inputSchema:{ type:'object' } };
  assert.strictEqual(withLocalDcGuidance(other),other);
  const cfg=withLocalDcGuidance({name:'get_config',description:'Original'});
  assert.match(cfg.description,/Prefer API\/CLI/);
});
