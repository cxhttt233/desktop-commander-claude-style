from pathlib import Path
import argparse, json

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old, new, 1)

parser = argparse.ArgumentParser()
parser.add_argument('package_root')
args = parser.parse_args()
root = Path(args.package_root)
pkg = json.loads((root / 'package.json').read_text(encoding='utf-8'))
if pkg.get('version') != '0.2.50':
    raise SystemExit(f"Expected Desktop Commander 0.2.50, got {pkg.get('version')}")

server_path = root / 'dist/server.js'
device_path = root / 'dist/remote-device/device.js'
server = server_path.read_text(encoding='utf-8')
device = device_path.read_text(encoding='utf-8')

marker = '// dc-token-odometer-v0.2.50-fixed-r9-multimodal'
if marker not in server:
    anchor = "import * as handlers from './handlers/index.js';\n"
    meter = r'''import { measureArgs, measureResult } from './dc-traffic-meter.js';
// dc-token-odometer-v0.2.50-fixed-r9-multimodal
const dcProcessTokenMeter = {
    inputTokens: 0, outputTokens: 0, calls: 0,
    inputBytes: 0, outputBytes: 0,
    sessionInputTokens: 0, sessionOutputTokens: 0, sessionCalls: 0,
    sessionInputBytes: 0, sessionOutputBytes: 0,
    imageInCount: 0, imageInBytes: 0, imageOutCount: 0, imageOutBytes: 0,
    audioInCount: 0, audioInBytes: 0, audioOutCount: 0, audioOutBytes: 0,
    blobInCount: 0, blobInBytes: 0, blobOutCount: 0, blobOutBytes: 0,
    binaryInCount: 0, binaryInBytes: 0, binaryOutCount: 0, binaryOutBytes: 0,
    linkInCount: 0, linkOutCount: 0,
    sessionStarted: Date.now(), lastActivity: Date.now(), approximate: true
};
function dcAddMetrics(direction, metrics) {
    const suffix = direction === 'in' ? 'In' : 'Out';
    for (const kind of ['image','audio','blob','binary']) {
        const countField = kind + suffix + 'Count';
        const bytesField = kind + suffix + 'Bytes';
        dcProcessTokenMeter[countField] += metrics[kind + 'Count'] || 0;
        dcProcessTokenMeter[bytesField] += metrics[kind + 'Bytes'] || 0;
    }
    dcProcessTokenMeter['link' + suffix + 'Count'] += metrics.linkCount || 0;
}
async function dcRecordTokenTraffic(args, result) {
    const input = measureArgs(args);
    const output = measureResult(result);
    dcProcessTokenMeter.inputTokens += input.textTokens;
    dcProcessTokenMeter.outputTokens += output.textTokens;
    dcProcessTokenMeter.inputBytes += Buffer.byteLength(JSON.stringify(args ?? ''), 'utf8');
    dcProcessTokenMeter.outputBytes += Buffer.byteLength(JSON.stringify(result?.content ?? result ?? ''), 'utf8');
    dcProcessTokenMeter.calls += 1;
    dcProcessTokenMeter.sessionInputTokens = dcProcessTokenMeter.inputTokens;
    dcProcessTokenMeter.sessionOutputTokens = dcProcessTokenMeter.outputTokens;
    dcProcessTokenMeter.sessionInputBytes = dcProcessTokenMeter.inputBytes;
    dcProcessTokenMeter.sessionOutputBytes = dcProcessTokenMeter.outputBytes;
    dcProcessTokenMeter.sessionCalls = dcProcessTokenMeter.calls;
    dcAddMetrics('in', input);
    dcAddMetrics('out', output);
    dcProcessTokenMeter.lastActivity = Date.now();
    return { ...dcProcessTokenMeter };
}
'''
    server = replace_once(server, anchor, anchor + meter + '\n', 'server meter anchor')
    old = "        return result;\n    }\n    catch (error) {"
    new = "        try {\n            const dcTokenMeter = await dcRecordTokenTraffic(args, result);\n            result._meta = { ...(result._meta || {}), dcTokenMeter };\n        }\n        catch { /* meter failure must never break a tool call */ }\n        return result;\n    }\n    catch (error) {"
    server = replace_once(server, old, new, 'server result anchor')

