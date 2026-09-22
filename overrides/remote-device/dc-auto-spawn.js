import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { VERSION } from '../version.js';
import { summarizeToolResult } from './dc-content-summary.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const WORKER_CONNECT_TIMEOUT_MS = 20000;
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const REDIRECT_COALESCE_MS = 1000;
const SCOPED_REDIRECT_REUSE_MS = 30 * 1000;
const MANAGED_CAPABILITY = 'dc_auto_spawn_v1';
const TASK_LABEL_MIN_CHARS = 2;
const TASK_LABEL_MAX_CHARS = 30;
const GENERIC_TASK_LABELS = new Set([
    '任务', '子任务', '继续', '继续修改', '修改', '测试', '调试',
    'task', 'test', 'fix', 'debug', 'continue'
]);

function normalizeTaskLabel(value) {
    return Array.from(String(value || '').replace(/\s+/g, ' ').trim())
        .slice(0, TASK_LABEL_MAX_CHARS)
        .join('');
}

function validateTaskLabel(value) {
    const label = normalizeTaskLabel(value);
    const length = Array.from(label).length;
    if (length < TASK_LABEL_MIN_CHARS)
        return { ok: false, label, reason: `task label must be at least ${TASK_LABEL_MIN_CHARS} characters` };
    if (GENERIC_TASK_LABELS.has(label.toLowerCase()))
        return { ok: false, label, reason: 'task label is too generic; describe the actual work' };
    return { ok: true, label };
}

function safeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function redirectScope(metadata = {}) {
    const roots = [metadata, metadata?.clientInfo, metadata?.client_info].filter(Boolean);
    const fields = [
        'conversationId', 'conversation_id',
        'threadId', 'thread_id',
        'sessionId', 'session_id',
        'chatId', 'chat_id'
    ];
    for (const root of roots) {
        for (const field of fields) {
            const value = root?.[field];
            if (value == null || String(value).trim() === '')
                continue;
            return 'meta:' + crypto.createHash('sha256')
                .update(String(value).trim())
                .digest('hex')
                .slice(0, 24);
        }
    }
    return null;
}

export class DCAutoSpawnManager {
    constructor(remoteChannel, parentDeviceId, desktop, baseServerUrl = 'https://mcp.desktopcommander.app') {
        this.remoteChannel = remoteChannel;
        this.parentDeviceId = parentDeviceId;
        this.desktop = desktop;
        this.baseServerUrl = baseServerUrl;
        this.enabled = process.env.DC_AUTO_SPAWN === 'true';
        this.ttlMs = Math.max(60000, Number(process.env.DC_AUTO_SPAWN_TTL_MS) || DEFAULT_TTL_MS);
        this.agents = new Map();
        this.pendingWorkers = new Map();
        this.redirectAllocations = new Map();
        this.server = null;
        this.port = null;
        this.cleanupTimer = null;
        this.heartbeatTimer = null;
        this.supabaseUrl = null;
        this.supabaseKey = null;
        this.stopping = false;
        this.profileRoot = path.join(os.homedir(), '.desktop-commander-device', 'auto');
    }

    shouldRedirect(toolName, toolArgs = {}) {
        if (!this.enabled || toolName === 'ping' || toolName === 'shutdown')
            return false;
        if (toolName === 'start_process') {
            const command = String(toolArgs?.command || '');
            if (command.startsWith('# DC_GATEWAY_MAINTENANCE'))
                return false;
        }
        return true;
    }

    async start() {
        if (!this.enabled)
            return;
        if (!this.remoteChannel?.client || !this.remoteChannel?.user?.id) {
            throw new Error('Auto-spawn requires an authenticated RemoteChannel');
        }
        await fs.mkdir(this.profileRoot, { recursive: true });
        await this.loadRealtimeConfig();
        await this.cleanupOrphans();
        await this.startServer();
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired().catch((e) => console.error('[auto-spawn] cleanup failed:', e?.message));
        }, CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref?.();
        this.heartbeatTimer = setInterval(() => {
            this.heartbeatAgents().catch((e) => console.error('[auto-spawn] heartbeat failed:', e?.message));
        }, HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref?.();
        console.log(`🧩 Auto-spawn ready on 127.0.0.1:${this.port} (TTL ${Math.round(this.ttlMs / 3600000)}h)`);
    }

