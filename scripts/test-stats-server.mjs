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

let data = await fetch('http://127.0.0.1:17991/api/summary?days=7').then((r) => r.json());
assert.equal(dcStats.server.address().address, '127.0.0.1');
assert.equal(data.recovery.imported, 3);
assert.equal(data.recovery.richMeter, 2);
assert.equal(data.recovery.legacyImported, 1);
assert.equal(data.range.calls, 5);
assert.equal(data.range.failures, 1);
assert.equal(data.tasks.find((x) => x.name === '统计测试').calls, 2);
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
dcStats.start();
await new Promise((resolve) => setTimeout(resolve, 100));
data = await fetch('http://127.0.0.1:17991/api/summary?days=7').then((r) => r.json());
assert.equal(data.range.calls, 5, 'history recovery must be idempotent');

console.log('STATS_TEST_OK', JSON.stringify({
  address: dcStats.server.address().address,
  calls: data.range.calls,
  recovered: data.recovery.imported,
  legacy: data.recovery.legacyImported
}));

await dcStats.close();
await fs.rm(root, { recursive: true, force: true });
