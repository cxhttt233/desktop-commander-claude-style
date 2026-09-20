import net from 'net';
import process from 'process';
import { spawnSync } from 'child_process';
import { dcTerminalStatus } from './dc-terminal-status.js';

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
}

const port = Number(arg('--port'));
const secret = arg('--secret');
const instanceId = arg('--instance');
const deviceId = arg('--device');
const deviceName = arg('--name');

if (!port || !secret || !instanceId || !deviceId || !deviceName) {
    console.error('Invalid auto-spawn worker arguments');
    process.exit(2);
}

function disableWindowsQuickEdit() {
    if (process.platform !== 'win32' || !process.stdin.isTTY)
        return;
    const script = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class DCConsoleMode {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
}
'@
Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue | Out-Null
$handle = [DCConsoleMode]::GetStdHandle(-10)
[uint32]$mode = 0
if ([DCConsoleMode]::GetConsoleMode($handle, [ref]$mode)) {
    [uint32]$next = ($mode -bor 0x80) -band 0xFFFFFFBF
    [void][DCConsoleMode]::SetConsoleMode($handle, $next)
}
`;
    try {
        spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            stdio: ['inherit', 'ignore', 'ignore']
        });
    }
    catch {}
}

disableWindowsQuickEdit();
process.stdout.write(`\x1b]0;Desktop Commander · ${deviceName}\x07`);
console.log('🚀 Desktop Commander Remote Worker');
console.log(`   - Device ID:    ${deviceId}`);
console.log(`   - Device Name:  ${deviceName}`);
console.log(`   - Instance ID:  ${instanceId}`);
console.log('   - Remote auth:  parent gateway');

let stopping = false;
let socket = null;
let buffer = '';
let localOutputBytes = 0;
const callNames = new Map();

async function shutdown(exitCode = 0) {
    if (stopping)
        return;
    stopping = true;
    console.log('\n🛑 Shutting down worker...');
    try {
        socket?.end();
    }
    catch {}
    setTimeout(() => process.exit(exitCode), 50);
}

function writeJson(value) {
    if (!socket || socket.destroyed)
        return;
    socket.write(`${JSON.stringify(value)}\n`);
}

function handleCall(message) {
    const { callId, toolName, toolArgs = {} } = message;
    callNames.set(callId, toolName);
    console.log(`🔧 Received tool call ${callId}: ${toolName}`);
    dcTerminalStatus.beginCall(toolArgs);
}

function handleResult(message) {
    const toolName = callNames.get(message.callId) || 'tool';
    callNames.delete(message.callId);
    if (message.ok) {
        localOutputBytes += Number(message.outputBytes) || 0;
        console.log(`✅ Tool call ${toolName} completed:\r\n ${message.summary || ''}`);
        dcTerminalStatus.finishCall({ sessionOutputBytes: localOutputBytes });
    }
    else {
        dcTerminalStatus.finishCall();
        console.error(`❌ Tool call ${toolName} failed:`, message.error || 'unknown error');
    }
}

async function main() {
    dcTerminalStatus.activate();

    socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.setNoDelay(true);
        writeJson({
            type: 'hello',
            secret,
            instanceId,
            deviceId,
            pid: process.pid
        });
        console.log('✅ Worker ready');
    });

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
                continue;
            }
            if (message.type === 'call')
                handleCall(message);
            else if (message.type === 'result')
                handleResult(message);
            else if (message.type === 'shutdown')
                void shutdown(0);
        }
    });

    socket.on('close', () => {
        if (!stopping) {
            console.log('⚠️ Parent gateway disconnected; worker will exit.');
            void shutdown(0);
        }
    });
    socket.on('error', (error) => {
        if (!stopping)
            console.error('❌ Gateway connection error:', error.message);
    });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

main().catch((error) => {
    console.error('❌ Worker startup failed:', error?.stack || error);
    void shutdown(1);
});
