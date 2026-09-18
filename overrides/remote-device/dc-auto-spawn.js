import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { VERSION } from '../version.js';
import { summarizeToolResult } from './dc-content-summary.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const WORKER_CONNECT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const MANAGED_CAPABILITY = 'dc_auto_spawn_v1';

function safeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DCAutoSpawnManager {
    constructor(remoteChannel, parentDeviceId, desktop) {
        this.remoteChannel = remoteChannel;
        this.parentDeviceId = parentDeviceId;
        this.desktop = desktop;
        this.enabled = process.env.DC_AUTO_SPAWN === 'true';
        this.ttlMs = Math.max(60000, Number(process.env.DC_AUTO_SPAWN_TTL_MS) || DEFAULT_TTL_MS);
        this.agents = new Map();
        this.pendingWorkers = new Map();
        this.server = null;
        this.port = null;
        this.cleanupTimer = null;
        this.heartbeatTimer = null;
        this.pollTimer = null;
        this.pollInFlight = false;
        this.stopping = false;
        this.profileRoot = path.join(os.homedir(), '.desktop-commander-device', 'auto');
    }

    shouldRedirect(toolName) {
        return this.enabled && toolName !== 'ping' && toolName !== 'shutdown';
    }

    async start() {
        if (!this.enabled)
            return;
        if (!this.remoteChannel?.client || !this.remoteChannel?.user?.id) {
            throw new Error('Auto-spawn requires an authenticated RemoteChannel');
        }
        await fs.mkdir(this.profileRoot, { recursive: true });
        await this.cleanupOrphans();
        await this.startServer();
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired().catch((e) => console.error('[auto-spawn] cleanup failed:', e?.message));
        }, CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref?.();
        this.pollTimer = setInterval(() => {
            this.pollPendingCalls().catch((e) => console.error('[auto-spawn] poll failed:', e?.message));
        }, POLL_INTERVAL_MS);
        this.pollTimer.unref?.();
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

    async allocateRedirect(initialCallId) {
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
                ttlMs: this.ttlMs
            }, null, 2), 'utf8');

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
                        `instanceId: ${agent.instanceId}`,
                        '',
                        'Retry the same Desktop Commander tool call on this deviceId.',
                        'Use this deviceId for all subsequent Desktop Commander calls in this conversation.',
                        'This temporary instance is automatically deleted after 24 hours without a tool call.'
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
                ttl_ms: this.ttlMs
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

    async pollPendingCalls() {
        if (this.stopping || this.pollInFlight || this.agents.size === 0)
            return;
        this.pollInFlight = true;
        try {
            const deviceIds = [...this.agents.keys()];
            const client = this.remoteChannel.client;
            const { data, error } = await client
                .from('mcp_remote_calls')
                .select('*')
                .in('device_id', deviceIds)
                .eq('status', 'pending')
                .limit(100);
            if (error)
                throw error;
            for (const row of data || []) {
                const agent = this.agents.get(row?.device_id);
                if (!agent || agent.destroying || agent.seenCallIds.has(row?.id))
                    continue;
                void this.handlePendingRow(agent, row).catch((e) => {
                    console.error(`[auto-spawn:${agent.shortId}] call ${row?.id} failed:`, e?.message);
                });
            }
        }
        finally {
            this.pollInFlight = false;
        }
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
        try {
            if (!agent.socket || agent.socket.destroyed)
                throw new Error(`Worker ${agent.deviceName} is not connected`);

            this.writeJson(agent.socket, {
                type: 'call',
                callId: row.id,
                toolName: row.tool_name,
                toolArgs: row.tool_args
            });

            let result;
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
                result = await this.desktop.callClientTool(row.tool_name, row.tool_args, row.metadata || {});
            }

            const outputBytes = Buffer.byteLength(JSON.stringify(result?.content ?? result ?? ''), 'utf8');
            this.writeJson(agent.socket, {
                type: 'result',
                callId,
                ok: true,
                summary: summarizeToolResult(result),
                outputBytes
            });

            await this.remoteChannel.updateCallResult(callId, 'completed', result);
            await this.remoteChannel.notifyResult(callId);
        }
        catch (error) {
            if (agent.socket && !agent.socket.destroyed) {
                this.writeJson(agent.socket, {
                    type: 'result',
                    callId,
                    ok: false,
                    error: error?.message || String(error)
                });
            }
            await this.remoteChannel.updateCallResult(callId, 'failed', null, error?.message || String(error));
            await this.remoteChannel.notifyResult(callId);
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
        const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingWorkers.delete(agent.secret);
                reject(new Error(`Worker ${agent.deviceName} did not connect in time`));
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
            const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
                windowsHide: true,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
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
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        for (const agent of [...this.agents.values()])
            await this.destroyAgent(agent, { deleteRow: true, removeFromMap: true });
        if (this.server) {
            await new Promise((resolve) => this.server.close(() => resolve())).catch(() => {});
            this.server = null;
        }
    }
}
