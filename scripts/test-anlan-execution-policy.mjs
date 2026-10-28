import test from 'node:test';
import assert from 'node:assert/strict';
import { withLocalDcGuidance, LOCAL_DC_EXECUTION_POLICY } from './anlan-execution-policy.mjs';

test('policy chooses by intent, reliability, overhead and verifies outcomes', () => {
  assert.match(LOCAL_DC_EXECUTION_POLICY, /user intent/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /no fixed technology priority/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /CLI\/structured/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /UI Automation/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /screenshots/);
  assert.match(LOCAL_DC_EXECUTION_POLICY, /Verify the real result/);
  assert.doesNotMatch(LOCAL_DC_EXECUTION_POLICY, /Prefer an existing direct API\/SDK/);
});

test('description augmentation preserves original schema and text', () => {
  const tool = { name: 'gui_screenshot', description: 'Capture window.', inputSchema: { type: 'object', properties: { hwnd: { type: 'string' } } } };
  const result = withLocalDcGuidance(tool);
  assert.notStrictEqual(result, tool);
  assert.equal(result.name, tool.name);
  assert.strictEqual(result.inputSchema, tool.inputSchema);
  assert.equal(tool.description, 'Capture window.');
  assert.match(result.description, /VISUAL FALLBACK/);
  assert.match(result.description, /Do NOT screenshot routinely/);
});

test('broker advertises non-rigid strategy on relevant tools', () => {
  for (const name of ['start_process', 'gui_windows']) {
    const desc = withLocalDcGuidance({ name, description: 'Original' }).description;
    assert.match(desc, /no fixed technology priority/);
    assert.match(desc, /CLI\/structured/);
    assert.match(desc, /UI Automation/);
  }
  assert.match(withLocalDcGuidance({name:'gui_batch'}).description, /remote round trips/);
  assert.match(withLocalDcGuidance({name:'gui_action'}).description, /not proof/);
});

test('unrelated tools remain unchanged and minimal mode retains get_config guidance', () => {
  const other = { name: 'list_directory', description: 'List directories', inputSchema: { type: 'object' } };
  assert.strictEqual(withLocalDcGuidance(other), other);
  const config = withLocalDcGuidance({name:'get_config',description:'Original'});
  assert.match(config.description, /no fixed API\/CLI\/GUI hierarchy/);
});