    async startServer() {
        this.server = net.createServer((socket) => this.acceptWorker(socket));
        await new Promise((resolve, reject) => {
            const onError = (err) => reject(err);
            this.server.once('error', onError);
            this.server.listen(0, '127.0.0.1', () => {
                this.server.off('error', onError);
                this.port = this.server.address().port;
                resolve();
            });
        });
        this.server.unref?.();
    }

    async allocateRedirect(initialCallId, metadata = {}) {
        const scope = redirectScope(metadata);
        const key = scope || '__concurrent_fallback__';
        const existing = this.redirectAllocations.get(key);
        if (existing && (scope || Date.now() - existing.startedAt <= REDIRECT_COALESCE_MS)) {
            console.log(`♻️ Reusing pending auto-spawn allocation for ${scope ? 'conversation' : 'parallel gateway calls'}`);
            return existing.promise;
        }

        const entry = {
            startedAt: Date.now(),
            promise: this.createRedirect(initialCallId)
        };
        this.redirectAllocations.set(key, entry);
        try {
            const result = await entry.promise;
            if (scope) {
                const timer = setTimeout(() => {
                    if (this.redirectAllocations.get(key) === entry)
                        this.redirectAllocations.delete(key);
                }, SCOPED_REDIRECT_REUSE_MS);
                timer.unref?.();
            }
            else if (this.redirectAllocations.get(key) === entry) {
                this.redirectAllocations.delete(key);
            }
            return result;
        }
        catch (error) {
            if (this.redirectAllocations.get(key) === entry)
                this.redirectAllocations.delete(key);
            throw error;
        }
    }

    async createRedirect(initialCallId) {
        const instanceId = safeId(initialCallId) || crypto.randomUUID().replaceAll('-', '');
        const shortId = instanceId.slice(0, 8);
        const deviceName = `${os.hostname()}-agent-${shortId}`;
        const secret = crypto.randomBytes(24).toString('hex');
        const now = Date.now();
        const agent = {
            instanceId,
            shortId,
            deviceId: null,
            deviceName,
            secret,
            socket: null,
            pid: null,
            realtimeClient: null,
            channel: null,
            accessToken: null,
            taskLabel: null,
            lastActiveAt: now,
            seenCallIds: new Set(),
            activeCalls: new Set(),
            crashed: false,
            destroying: false,
            profileDir: path.join(this.profileRoot, instanceId),
        };
        await fs.mkdir(agent.profileDir, { recursive: true });

        try {
            const row = await this.createDeviceRow(agent);
            agent.deviceId = row.id;
            await fs.writeFile(path.join(agent.profileDir, 'instance.json'), JSON.stringify({
                managed: true,
                instanceId: agent.instanceId,
                deviceId: agent.deviceId,
                deviceName: agent.deviceName,
                parentDeviceId: this.parentDeviceId,
                createdAt: new Date(now).toISOString(),
                ttlMs: this.ttlMs,
                taskLabel: null
            }, null, 2), 'utf8');

            await this.connectAgentPresence(agent);
            this.agents.set(agent.deviceId, agent);
            await this.spawnWorkerAndWait(agent);
            console.log(`🆕 Auto-spawned ${agent.deviceName} (${agent.deviceId})`);

            return {
                content: [{
                    type: 'text',
                    text: [
                        'DC_INSTANCE_ASSIGNED',
                        `deviceId: ${agent.deviceId}`,
                        `deviceName: ${agent.deviceName}`,
                        `gatewayDeviceId: ${this.parentDeviceId}`,
                        '',
                        'MUST_REGISTER_TASK_BEFORE_TOOLS',
                        '# DC_AGENT_META',
                        'TASK=<2-30字明确任务名>',
                        '',
                        'RECOVERY',
                        'Keep this deviceId for this conversation. If it is lost/stale or a DC call says "device not found", call list_devices before saying DC is unavailable. Recover only the child whose dc_auto_spawn_v1.task_label matches this conversation; if none exists, allocate a new child from gatewayDeviceId.'
                    ].join('\n')
                }]
            };
        }
        catch (error) {
            await this.destroyAgent(agent, { deleteRow: !!agent.deviceId, removeFromMap: true }).catch(() => {});
            throw error;
        }
    }

