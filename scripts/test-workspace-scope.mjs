import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';

const packageRoot = process.argv[2] || path.join(
  process.env.LOCALAPPDATA, 'DesktopCommander', 'node_modules',
  '@wonderwhy-er', 'desktop-commander'
);
const nodeModules = path.resolve(packageRoot, '..', '..');
const sdk = (...parts) => pathToFileURL(path.join(
  nodeModules, '@modelcontextprotocol', 'sdk', 'dist', 'esm', ...parts
)).href;
const { Client } = await import(sdk('client', 'index.js'));
const { StdioClientTransport } = await import(sdk('client', 'stdio.js'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(packageRoot, 'dist', 'index.js'), '--no-onboarding'],
  env: {
    DC_WORKSPACE_ROOT: 'C:\\Code',
    DC_STATS_DISABLE: '1',
    DC_AUTO_SPAWN: 'false'
  },
  stderr: 'pipe'
});
const client = new Client(
  { name: 'workspace-scope-test', version: '1.0.0' },
  { capabilities: {} }
);
const text = (result) => (result.content || [])
  .filter((x) => x.type === 'text')
  .map((x) => x.text)
  .join('\n');

try {
  await client.connect(transport);

  const config = await client.callTool({ name: 'get_config', arguments: {} });
  assert.match(text(config), /C:\\+Code/i);

  const cwd = await client.callTool({
    name: 'start_process',
    arguments: {
      command: '(Get-Location).Path',
      shell: 'powershell',
      timeout_ms: 3000
    }
  });
  assert.equal(cwd.isError, undefined);
  const cwdPid = Number(text(cwd).match(/PID (\d+)/)?.[1]);
  assert(cwdPid, 'start_process should return a PID');
  const cwdOutput = await client.callTool({
    name: 'read_process_output',
    arguments: { pid: cwdPid, timeout_ms: 3000 }
  });
  assert.match(text(cwd) + '\n' + text(cwdOutput), /C:\\+Code/i);
  const outside = await client.callTool({
    name: 'start_process',
    arguments: {
      command: 'Get-ChildItem C:\\Users',
      shell: 'powershell',
      timeout_ms: 3000
    }
  });
  assert.equal(outside.isError, true);
  assert.match(text(outside), /Workspace restriction/i);

  const fileOutside = await client.callTool({
    name: 'read_file',
    arguments: { path: 'C:\\Windows\\win.ini' }
  });
  assert(
    fileOutside.isError === true ||
    /denied|not allowed|outside/i.test(text(fileOutside))
  );

  const nodeLocal = await client.callTool({
    name: 'start_process',
    arguments: { command: 'node:local', timeout_ms: 3000 }
  });
  assert.equal(nodeLocal.isError, true);
  assert.match(text(nodeLocal), /node:local is disabled/i);
  console.log('WORKSPACE_SCOPE_TEST_OK', JSON.stringify({
    allowedDirectories: 'C:\\Code',
    cwd: 'C:\\Code',
    processOutsideBlocked: true,
    fileOutsideBlocked: true,
    nodeLocalBlocked: true
  }));
}
finally {
  await client.close().catch(() => {});
}