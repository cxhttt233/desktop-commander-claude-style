// Anlan local MCP broker: main DC + explicitly named, isolated DC child processes.
// Used by OpenAI Tunnel as a single stdio MCP endpoint. No Remote DC account is needed.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { guiTools, executeGuiTool } from './anlan-gui-winapp.mjs';

// One broker implementation for both Windows and Linux. Resolve the platform-specific
// Desktop Commander installation in the launcher, not in a forked broker file.
const packageRoot = process.env.ANLAN_DC_PACKAGE_ROOT || path.join(process.env.LOCALAPPDATA || '', 'DesktopCommander', 'node_modules', '@wonderwhy-er', 'desktop-commander');
const req = createRequire(path.join(packageRoot, 'package.json'));
const sdk = async (name) => import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/' + name)).href);
const [{ Server }, { StdioServerTransport }, { Client }, { StdioClientTransport }, types] = await Promise.all([
  sdk('server/index.js'), sdk('server/stdio.js'), sdk('client/index.js'), sdk('client/stdio.js'), sdk('types.js')
]);
const { ListToolsRequestSchema, CallToolRequestSchema } = types;
const entry = path.join(packageRoot, 'dist', 'index.js');
const log = (message) => process.stderr.write('[Anlan broker] ' + message + '\n');
const MAX_AGENTS = Math.max(1, Math.min(12, Number(process.env.ANLAN_MAX_AGENTS || 6)));
const IDLE_MS = Math.max(60_000, Number(process.env.ANLAN_AGENT_IDLE_MS || 24 * 60 * 60 * 1000));
const DISCOVERY_MODE = process.env.ANLAN_DISCOVERY_MODE === 'minimal' ? 'minimal' : 'full';
// Windows runs a separate 17891 stats process; Linux hosts stats in the main DC.
const MAIN_STATS_SERVER = process.env.ANLAN_DC_MAIN_STATS_SERVER === 'true';
const agents = new Map();
let main;
let toolSchemas = [];

const result = (body, isError = false) => ({
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
  ...(isError ? { isError: true } : {})
});

async function newDcClient({ agentId = null, taskLabel = null } = {}) {
  const client = new Client({ name: 'anlan-dc-broker', version: '1.0.0' }, { capabilities: {} });
  const env = { ...process.env, DC_STATS_SERVER: !agentId && MAIN_STATS_SERVER ? 'true' : 'false', DC_AUTO_SPAWN: 'false' };
  // The Tunnel's control-plane credential must never be propagated to DC shell subprocesses.
  for (const key of ['CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID', 'OPENAI_API_KEY']) delete env[key];
  if (process.env.DC_WORKSPACE_ROOT) env.DC_WORKSPACE_ROOT = process.env.DC_WORKSPACE_ROOT;
  if (agentId) {
    env.ANLAN_AGENT_ID = agentId;
    env.DC_AGENT_TASK_LABEL = taskLabel;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env,
    stderr: 'inherit'
  });
  await client.connect(transport);
  return { client, transport };
}

function requireAgent(id) {
  const agent = agents.get(id);
  if (!agent) throw new Error('Unknown agent_id; call agent_list or agent_create');
  return agent;
}
const helperTools = [
  {
    name: 'agent_create',
    description: 'Create a dedicated Desktop Commander subprocess for a named task. Returns an agent_id. Call agent_call with that ID for isolated tasks. No automatic conversation identity is assumed.',
    inputSchema: { type: 'object', properties: { task_label: { type: 'string', minLength: 4, maxLength: 64, description: 'Concise Chinese task name' } }, required: ['task_label'] }
  },
  {
    name: 'agent_call',
    description: 'Run one existing Desktop Commander tool on a previously created isolated child, using agent_id. Child has separate terminal sessions and task-attributed traffic records.',
    inputSchema: { type: 'object', properties: {
      agent_id: { type: 'string' },
      tool: { type: 'string', description: 'An existing Desktop Commander tool name, such as list_directory, read_file, start_process' },
      args: { type: 'object', additionalProperties: true }
    }, required: ['agent_id', 'tool'] }
  },
  {
    name: 'agent_list',
    description: 'List local child agent IDs, task names, usage and active tool calls.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'agent_close',
    description: 'Close an idle named DC child process; does not stop the Tunnel or main DC.',
    inputSchema: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] }
  }
];

async function closeAgent(id) {
  const agent = requireAgent(id);
  if (agent.active > 0) throw new Error('Agent has running calls; cannot close yet');
  agents.delete(id);
  await agent.client.close();
}