    async createDeviceRow(agent) {
        const client = this.remoteChannel.client;
        const userId = this.remoteChannel.user.id;
        const capabilities = {
            app_version: VERSION,
            [MANAGED_CAPABILITY]: {
                parent_device_id: this.parentDeviceId,
                instance_id: agent.instanceId,
                ttl_ms: this.ttlMs,
                task_label: null
            }
        };
        const { data, error } = await client
            .from('mcp_devices')
            .insert({
                user_id: userId,
                device_name: agent.deviceName,
                capabilities,
                status: 'online',
                last_seen: new Date().toISOString()
            })
            .select()
            .single();
        if (error)
            throw new Error(`Could not create auto-spawn device: ${error.message}`);
        return data;
    }

    async loadRealtimeConfig() {
        const response = await fetch(`${this.baseServerUrl}/api/mcp-info`);
        if (!response.ok)
            throw new Error(`Failed to fetch Supabase config: ${response.statusText}`);
        const config = await response.json();
        this.supabaseUrl = config.supabaseUrl;
        this.supabaseKey = config.supabasePublishableKey;
        if (!this.supabaseUrl || !this.supabaseKey)
            throw new Error('Auto-spawn Supabase config is incomplete');
    }

    async currentAccessToken() {
        const cached = this.remoteChannel?.lastKnownSession?.access_token;
        if (cached)
            return cached;
        const { data, error } = await this.remoteChannel.client.auth.getSession();
        if (error)
            throw error;
        const token = data?.session?.access_token;
        if (!token)
            throw new Error('Auto-spawn could not obtain the parent access token');
        return token;
    }

    async connectAgentPresence(agent) {
        const accessToken = await this.currentAccessToken();
        const realtimeClient = createClient(this.supabaseUrl, this.supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
        await realtimeClient.realtime.setAuth(accessToken);

        const userId = this.remoteChannel.user.id;
        const channel = realtimeClient.channel(`user:${userId}`, {
            config: {
                private: true,
                broadcast: { ack: true },
                presence: { key: agent.deviceId, enabled: true }
            }
        });
        agent.realtimeClient = realtimeClient;
        agent.channel = channel;
        agent.accessToken = accessToken;

        channel.on('broadcast', { event: 'new_call' }, ({ payload }) => {
            if (payload?.device_id !== agent.deviceId || !payload?.call_id)
                return;
            void this.handleDoorbell(agent, payload.call_id).catch((e) => {
                console.error(`[auto-spawn:${agent.shortId}] doorbell failed:`, e?.message);
            });
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Auto-spawn presence subscribe timeout')), 15000);
            channel.subscribe(async (status, err) => {
                if (status === 'SUBSCRIBED') {
                    try {
                        const tracked = await channel.track({
                            device_id: agent.deviceId,
                            device_name: agent.deviceName,
                            app_version: VERSION,
                            platform: process.platform
                        });
                        if (tracked !== 'ok')
                            throw new Error(`presence track returned ${tracked}`);
                        clearTimeout(timer);
                        resolve();
                    }
                    catch (e) {
                        clearTimeout(timer);
                        reject(e);
                    }
                }
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    clearTimeout(timer);
                    reject(err || new Error(`Auto-spawn channel ${status}`));
                }
            });
        });

        const marker = {
            parent_device_id: this.parentDeviceId,
            instance_id: agent.instanceId,
            ttl_ms: this.ttlMs,
            task_label: agent.taskLabel || null
        };
        const { error } = await this.remoteChannel.client
            .from('mcp_devices')
            .update({
                capabilities: {
                    app_version: VERSION,
                    transport_broadcast_v1: true,
                    [MANAGED_CAPABILITY]: marker
                },
                status: 'online',
                last_seen: new Date().toISOString()
            })
            .eq('id', agent.deviceId);
        if (error)
            throw new Error(`Could not enable auto-spawn transport: ${error.message}`);
    }