stats_import = "import { dcStats } from './dc-stats-server.js';\n"
if stats_import not in server:
    old = "import { measureArgs, measureResult } from './dc-traffic-meter.js';\n"
    new = old + stats_import + "dcStats.start();\n"
    server = replace_once(server, old, new, 'stats server import')

    old = r'''async function dcRecordTokenTraffic(args, result) {
    const input = measureArgs(args);
    const output = measureResult(result);
    dcProcessTokenMeter.inputTokens += input.textTokens;
    dcProcessTokenMeter.outputTokens += output.textTokens;
    dcProcessTokenMeter.inputBytes += Buffer.byteLength(JSON.stringify(args ?? ''), 'utf8');
    dcProcessTokenMeter.outputBytes += Buffer.byteLength(JSON.stringify(result?.content ?? result ?? ''), 'utf8');
    dcProcessTokenMeter.calls += 1;
    dcProcessTokenMeter.sessionInputTokens = dcProcessTokenMeter.inputTokens;
    dcProcessTokenMeter.sessionOutputTokens = dcProcessTokenMeter.outputTokens;
    dcProcessTokenMeter.sessionInputBytes = dcProcessTokenMeter.inputBytes;
    dcProcessTokenMeter.sessionOutputBytes = dcProcessTokenMeter.outputBytes;
    dcProcessTokenMeter.sessionCalls = dcProcessTokenMeter.calls;
    dcAddMetrics('in', input);
    dcAddMetrics('out', output);
    dcProcessTokenMeter.lastActivity = Date.now();
    return { ...dcProcessTokenMeter };
}
'''
    new = r'''function dcStatsMeta(metadata) {
    return {
        agentDeviceId: metadata?.dcAgentDeviceId || null,
        agentInstanceId: metadata?.dcAgentInstanceId || null,
        agentName: metadata?.dcAgentName || null,
        taskLabel: metadata?.dcAgentTaskLabel || null,
        clientName: metadata?.clientInfo?.name || null
    };
}
async function dcRecordTokenTraffic(name, args, result, metadata, startTime) {
    const input = measureArgs(args);
    const output = measureResult(result);
    const inputBytes = Buffer.byteLength(JSON.stringify(args ?? ''), 'utf8');
    const outputBytes = Buffer.byteLength(JSON.stringify(result?.content ?? result ?? ''), 'utf8');
    dcProcessTokenMeter.inputTokens += input.textTokens;
    dcProcessTokenMeter.outputTokens += output.textTokens;
    dcProcessTokenMeter.inputBytes += inputBytes;
    dcProcessTokenMeter.outputBytes += outputBytes;
    dcProcessTokenMeter.calls += 1;
    dcProcessTokenMeter.sessionInputTokens = dcProcessTokenMeter.inputTokens;
    dcProcessTokenMeter.sessionOutputTokens = dcProcessTokenMeter.outputTokens;
    dcProcessTokenMeter.sessionInputBytes = dcProcessTokenMeter.inputBytes;
    dcProcessTokenMeter.sessionOutputBytes = dcProcessTokenMeter.outputBytes;
    dcProcessTokenMeter.sessionCalls = dcProcessTokenMeter.calls;
    dcAddMetrics('in', input);
    dcAddMetrics('out', output);
    dcProcessTokenMeter.lastActivity = Date.now();
    await dcStats.record({
        eventId: 'm:' + dcProcessTokenMeter.sessionStarted + ':' + dcProcessTokenMeter.calls,
        tool: name, status: 'ok', durationMs: Date.now() - startTime,
        inputTokens: input.textTokens, outputTokens: output.textTokens,
        inputBytes, outputBytes,
        imageInCount: input.imageCount || 0, imageOutCount: output.imageCount || 0,
        audioInCount: input.audioCount || 0, audioOutCount: output.audioCount || 0,
        blobInCount: input.blobCount || 0, blobOutCount: output.blobCount || 0,
        binaryInCount: input.binaryCount || 0, binaryOutCount: output.binaryCount || 0,
        linkInCount: input.linkCount || 0, linkOutCount: output.linkCount || 0,
        ...dcStatsMeta(metadata)
    });
    return { ...dcProcessTokenMeter };
}
async function dcRecordTokenFailure(name, args, error, metadata, startTime) {
    const input = measureArgs(args);
    await dcStats.record({
        eventId: 'f:' + Math.floor(startTime / 1000) + ':' + name,
        tool: name, status: 'error', durationMs: Date.now() - startTime,
        inputTokens: input.textTokens, outputTokens: 0,
        inputBytes: Buffer.byteLength(JSON.stringify(args ?? ''), 'utf8'), outputBytes: 0,
        error: String(error?.message || error || '').slice(0, 500),
        ...dcStatsMeta(metadata)
    });
}
'''
    server = replace_once(server, old, new, 'stats recorder migration')

    old = "const dcTokenMeter = await dcRecordTokenTraffic(args, result);"
    new = "const dcTokenMeter = await dcRecordTokenTraffic(name, args, result, request.params._meta, startTime);"
    server = replace_once(server, old, new, 'stats success call migration')

    old = "        const errorMessage = error instanceof Error ? error.message : String(error);\n        // Track the failure"
    new = "        const errorMessage = error instanceof Error ? error.message : String(error);\n        try { await dcRecordTokenFailure(name, args, error, request.params._meta, startTime); } catch {}\n        // Track the failure"
    server = replace_once(server, old, new, 'stats failure call migration')