async function executeHelper(name, args) {
  if (name === 'agent_create') {
    const label = String(args.task_label || '').trim().replace(/\s+/g, ' ');
    if (label.length < 4 || label.length > 64) throw new Error('task_label must have 4–64 characters');
    for (const agent of agents.values()) {
      if (agent.taskLabel === label) return result({ agent_id: agent.id, task_label: label, reused: true });
    }
    if (agents.size >= MAX_AGENTS) throw new Error('Max local agents reached: ' + MAX_AGENTS);
    const id = 'agent-' + randomUUID().slice(0, 12);
    const child = await newDcClient({ agentId: id, taskLabel: label });
    agents.set(id, {
      id, taskLabel: label, ...child, createdAt: Date.now(), lastActiveAt: Date.now(),
      active: 0, completed: 0
    });
    log('created ' + id + ' task=' + label);
    return result({ agent_id: id, task_label: label, created: true });
  }
  if (name === 'agent_list') {
    return result({ agents: [...agents.values()].map(x => ({
      agent_id: x.id, task_label: x.taskLabel, active_calls: x.active,
      completed_calls: x.completed, created_at: new Date(x.createdAt).toISOString(),
      last_active_at: new Date(x.lastActiveAt).toISOString()
    })) });
  }
  if (name === 'agent_close') {
    await closeAgent(String(args.agent_id || ''));
    return result({ closed: true, agent_id: args.agent_id });
  }
  if (name === 'agent_call') {
    const agent = requireAgent(String(args.agent_id || ''));
    const tool = String(args.tool || '');
    if (!toolSchemas.some(x => x.name === tool)) throw new Error('Unknown DC tool: ' + tool);
    agent.active++;
    agent.lastActiveAt = Date.now();
    try {
      // Child DC's existing stats recorder reads MCP call _meta to attribute task/agent.
      return await agent.client.callTool({
        name: tool,
        arguments: args.args || {},
        _meta: { dcAgentInstanceId: agent.id, dcAgentTaskLabel: agent.taskLabel, dcAgentName: 'Tunnel sub-agent' }
      });
    } finally {
      agent.active--;
      agent.completed++;
      agent.lastActiveAt = Date.now();
    }
  }
  throw new Error('Unsupported helper tool');
}

log('starting main DC subprocess');
main = await newDcClient();
const initialList = await main.client.listTools();
toolSchemas = initialList.tools;
log('main DC ready; tools=' + toolSchemas.length);
const server = new Server({ name: 'anlan-local-dc', version: '1.0.0' }, { capabilities: { tools: {} } });
const enabledGuiTools = process.platform === 'win32' && process.env.ANLAN_GUI_ENABLED !== 'false' ? guiTools : [];
const allTools = [...toolSchemas, ...helperTools, ...enabledGuiTools];
const exposedTools = DISCOVERY_MODE === 'minimal'
  ? allTools.filter(tool => tool.name === 'get_config' || tool.name === 'agent_list')
  : allTools;
if (DISCOVERY_MODE === 'minimal' && exposedTools.length !== 2)
  throw new Error('Minimal discovery requires exactly get_config and agent_list');
log('discovery mode=' + DISCOVERY_MODE + '; exposed tools=' + exposedTools.length);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    if (!exposedTools.some(tool => tool.name === name))
      return result('Tool unavailable in ' + DISCOVERY_MODE + ' discovery mode: ' + name, true);
    if (enabledGuiTools.some(x => x.name === name)) return await executeGuiTool(name, args);
    if (helperTools.some(x => x.name === name)) return await executeHelper(name, args);
    if (!toolSchemas.some(x => x.name === name)) return result('Unknown tool: ' + name, true);
    return await main.client.callTool({ name, arguments: args, ...(request.params._meta ? { _meta: request.params._meta } : {}) });
  } catch (err) {
    log('call failed ' + name + ': ' + String(err?.message || err));
    return result(String(err?.message || err), true);
  }
});
const janitor = setInterval(() => {
  for (const [id, agent] of agents) {
    if (agent.active === 0 && Date.now() - agent.lastActiveAt >= IDLE_MS)
      closeAgent(id).catch(e => log('cleanup error: ' + e.message));
  }
}, 60_000);
janitor.unref();
const stop = async () => {
  clearInterval(janitor);
  for (const id of [...agents.keys()]) {
    try { await closeAgent(id); } catch (e) { log(e.message); }
  }
  try { await main.client.close(); } catch {}
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await server.connect(new StdioServerTransport());
log('broker online');