    async syncAgentToken(agent) {
        const token = await this.currentAccessToken();
        if (!token || token === agent.accessToken || !agent.realtimeClient)
            return;
        await agent.realtimeClient.realtime.setAuth(token);
        agent.accessToken = token;
    }

    async handleDoorbell(agent, callId) {
        if (!callId || this.stopping || agent.destroying)
            return;
        const client = this.remoteChannel.client;
        let row = null;
        let lastError = null;
        for (const delayMs of [0, 500, 1500]) {
            if (delayMs)
                await sleep(delayMs);
            const { data, error } = await client
                .from('mcp_remote_calls')
                .select('*')
                .eq('id', callId)
                .maybeSingle();
            if (!error) {
                row = data;
                lastError = null;
                break;
            }
            lastError = error;
        }
        if (lastError)
            throw lastError;
        if (!row || row.device_id !== agent.deviceId || row.status !== 'pending')
            return;
        await this.handlePendingRow(agent, row);
    }

    async notifyAgentResult(agent, callId) {
        try {
            const status = await agent.channel?.send({
                type: 'broadcast',
                event: 'result',
                payload: { call_id: callId }
            });
            if (status === 'ok')
                return;
        }
        catch {}
        await this.remoteChannel.notifyResult(callId);
    }

    extractAgentTask(row) {
        if (row?.tool_name !== 'start_process')
            return null;
        const command = String(row?.tool_args?.command || '').replace(/\r\n/g, '\n').trim();
        const lines = command.split('\n').map((line) => line.trim());
        if (lines[0] !== '# DC_AGENT_META')
            return null;
        const taskLine = lines.find((line) => line.startsWith('TASK='));
        if (!taskLine)
            return '';
        return normalizeTaskLabel(taskLine.slice(5));
    }

    async setAgentTask(agent, taskLabel) {
        const profilePath = path.join(agent.profileDir, 'instance.json');
        let profile = {};
        try {
            profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
        }
        catch {}
        profile.taskLabel = taskLabel;
        await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');

        const marker = {
            parent_device_id: this.parentDeviceId,
            instance_id: agent.instanceId,
            ttl_ms: this.ttlMs,
            task_label: taskLabel
        };
        const { error } = await this.remoteChannel.client
            .from('mcp_devices')
            .update({
                capabilities: {
                    app_version: VERSION,
                    transport_broadcast_v1: true,
                    [MANAGED_CAPABILITY]: marker
                },
                last_seen: new Date().toISOString()
            })
            .eq('id', agent.deviceId);
        if (error)
            throw new Error(`Could not persist auto-spawn task label: ${error.message}`);

        agent.taskLabel = taskLabel;
        this.writeJson(agent.socket, { type: 'meta', taskLabel });
    }

