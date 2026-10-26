// Cross-platform smoke test for the shared Anlan Broker (Windows / Linux).
// Usage: node scripts/test-anlan-broker-portable.mjs
// Optionally set ANLAN_BROKER_FILE and ANLAN_TEST_DIR.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = process.env.ANLAN_DC_PACKAGE_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'DesktopCommander', 'node_modules', '@wonderwhy-er', 'desktop-commander');
const requireFromDc = createRequire(path.join(packageRoot, 'package.json'));
const { Client } = await import(pathToFileURL(requireFromDc.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(requireFromDc.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const broker = process.env.ANLAN_BROKER_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'anlan-mcp-broker.mjs');
const testDir = process.env.ANLAN_TEST_DIR || (process.platform === 'win32' ? 'C:\\Code' : '/home/ubuntu/.local/anlan-dc');

async function test(mode) {
  const client = new Client({ name: 'anlan-cross-platform-smoke', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [broker],
    env: {
      ...process.env,
      ANLAN_DISCOVERY_MODE: mode,
      ANLAN_DC_MAIN_STATS_SERVER: 'false',
      ANLAN_MAX_AGENTS: '2',
      ANLAN_AGENT_IDLE_MS: '60000',
      DC_AUTO_SPAWN: 'false'
    },
    stderr: 'inherit'
  });
  let id;
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map(x => x.name);
    assert(names.includes('get_config'), 'Missing get_config');
    assert(names.includes('agent_list'), 'Missing agent_list');
    const config = await client.callTool({ name: 'get_config', arguments: { origin: 'llm' } });
    assert(!config.isError, 'Failed get_config');
    assert(config.structuredContent?.config, 'Missing structuredContent');
    assert(config._meta?.dcTokenMeter, 'Missing native MCP token metadata');
    assert(!config.content.some(x => x.type === 'text' && x.text.includes('[DC 流量统计')), 'Result content was modified');

    if (mode === 'minimal') {
      assert.deepEqual(names.sort(), ['agent_list', 'get_config'], 'Unexpected minimal tool set');
      const blocked = await client.callTool({ name: 'agent_create', arguments: { task_label: 'Anlan test only' } });
      assert(blocked.isError, 'Minimal mode should reject agent_create');
    } else {
      assert(names.includes('agent_create') && names.includes('agent_call') && names.includes('agent_close'));
      const created = await client.callTool({ name: 'agent_create', arguments: { task_label: 'Anlan shared broker smoke test' } });
      assert(!created.isError);
      id = JSON.parse(created.content.find(x => x.type === 'text').text).agent_id;
      const listed = await client.callTool({ name: 'agent_list', arguments: {} });
      assert(listed.content[0].text.includes(id));
      const read = await client.callTool({ name: 'agent_call', arguments: {
        agent_id: id, tool: 'list_directory', args: { path: testDir, depth: 1 }
      } });
      assert(!read.isError, 'Child agent directory listing failed: ' + JSON.stringify(read.content).slice(0, 350));
      assert(read._meta?.dcTokenMeter, 'Child agent lost native token meter');
      const closed = await client.callTool({ name: 'agent_close', arguments: { agent_id: id } });
      assert(!closed.isError);
      id = undefined;
    }
    console.log('PASS mode=' + mode + ' platform=' + process.platform + ' tools=' + names.length + ' structuredContent=true nativeMeter=true');
  } finally {
    if (id) {
      try { await client.callTool({ name: 'agent_close', arguments: { agent_id: id } }); } catch {}
    }
    await client.close();
  }
}

await test('full');
await test('minimal');
