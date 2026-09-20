import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-stats-'));
const statsDir = path.join(root, 'stats');
const historyDir = path.join(root, 'history');
const dashboardFile = path.join(root, 'dashboard.html');
await fs.mkdir(historyDir, { recursive: true });
await fs.writeFile(dashboardFile, '<!doctype html><title>UI_A</title>', 'utf8');

const now = Date.now();
const legacyTs = new Date(now - 3 * 86400000).toISOString();
const rich1Ts = new Date(now - 2 * 86400000).toISOString();
const rich2Ts = new Date(now - 1 * 86400000).toISOString();

await fs.writeFile(path.join(historyDir, 'claude_tool_call.log'),
  legacyTs + ' | ping                \t| Arguments: {"legacy":"abc"}\n', 'utf8');

const meter1 = {
  inputTokens: 10, outputTokens: 20, calls: 1,
  inputBytes: 100, outputBytes: 200,
  sessionStarted: now - 2 * 86400000 - 1000
};
const meter2 = {
  inputTokens: 17, outputTokens: 25, calls: 2,
  inputBytes: 150, outputBytes: 260,
  sessionStarted: meter1.sessionStarted
};
const rich = [
  { timestamp: rich1Ts, toolName: 'read_file', arguments: { path: 'a.txt' },
    output: { content: [{ type: 'text', text: 'one' }], _meta: { dcTokenMeter: meter1 } }, duration: 100 },
  { timestamp: rich2Ts, toolName: 'start_process', arguments: { command: 'echo x' },
    output: { content: [{ type: 'text', text: 'two' }], _meta: { dcTokenMeter: meter2 } }, duration: 200 }
];
await fs.writeFile(path.join(historyDir, 'tool-history.jsonl'),
  rich.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');

process.env.DC_STATS_SERVER = 'true';
process.env.DC_STATS_DIR = statsDir;
process.env.DC_HISTORY_DIR = historyDir;
process.env.DC_STATS_PORT = '17991';
process.env.DC_STATS_DASHBOARD_FILE = dashboardFile;

const { dcStats } = await import('../overrides/dc-stats-server.js?test=' + Date.now());
dcStats.start();
await new Promise((resolve) => setTimeout(resolve, 150));

await dcStats.record({
  eventId: 'live:1', ts: now - 1000, tool: 'read_file', status: 'ok',
  durationMs: 120, inputTokens: 12, outputTokens: 34,
  inputBytes: 100, outputBytes: 220, taskLabel: '统计测试'
});
await dcStats.record({
  eventId: 'live:2', ts: now, tool: 'start_process', status: 'error',
  durationMs: 250, inputTokens: 8, outputTokens: 0,
  inputBytes: 80, outputBytes: 0, taskLabel: '统计测试'
});
await dcStats.record({
  eventId: 'live:dedupe', ts: now + 200, tool: 'list_sessions', status: 'ok',
  durationMs: 80, inputTokens: 0, outputTokens: 5,
  inputBytes: 2, outputBytes: 40, taskLabel: '统计测试'
});

let data = await fetch('http://127.0.0.1:17991/api/summary?days=7').then((r) => r.json());
assert.equal(dcStats.server.address().address, '127.0.0.1');
assert.equal(data.recovery.imported, 3);
assert.equal(data.recovery.richMeter, 2);
assert.equal(data.recovery.legacyImported, 1);
assert.equal(data.range.calls, 6);
assert.equal(data.range.failures, 1);
assert.equal(data.tasks.find((x) => x.name === '统计测试').calls, 3);
const ui1 = await fetch('http://127.0.0.1:17991/').then((r) => r.text());
const ver1 = await fetch('http://127.0.0.1:17991/api/ui-version').then((r) => r.json());
assert(ui1.includes('UI_A'));
await new Promise((resolve) => setTimeout(resolve, 20));
await fs.writeFile(dashboardFile, '<!doctype html><title>UI_B</title>', 'utf8');
const ui2 = await fetch('http://127.0.0.1:17991/').then((r) => r.text());
const ver2 = await fetch('http://127.0.0.1:17991/api/ui-version').then((r) => r.json());
assert(ui2.includes('UI_B'), 'dashboard HTML should hot-load without server restart');
assert.notEqual(ver1.version, ver2.version, 'dashboard version should change after file edit');

await dcStats.close();

// Simulate an older pre-v2 history row that has no dcTokenMeter because a
// large output was capped before the meter was attached. It corresponds to the
// already-recorded live:list_sessions row and must not be imported a second time.
await fs.appendFile(path.join(historyDir, 'tool-history.jsonl'), JSON.stringify({
  timestamp: new Date(now + 300).toISOString(),
  toolName: 'list_sessions',
  arguments: {},
  output: { content: [{ type: 'text', text: '[output omitted from history: 40 bytes, over the 4096-byte cap]' }] },
  duration: 80
}) + '\n', 'utf8');

// Simulate a later Desktop Commander process/session that completed a call in
// tool-history while the live stats append was missed (for example, a gateway
// crash immediately after the tool result).
const rich3Ts = new Date(now + 1000).toISOString();
const meter3 = {
  inputTokens: 9, outputTokens: 11, calls: 1,
  inputBytes: 90, outputBytes: 110,
  sessionStarted: now + 500
};
await fs.appendFile(path.join(historyDir, 'tool-history.jsonl'), JSON.stringify({
  timestamp: rich3Ts,
  toolName: 'read_file',
  arguments: { path: 'recovered-after-restart.txt' },
  output: { content: [{ type: 'text', text: 'late' }], _meta: { dcTokenMeter: meter3 } },
  duration: 80
}) + '\n', 'utf8');

dcStats.start();
await new Promise((resolve) => setTimeout(resolve, 100));
data = await fetch('http://127.0.0.1:17991/api/summary?days=7').then((r) => r.json());
assert.equal(data.range.calls, 7, 'a later restart must recover the missing call without duplicating old capped history');
assert.equal(data.recovery.imported, 1, 'second recovery should import only the new call');
assert.equal(data.recovery.version, 2);

await dcStats.close();
dcStats.start();
await new Promise((resolve) => setTimeout(resolve, 100));
data = await fetch('http://127.0.0.1:17991/api/summary?days=7').then((r) => r.json());
assert.equal(data.range.calls, 7, 'repeatable history recovery must remain idempotent');
assert.equal(data.recovery.imported, 0, 'third recovery should not duplicate rows');

console.log('STATS_TEST_OK', JSON.stringify({
  address: dcStats.server.address().address,
  calls: data.range.calls,
  recovered: data.recovery.imported,
  legacy: data.recovery.legacyImported
}));

await dcStats.close();
await fs.rm(root, { recursive: true, force: true });