    async handlePendingRow(agent, row) {
        const callId = row?.id;
        if (!callId || this.stopping || agent.destroying)
            return;
        if (agent.seenCallIds.has(callId))
            return;
        agent.seenCallIds.add(callId);
        if (agent.seenCallIds.size > 200) {
            const oldest = agent.seenCallIds.values().next().value;
            if (oldest)
                agent.seenCallIds.delete(oldest);
        }
        const claimed = await this.remoteChannel.markCallExecuting(callId);
        if (!claimed)
            return;
        agent.lastActiveAt = Date.now();
        agent.activeCalls.add(callId);
        let destroyAfterReply = false;
        let isAgentMeta = false;
        try {
            if (!agent.socket || agent.socket.destroyed)
                throw new Error(`Worker ${agent.deviceName} is not connected`);

            const taskLabel = this.extractAgentTask(row);
            isAgentMeta = taskLabel !== null;

            let result;
            if (isAgentMeta) {
                const validation = validateTaskLabel(taskLabel);
                if (!validation.ok)
                    throw new Error(`DC_AGENT_META invalid TASK: ${validation.reason}`);
                const normalizedTask = validation.label;
                if (agent.taskLabel && agent.taskLabel !== normalizedTask) {
                    throw new Error(`DC_AGENT_META task is locked as "${agent.taskLabel}"; create a new child Agent for a different task`);
                }
                if (!agent.taskLabel)
                    await this.setAgentTask(agent, normalizedTask);
                result = {
                    content: [{
                        type: 'text',
                        text: [
                            'DC_AGENT_META_OK',
                            `TASK=${normalizedTask}`,
                            `RECOVERY: If this device is lost/stale, call list_devices and find dc_auto_spawn_v1.task_label="${normalizedTask}" before saying DC is unavailable; if no match, allocate a new child from gatewayDeviceId=${this.parentDeviceId}.`
                        ].join('\n')
                    }]
                };
            }
            else if (!agent.taskLabel && row.tool_name !== 'ping' && row.tool_name !== 'shutdown') {
                result = {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: [
                            'DC_TASK_LABEL_REQUIRED',
                            'This child Agent has no task name. Register the task before using any normal DC tool.',
                            '# DC_AGENT_META',
                            'TASK=<2-30字明确任务名>',
                            'After DC_AGENT_META_OK, retry the blocked tool call.'
                        ].join('\n')
                    }]
                };
            }
            else {
                this.writeJson(agent.socket, {
                    type: 'call',
                    callId: row.id,
                    toolName: row.tool_name,
                    toolArgs: row.tool_args
                });

                if (row.tool_name === 'ping') {
                    result = {
                        content: [{ type: 'text', text: `pong ${new Date().toISOString()}` }]
                    };
                }
                else if (row.tool_name === 'shutdown') {
                    result = {
                        content: [{ type: 'text', text: `Auto-spawn instance shutdown initialized at ${new Date().toISOString()}` }]
                    };
                    destroyAfterReply = true;
                }
                else {
                    const metadata = {
                        ...(row.metadata || {}),
                        dcAgentDeviceId: agent.deviceId,
                        dcAgentInstanceId: agent.instanceId,
                        dcAgentName: agent.deviceName,
                        dcAgentTaskLabel: agent.taskLabel || null
                    };
                    result = await this.desktop.callClientTool(row.tool_name, row.tool_args, metadata);
                }
            }

            const meter = result?._meta?.dcTokenMeter || {};
            if (!isAgentMeta) {
                this.writeJson(agent.socket, {
                    type: 'result',
                    callId,
                    ok: !result?.isError,
                    summary: summarizeToolResult(result),
                    error: result?.isError ? summarizeToolResult(result) : undefined,
                    inputTokens: Number(meter.callInputTokens) || 0,
                    outputTokens: Number(meter.callOutputTokens) || 0
                });
            }

