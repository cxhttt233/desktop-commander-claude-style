import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

process.env.DC_AUTO_SPAWN = 'true';
const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('package root required');
const modPath = path.join(packageRoot, 'dist', 'remote-device', 'dc-auto-spawn.js');
const { DCAutoSpawnManager } = await import(pathToFileURL(modPath).href);

const rows = [
  { id: 'call-a', device_id: 'dev-a', status: 'pending', tool_name: 'tool_a', tool_args: { a: 1 }, metadata: {} },
  { id: 'call-b', device_id: 'dev-b', status: 'pending', tool_name: 'tool_b', tool_args: { b: 2 }, metadata: {} },
];
let pollQueries = 0;
const client = {
  from(table) {
    assert.equal(table, 'mcp_remote_calls');
    const q = {
      select() { return q; },
      in(column, ids) { assert.equal(column, 'device_id'); q.ids = ids; return q; },
      eq(column, value) { assert.equal(column, 'status'); assert.equal(value, 'pending'); return q; },
      async limit() {
        pollQueries++;
        return { data: rows.filter((r) => q.ids.includes(r.device_id)), error: null };
      }
    };
    return q;
  }
};const updates = [];
const notifications = [];
const starts = [];
const desktop = {
  async callClientTool(name, args) {
    starts.push({ name, at: Date.now(), args });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { content: [{ type: 'text', text: `done:${name}` }] };
  }
};
const remoteChannel = {
  client,
  user: { id: 'user-test' },
  async markCallExecuting() { return true; },
  async updateCallResult(id, status, result, errorMessage) {
    updates.push({ id, status, result, errorMessage });
  },
  async notifyResult(id) {
    notifications.push(id);
  }
};
const manager = new DCAutoSpawnManager(remoteChannel, 'parent-device', desktop);

function makeAgent(deviceId, shortId) {
  const messages = [];
  const socket = {
    destroyed: false,
    write(line) { messages.push(JSON.parse(line)); }
  };
  return {
    instanceId: `instance-${shortId}`,
    shortId,
    deviceId,
    deviceName: `host-agent-${shortId}`,
    socket,
    lastActiveAt: 0,
    seenCallIds: new Set(),
    activeCalls: new Set(),
    crashed: false,
    destroying: false,
    messages
  };
}const a = makeAgent('dev-a', 'a1');
const b = makeAgent('dev-b', 'b1');
manager.agents.set(a.deviceId, a);
manager.agents.set(b.deviceId, b);

const startedAt = Date.now();
await manager.pollPendingCalls();
await new Promise((resolve) => setTimeout(resolve, 500));
const elapsed = Date.now() - startedAt;

assert.equal(pollQueries, 1);
assert.equal(starts.length, 2);
assert.ok(Math.abs(starts[0].at - starts[1].at) < 100, 'calls should be dispatched concurrently');
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
  assert.equal(agent.seenCallIds.size, 1);
  assert.equal(agent.activeCalls.size, 0);
}

await manager.pollPendingCalls();
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(starts.length, 2, 'duplicate pending rows must not execute twice');
assert.equal(pollQueries, 2);
assert.equal(manager.pollInFlight, false);

console.log('R17_POLL_ROUTER_OK');
console.log(`parallel_start_delta_ms=${Math.abs(starts[0].at - starts[1].at)}`);
console.log(`elapsed_ms=${elapsed}`);