import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

process.env.DC_AUTO_SPAWN = 'true';
const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('package root required');

const modPath = path.join(packageRoot, 'dist', 'remote-device', 'dc-auto-spawn.js');
const { DCAutoSpawnManager } = await import(pathToFileURL(modPath).href);

const starts = [];
const updates = [];
const notifications = [];

const desktop = {
  async callClientTool(name, args, metadata) {
    starts.push({ name, at: Date.now(), args, metadata });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { content: [{ type: 'text', text: `done:${name}` }] };
  }
};

const remoteChannel = {
  user: { id: 'user-test' },
  lastKnownSession: { access_token: 'test-token' },
  async markCallExecuting() { return true; },
  async updateCallResult(id, status, result, errorMessage) {
    updates.push({ id, status, result, errorMessage });
  },  async notifyResult(id) {
    notifications.push(id);
  }
};

const manager = new DCAutoSpawnManager(remoteChannel, 'parent-device', desktop);

function makeAgent(deviceId, shortId) {
  const messages = [];
  const socket = {
    destroyed: false,
    write(line) {
      messages.push(JSON.parse(line));
    }
  };
  return {
    instanceId: `instance-${shortId}`,
    shortId,
    deviceId,
    deviceName: `host-agent-${shortId}`,
    taskLabel: `任务-${shortId}`,
    socket,
    lastActiveAt: 0,
    seenCallIds: new Set(),
    activeCalls: new Set(),
    crashed: false,
    destroying: false,
    messages
  };
}

const a = makeAgent('dev-a', 'a1');
const b = makeAgent('dev-b', 'b1');const rowA = { id: 'call-a', device_id: 'dev-a', tool_name: 'tool_a', tool_args: { a: 1 }, metadata: {} };
const rowB = { id: 'call-b', device_id: 'dev-b', tool_name: 'tool_b', tool_args: { b: 2 }, metadata: {} };

const startedAt = Date.now();
await Promise.all([
  manager.handlePendingRow(a, rowA),
  manager.handlePendingRow(b, rowB)
]);
const elapsed = Date.now() - startedAt;

assert.equal(starts.length, 2);
assert.ok(starts.every((x) => x.metadata?.dcAgentDeviceId), 'child device metadata should reach local MCP');
assert.deepEqual(starts.map((x) => x.metadata.dcAgentTaskLabel).sort(), ['任务-a1', '任务-b1']);
assert.ok(Math.abs(starts[0].at - starts[1].at) < 100, 'calls should start concurrently');
assert.ok(elapsed < 800, `parallel dispatch took too long: ${elapsed}ms`);
assert.deepEqual(updates.map((x) => [x.id, x.status]).sort(), [
  ['call-a', 'completed'],
  ['call-b', 'completed'],
]);
assert.deepEqual([...notifications].sort(), ['call-a', 'call-b']);

for (const agent of [a, b]) {
  assert.equal(agent.messages[0].type, 'call');
  assert.equal(agent.messages[1].type, 'result');
  assert.equal(agent.messages[1].ok, true);
  assert.equal(agent.activeCalls.size, 0);
}

console.log('R17_ROUTING_OK');
console.log(`parallel_start_delta_ms=${Math.abs(starts[0].at - starts[1].at)}`);
console.log(`elapsed_ms=${elapsed}`);