            await this.remoteChannel.updateCallResult(callId, 'completed', result);
            await this.notifyAgentResult(agent, callId);
        }
        catch (error) {
            if (!isAgentMeta && agent.socket && !agent.socket.destroyed) {
                this.writeJson(agent.socket, {
                    type: 'result',
                    callId,
                    ok: false,
                    error: error?.message || String(error)
                });
            }
            await this.remoteChannel.updateCallResult(callId, 'failed', null, error?.message || String(error));
            await this.notifyAgentResult(agent, callId);
        }
        finally {
            agent.activeCalls.delete(callId);
            agent.lastActiveAt = Date.now();
            if (destroyAfterReply || (agent.crashed && agent.activeCalls.size === 0)) {
                setTimeout(() => {
                    this.destroyAgent(agent, { deleteRow: true, removeFromMap: true })
                        .catch((e) => console.error(`[auto-spawn:${agent.shortId}] cleanup failed:`, e?.message));
                }, 100);
            }
        }
    }

    acceptWorker(socket) {
        socket.setNoDelay(true);
        let buffer = '';
        let boundAgent = null;
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            while (true) {
                const idx = buffer.indexOf('\n');
                if (idx < 0)
                    break;
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (!line.trim())
                    continue;
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    socket.destroy();
                    return;
                }
                if (!boundAgent) {
                    if (message.type !== 'hello' || !message.secret) {
                        socket.destroy();
                        return;
                    }
                    const pending = this.pendingWorkers.get(message.secret);
                    if (!pending) {
                        socket.destroy();
                        return;
                    }
                    boundAgent = pending.agent;
                    boundAgent.socket = socket;
                    boundAgent.pid = Number(message.pid) || null;
                    this.pendingWorkers.delete(message.secret);
                    pending.resolve();
                    continue;
                }
            }
        });
        socket.on('close', () => {
            if (!boundAgent)
                return;
            if (boundAgent.socket === socket)
                boundAgent.socket = null;
            boundAgent.crashed = true;
            if (!this.stopping && !boundAgent.destroying && boundAgent.activeCalls.size === 0) {
                this.destroyAgent(boundAgent, { deleteRow: true, removeFromMap: true })
                    .catch((e) => console.error(`[auto-spawn:${boundAgent.shortId}] crash cleanup failed:`, e?.message));
            }
        });
        socket.on('error', () => {});
    }

    async spawnWorkerAndWait(agent) {
        const workerPath = fileURLToPath(new URL('./dc-auto-spawn-worker.js', import.meta.url));
        const workerLogPath = path.join(agent.profileDir, 'worker-startup.log');
        agent.workerLogPath = workerLogPath;
        const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(async () => {
                this.pendingWorkers.delete(agent.secret);
                let detail = '';
                try {
                    const log = await fs.readFile(workerLogPath, 'utf8');
                    detail = log.trim().slice(-4000);
                }
                catch {}
                reject(new Error(
                    `Worker ${agent.deviceName} did not connect in time` +
                    (detail ? `\nWorker startup log:\n${detail}` : '')
                ));
            }, WORKER_CONNECT_TIMEOUT_MS);
            this.pendingWorkers.set(agent.secret, {
                agent,
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject
            });
        });

        const args = [
            workerPath,
            '--port', String(this.port),
            '--secret', agent.secret,
            '--instance', agent.instanceId,
            '--device', agent.deviceId,
            '--name', agent.deviceName
        ];

        if (process.platform === 'win32') {
            const psq = (v) => `'${String(v).replaceAll("'", "''")}'`;
            const argLine = args.map((v) => `"${String(v).replaceAll('"', '\\"')}"`).join(' ');
            const command = `Start-Process -FilePath ${psq(process.execPath)} -ArgumentList ${psq(argLine)} -WindowStyle Normal`;
            const logHandle = await fs.open(workerLogPath, 'a');
            const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
                windowsHide: true,
                detached: false,
                stdio: ['ignore', logHandle.fd, logHandle.fd]
            });
            child.on('error', (error) => {
                fs.appendFile(workerLogPath, `[gateway] launcher error: ${error.message}\r\n`, 'utf8').catch(() => {});
            });
            child.on('exit', (code, signal) => {
                fs.appendFile(workerLogPath, `[gateway] launcher exit code=${code} signal=${signal || ''}\r\n`, 'utf8').catch(() => {});
                logHandle.close().catch(() => {});
            });
        }
        else {
            const child = spawn(process.execPath, args, {
                detached: true,
                stdio: 'inherit'
            });
            child.unref();
        }
        await ready;
    }

    writeJson(socket, value) {
        if (!socket || socket.destroyed)
            return false;
        try {
            socket.write(`${JSON.stringify(value)}\n`);
            return true;
        }
        catch {
            return false;
        }
    }

    async heartbeatAgents() {
        if (this.stopping || this.agents.size === 0)
            return;
        const client = this.remoteChannel.client;
        const nowIso = new Date().toISOString();
        await Promise.allSettled([...this.agents.values()].map(async (agent) => {
            if (agent.destroying)
                return;
            await this.syncAgentToken(agent);
            await client
                .from('mcp_devices')
                .update({ last_seen: nowIso, status: 'online' })
                .eq('id', agent.deviceId);
        }));
    }

    async cleanupExpired() {
        const now = Date.now();
        for (const agent of [...this.agents.values()]) {
            if (now - agent.lastActiveAt >= this.ttlMs && agent.activeCalls.size === 0) {
                console.log(`🧹 Auto-spawn TTL expired: ${agent.deviceName}`);
                await this.destroyAgent(agent, { deleteRow: true, removeFromMap: true });
            }
        }
    }

    async cleanupOrphans() {
        const client = this.remoteChannel.client;
        const userId = this.remoteChannel.user.id;
        const { data, error } = await client
            .from('mcp_devices')
            .select('id, device_name, capabilities')
            .eq('user_id', userId);
        if (!error && Array.isArray(data)) {
            for (const row of data) {
                const marker = row?.capabilities?.[MANAGED_CAPABILITY];
                if (marker?.parent_device_id === this.parentDeviceId) {
                    await client.from('mcp_devices').delete().eq('id', row.id).eq('user_id', userId);
                }
            }
        }
        await fs.rm(this.profileRoot, { recursive: true, force: true });
        await fs.mkdir(this.profileRoot, { recursive: true });
    }

    async destroyAgent(agent, options = {}) {
        const deleteRow = options.deleteRow !== false;
        if (!agent || agent.destroying)
            return;
        agent.destroying = true;
        if (options.removeFromMap !== false && agent.deviceId)
            this.agents.delete(agent.deviceId);

        const pending = this.pendingWorkers.get(agent.secret);
        if (pending) {
            this.pendingWorkers.delete(agent.secret);
            pending.reject(new Error('Worker allocation cancelled'));
        }

        if (agent.socket && !agent.socket.destroyed) {
            try {
                this.writeJson(agent.socket, { type: 'shutdown' });
            }
            catch {}
        }
        await sleep(150);
        if (agent.socket && !agent.socket.destroyed)
            agent.socket.destroy();

        if (agent.channel) {
            try {
                await Promise.race([agent.channel.untrack(), sleep(300)]);
            }
            catch {}
            try {
                await Promise.race([agent.channel.unsubscribe(), sleep(300)]);
            }
            catch {}
            agent.channel = null;
        }
        try {
            agent.realtimeClient?.realtime?.disconnect?.();
        }
        catch {}
        agent.realtimeClient = null;
        agent.accessToken = null;

        if (deleteRow && agent.deviceId && this.remoteChannel?.client && this.remoteChannel?.user?.id) {
            const userId = this.remoteChannel.user.id;
            const { error } = await this.remoteChannel.client
                .from('mcp_devices')
                .delete()
                .eq('id', agent.deviceId)
                .eq('user_id', userId);
            if (error) {
                console.warn(`[auto-spawn] could not delete ${agent.deviceName}: ${error.message}`);
                await this.remoteChannel.client
                    .from('mcp_devices')
                    .update({ status: 'offline' })
                    .eq('id', agent.deviceId);
            }
        }

        if (agent.profileDir)
            await fs.rm(agent.profileDir, { recursive: true, force: true }).catch(() => {});
    }

    async shutdown() {
        if (!this.enabled || this.stopping)
            return;
        this.stopping = true;
        if (this.cleanupTimer)
            clearInterval(this.cleanupTimer);
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        for (const agent of [...this.agents.values()])
            await this.destroyAgent(agent, { deleteRow: true, removeFromMap: true });
        if (this.server) {
            await new Promise((resolve) => this.server.close(() => resolve())).catch(() => {});
            this.server = null;
        }
    }
}