# Upgrade an already-installed stats recorder without requiring a clean package.
old_stats_success = "    await dcStats.record({\n        tool: name, status: 'ok', durationMs: Date.now() - startTime,"
new_stats_success = "    await dcStats.record({\n        eventId: 'm:' + dcProcessTokenMeter.sessionStarted + ':' + dcProcessTokenMeter.calls,\n        tool: name, status: 'ok', durationMs: Date.now() - startTime,"
if old_stats_success in server:
    server = replace_once(server, old_stats_success, new_stats_success, 'stats event id success migration')

old_stats_failure = "    await dcStats.record({\n        tool: name, status: 'error', durationMs: Date.now() - startTime,"
new_stats_failure = "    await dcStats.record({\n        eventId: 'f:' + Math.floor(startTime / 1000) + ':' + name,\n        tool: name, status: 'error', durationMs: Date.now() - startTime,"
if old_stats_failure in server:
    server = replace_once(server, old_stats_failure, new_stats_failure, 'stats event id failure migration')

if "./dc-terminal-status.js" not in device:
    old = "import { captureRemote } from '../utils/capture.js';\n"
    new = old + "import { dcTerminalStatus } from './dc-terminal-status.js';\nimport { summarizeToolResult } from './dc-content-summary.js';\n"
    device = replace_once(device, old, new, 'device imports')
    old = "            console.log(`   - Device Name:  ${deviceName}`);\n            // Keep process alive"
    new = "            console.log(`   - Device Name:  ${deviceName}`);\n            dcTerminalStatus.activate();\n            // Keep process alive"
    device = replace_once(device, old, new, 'device activate')
    old = "            let result;\n            // Handle 'ping' tool specially"
    new = "            let result;\n            dcTerminalStatus.beginCall(tool_args);\n            // Handle 'ping' tool specially"
    device = replace_once(device, old, new, 'device begin')
    old = "            console.log(`✅ Tool call ${tool_name} completed:\\r\\n ${JSON.stringify(result)}`);"
    new = "            console.log(`✅ Tool call ${tool_name} completed:\\r\\n ${summarizeToolResult(result)}`);\n            dcTerminalStatus.finishCall(result?._meta?.dcTokenMeter);"
    device = replace_once(device, old, new, 'device finish')
    old = "        catch (error) {\n            console.error(`❌ Tool call ${tool_name} failed:`, error.message);"
    new = "        catch (error) {\n            dcTerminalStatus.finishCall();\n            console.error(`❌ Tool call ${tool_name} failed:`, error.message);"
    device = replace_once(device, old, new, 'device error')

