import net from 'net';
import { spawn } from 'child_process';
import path from 'path';

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('package root required');
const worker = path.join(packageRoot, 'dist', 'remote-device', 'dc-auto-spawn-worker.js');
const secret = 'r17-ipc-test-secret';
const holdMs = Number(process.env.WORKER_TEST_HOLD_MS) || 300;
let done = false;
let buffer = '';

const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        while (buffer.includes('\n')) {
            const i = buffer.indexOf('\n');
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.type === 'hello') {
                if (msg.secret !== secret) throw new Error('bad worker secret');
                console.log('WORKER_HELLO', msg.pid);
                socket.write(JSON.stringify({
                    type: 'call',
                    callId: 'ipc-test-call',
                    toolName: 'ping',
                    toolArgs: {}
                }) + '\n');
                setTimeout(() => {
                    socket.write(JSON.stringify({
                        type: 'result',
                        callId: 'ipc-test-call',
                        ok: true,
                        summary: 'pong test',
                        outputBytes: 9
                    }) + '\n');
                    console.log('WORKER_RESULT_PUSHED');
                    done = true;
                    setTimeout(() => {
                        socket.write(JSON.stringify({ type: 'shutdown' }) + '\n');
                        setTimeout(() => server.close(() => process.exit(0)), 300);
                    }, holdMs);
                }, 300);
            }
        }
    });
});

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const args = [
        worker,
        '--port', String(port),
        '--secret', secret,
        '--instance', 'ipc-test-instance',
        '--device', 'ipc-test-device',
        '--name', 'Linkuriboh-agent-ipctest'
    ];

    if (process.platform === 'win32') {
        const psq = (v) => `'${String(v).replaceAll("'", "''")}'`;
        const argLine = args.map((v) => `"${String(v).replaceAll('"', '\\"')}"`).join(' ');
        const command = `Start-Process -FilePath ${psq(process.execPath)} -ArgumentList ${psq(argLine)} -WindowStyle Normal`;
        const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
            windowsHide: true,
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data', (d) => process.stdout.write('PS_OUT ' + d));
        child.stderr.on('data', (d) => process.stderr.write('PS_ERR ' + d));
        child.on('exit', (code) => console.log('PS_EXIT', code));
    }
    else {
        const child = spawn(process.execPath, args, { detached: true, stdio: 'inherit' });
        child.unref();
    }
});

setTimeout(() => {
    if (!done) {
        console.error('WORKER_IPC_TIMEOUT');
        process.exit(1);
    }
}, 20000).unref();