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

if "./dc-terminal-status.js" not in device:
    old = "import { captureRemote } from '../utils/capture.js';\n"
    new = old + "import { dcTerminalStatus } from './dc-terminal-status.js';\nimport { summarizeToolResult } from './dc-content-summary.js';\n"
    device = replace_once(device, old, new, 'device imports')
    old = "            console.log(`   - Device Name:  ${deviceName}`);\n            // Keep process alive"
    new = "            console.log(`   - Device Name:  ${deviceName}`);\n            dcTerminalStatus.activate();\n            // Keep process alive"
    device = replace_once(device, old, new, 'device activate')
    old = "            let result;\n            // Handle 'ping' tool specially"
    new = "            let result;\n            dcTerminalStatus.beginCall();\n            // Handle 'ping' tool specially"
    device = replace_once(device, old, new, 'device begin')
    old = "            console.log(`✅ Tool call ${tool_name} completed:\\r\\n ${JSON.stringify(result)}`);"
    new = "            console.log(`✅ Tool call ${tool_name} completed:\\r\\n ${summarizeToolResult(result)}`);\n            dcTerminalStatus.finishCall(result?._meta?.dcTokenMeter);"
    device = replace_once(device, old, new, 'device finish')
    old = "        catch (error) {\n            console.error(`❌ Tool call ${tool_name} failed:`, error.message);"
    new = "        catch (error) {\n            dcTerminalStatus.finishCall();\n            console.error(`❌ Tool call ${tool_name} failed:`, error.message);"
    device = replace_once(device, old, new, 'device error')

server_path.write_text(server, encoding='utf-8', newline='\n')
device_path.write_text(device, encoding='utf-8', newline='\n')
print('ANCHOR_PATCH_OK')