if "./dc-auto-spawn.js" not in device:
    old = "import { summarizeToolResult } from './dc-content-summary.js';\n"
    new = old + "import { DCAutoSpawnManager } from './dc-auto-spawn.js';\n"
    device = replace_once(device, old, new, 'auto-spawn import')

    old = "        this.remoteChannel = new RemoteChannel();\n"
    new = old + "        this.autoSpawn = null;\n"
    device = replace_once(device, old, new, 'auto-spawn constructor')

    old = "            await this.remoteChannel.registerDevice(await this.desktop.listClientTools(), this.deviceId, deviceName, (payload) => this.handleNewToolCall(payload));\n"
    new = old + "            this.autoSpawn = new DCAutoSpawnManager(this.remoteChannel, this.deviceId, this.desktop, this.baseServerUrl);\n            await this.autoSpawn.start();\n"
    device = replace_once(device, old, new, 'auto-spawn start')

    old = "            let result;\n            dcTerminalStatus.beginCall(tool_args);\n"
    new = (
        "            if (this.autoSpawn?.shouldRedirect(tool_name, tool_args)) {\n"
        "                const redirect = await this.autoSpawn.allocateRedirect(call_id, metadata);\n"
        "                console.log(`🧩 Assigned isolated DC for call ${call_id}`);\n"
        "                await this.remoteChannel.updateCallResult(call_id, 'completed', redirect);\n"
        "                await this.remoteChannel.notifyResult(call_id);\n"
        "                return;\n"
        "            }\n"
        "            let result;\n"
        "            dcTerminalStatus.beginCall(tool_args);\n"
    )
    device = replace_once(device, old, new, 'auto-spawn redirect')

    old = "        try {\n            // Stop heartbeat first to prevent new operations\n"
    new = (
        "        try {\n"
        "            if (this.autoSpawn) {\n"
        "                console.log('  → Stopping auto-spawn agents...');\n"
        "                await this.autoSpawn.shutdown();\n"
        "                console.log('  ✓ Auto-spawn agents stopped');\n"
        "            }\n"
        "            // Stop heartbeat first to prevent new operations\n"
    )
    device = replace_once(device, old, new, 'auto-spawn shutdown')

old_auto_ctor = "            this.autoSpawn = new DCAutoSpawnManager(this.remoteChannel, this.deviceId, this.desktop);\n"
new_auto_ctor = "            this.autoSpawn = new DCAutoSpawnManager(this.remoteChannel, this.deviceId, this.desktop, this.baseServerUrl);\n"
if old_auto_ctor in device:
    device = replace_once(device, old_auto_ctor, new_auto_ctor, 'auto-spawn constructor migration')

old_redirect_call = "            if (this.autoSpawn?.shouldRedirect(tool_name)) {\n"
new_redirect_call = "            if (this.autoSpawn?.shouldRedirect(tool_name, tool_args)) {\n"
if old_redirect_call in device:
    device = replace_once(device, old_redirect_call, new_redirect_call, 'auto-spawn maintenance migration')

server_path.write_text(server, encoding='utf-8', newline='\n')
device_path.write_text(device, encoding='utf-8', newline='\n')
print('ANCHOR_PATCH_OK')
