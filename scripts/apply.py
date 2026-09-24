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
config_manager_path = root / 'dist/config-manager.js'
terminal_manager_path = root / 'dist/terminal-manager.js'
server = server_path.read_text(encoding='utf-8')
device = device_path.read_text(encoding='utf-8')
config_manager = config_manager_path.read_text(encoding='utf-8')
terminal_manager = terminal_manager_path.read_text(encoding='utf-8')

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
    const statsMeta = dcStatsMeta(metadata);
    await dcStats.record({
        eventId: 'm:' + dcProcessTokenMeter.sessionStarted + ':' + dcProcessTokenMeter.calls,
        tool: name, status: result?.isError ? 'error' : 'ok', durationMs: Date.now() - startTime,
        inputTokens: input.textTokens, outputTokens: output.textTokens,
        inputBytes, outputBytes,
        imageInCount: input.imageCount || 0, imageOutCount: output.imageCount || 0,
        audioInCount: input.audioCount || 0, audioOutCount: output.audioCount || 0,
        blobInCount: input.blobCount || 0, blobOutCount: output.blobCount || 0,
        binaryInCount: input.binaryCount || 0, binaryOutCount: output.binaryCount || 0,
        linkInCount: input.linkCount || 0, linkOutCount: output.linkCount || 0,
        ...statsMeta
    });
    return {
        ...dcProcessTokenMeter,
        callInputTokens: input.textTokens,
        callOutputTokens: output.textTokens,
        callInputBytes: inputBytes,
        callOutputBytes: outputBytes,
        ...statsMeta
    };
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

old_stats_status = "        tool: name, status: 'ok', durationMs: Date.now() - startTime,"
new_stats_status = "        tool: name, status: result?.isError ? 'error' : 'ok', durationMs: Date.now() - startTime,"
if old_stats_status in server:
    server = replace_once(server, old_stats_status, new_stats_status, 'stats soft-error status migration')

# Enrich existing installed meters with per-call deltas and agent metadata.
# The event row is already written above; this return value is what ToolHistory
# persists and what the visual child receives from the gateway.
old_meter_return = "    return { ...dcProcessTokenMeter };\n}\nasync function dcRecordTokenFailure"
new_meter_return = (
    "    const statsMeta = dcStatsMeta(metadata);\n"
    "    return { ...dcProcessTokenMeter, callInputTokens: input.textTokens, callOutputTokens: output.textTokens, "
    "callInputBytes: inputBytes, callOutputBytes: outputBytes, ...statsMeta };\n"
    "}\nasync function dcRecordTokenFailure"
)
if old_meter_return in server:
    server = replace_once(server, old_meter_return, new_meter_return, 'stats per-call meter migration')

# Record and attach the meter before ToolHistory snapshots/caps the result.
# This keeps dcTokenMeter inside tool-history even for outputs whose content is
# replaced by the 4 KiB omission marker, so later crash recovery can dedupe by
# the stable m:<session>:<call> event id instead of estimating a second row.
stats_before_history_marker = "// dc-stats-before-history-v2"
if stats_before_history_marker not in server:
    old_end_stats = (
        "        try {\n"
        "            const dcTokenMeter = await dcRecordTokenTraffic(name, args, result, request.params._meta, startTime);\n"
        "            result._meta = { ...(result._meta || {}), dcTokenMeter };\n"
        "        }\n"
        "        catch { /* meter failure must never break a tool call */ }\n"
        "        return result;\n"
    )
    if old_end_stats in server:
        server = replace_once(server, old_end_stats, "        return result;\n", 'move stats before history')

    history_anchor = "        const duration = Date.now() - startTime;\n        isError = !!result.isError;\n"
    history_stats = (
        history_anchor +
        "        " + stats_before_history_marker + "\n"
        "        try {\n"
        "            const dcTokenMeter = await dcRecordTokenTraffic(name, args, result, request.params._meta, startTime);\n"
        "            result._meta = { ...(result._meta || {}), dcTokenMeter };\n"
        "        }\n"
        "        catch { /* meter failure must never break a tool call */ }\n"
    )
    server = replace_once(server, history_anchor, history_stats, 'stats before history anchor')

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

old_allocate_redirect = "                const redirect = await this.autoSpawn.allocateRedirect(call_id);\n"
new_allocate_redirect = "                const redirect = await this.autoSpawn.allocateRedirect(call_id, metadata);\n"
if old_allocate_redirect in device:
    device = replace_once(device, old_allocate_redirect, new_allocate_redirect, 'auto-spawn metadata migration')


# dc-tool-prompt-efficiency-v1
if "When several known files are needed, use read_multiple_files instead of repeated read_file calls." not in server:
    server = replace_once(
        server,
        "                        Prefer this over 'execute_command' with cat/type for viewing files.\n",
        "                        Prefer this over 'execute_command' with cat/type for viewing files.\n"
        "                        When several known files are needed, use read_multiple_files instead of repeated read_file calls.\n",
        'read_file batching guidance'
    )

if "Write small or medium files in one call when practical." not in server:
    old = '''                        CHUNKING IS STANDARD PRACTICE: Always write files in chunks of 25-30 lines maximum.
                        This is the normal, recommended way to write files - not an emergency measure.

                        STANDARD PROCESS FOR ANY FILE:
                        1. FIRST → write_file(filePath, firstChunk, {mode: 'rewrite'})  [≤30 lines]
                        2. THEN → write_file(filePath, secondChunk, {mode: 'append'})   [≤30 lines]
                        3. CONTINUE → write_file(filePath, nextChunk, {mode: 'append'}) [≤30 lines]

                        ALWAYS CHUNK PROACTIVELY - don't wait for performance warnings!

                        WHEN TO CHUNK (always be proactive):
                        1. Any file expected to be longer than 25-30 lines
                        2. When writing multiple files in sequence
                        3. When creating documentation, code files, or configuration files

                        HANDLING CONTINUATION ("Continue" prompts):
                        If user asks to "Continue" after an incomplete operation:
                        1. Read the file to see what was successfully written
                        2. Continue writing ONLY the remaining content using {mode: 'append'}
                        3. Keep chunks to 25-30 lines each

'''
    new = '''                        Write small or medium files in one call when practical. For large files, performance warnings, or incomplete writes, use coherent chunks and append only the remaining content.

'''
    server = replace_once(server, old, new, 'write_file chunking guidance')

if "Use the smallest uniquely identifiable block that completes one coherent edit." not in server:
    old = '''                        BEST PRACTICE: Make multiple small, focused edits rather than one large edit.
                        Each edit_block call should change only what needs to be changed - include just enough
                        context to uniquely identify the text being modified.
'''
    new = '''                        Use the smallest uniquely identifiable block that completes one coherent edit. For the same replacement in multiple places, use expected_replacements instead of repeated calls; keep unrelated changes separate.
'''
    server = replace_once(server, old, new, 'edit_block guidance')
    old = '''                        When editing multiple sections, make separate edit_block calls for each distinct change
                        rather than one large replacement.

'''
    server = replace_once(server, old, '', 'edit_block repeated guidance')

if "For short, related, non-destructive shell commands already known" not in server:
    old = '''                        ${OS_GUIDANCE}
                        
                        REQUIRED WORKFLOW FOR LOCAL FILES:'''
    new = '''                        ${OS_GUIDANCE}

                        For short, related, non-destructive shell commands already known, prefer one start_process call with appropriate shell separators; keep dependent, destructive, long-running, or unrelated operations separate.
                        
                        REQUIRED WORKFLOW FOR LOCAL FILES:'''
    server = replace_once(server, old, new, 'start_process batching guidance')

if 'If uncertain, try the most likely type first and broaden only if results are insufficient.' not in server:
    old = '''                        SEARCH STRATEGY GUIDE:
                        Choose the right search type based on what the user is looking for:
                        
                        USE searchType="files" WHEN:
                        - User asks for specific files: "find package.json", "locate config files"
                        - Pattern looks like a filename: "*.js", "README.md", "test-*.tsx" 
                        - User wants to find files by name/extension: "all TypeScript files", "Python scripts"
                        - Looking for configuration/setup files: ".env", "dockerfile", "tsconfig.json"
                        
                        USE searchType="content" WHEN:
                        - User asks about code/logic: "authentication logic", "error handling", "API calls"
                        - Looking for functions/variables: "getUserData function", "useState hook"
                        - Searching for text/comments: "TODO items", "FIXME comments", "documentation"
                        - Finding patterns in code: "console.log statements", "import statements"
                        - User describes functionality: "components that handle login", "files with database queries"
                        
                        WHEN UNSURE OR USER REQUEST IS AMBIGUOUS:
                        Run TWO searches in parallel - one for files and one for content:
                        
                        Example approach for ambiguous queries like "find authentication stuff":
                        1. Start file search: searchType="files", pattern="auth"
                        2. Simultaneously start content search: searchType="content", pattern="authentication"  
                        3. Present combined results: "Found 3 auth-related files and 8 files containing authentication code"
                        
'''
    new = '''                        Use searchType="files" for names/extensions/paths and "content" for text, code, or symbols. If uncertain, try the most likely type first and broaden only if results are insufficient.
                        
'''
    server = replace_once(server, old, new, 'start_search strategy guidance')

    old = '''                        PATTERN MATCHING MODES:
                        - Default (literalSearch=false): Patterns are treated as regular expressions
                        - Literal (literalSearch=true): Patterns are treated as exact strings
                        
                        WHEN TO USE literalSearch=true:
                        Use literal search when searching for code patterns with special characters:
                        - Function calls with parentheses and quotes
                        - Array access with brackets
                        - Object methods with dots and parentheses
                        - File paths with backslashes
                        - Any pattern containing: . * + ? ^ $ { } [ ] | \\ ( )
                        
                        IMPORTANT PARAMETERS:
                        - pattern: What to search for (file names OR content text)
                        - literalSearch: Use exact string matching instead of regex (default: false)
                        - filePattern: Optional filter to limit search to specific file types (e.g., "*.js", "package.json")
                        - ignoreCase: Case-insensitive search (default: true). Works for both file names and content.
                        - earlyTermination: Stop search early when exact filename match is found (optional: defaults to true for file searches, false for content searches)
                        
'''
    new = '''                        Use literalSearch=true for exact text/code/path; otherwise patterns are regex. Use filePattern to narrow scope when known.
                        
'''
    server = replace_once(server, old, new, 'start_search pattern guidance')

    old = '''                        DECISION EXAMPLES:
                        - "find package.json" → searchType="files", pattern="package.json" (specific file)
                        - "find authentication components" → searchType="content", pattern="authentication" (looking for functionality)
                        - "locate all React components" → searchType="files", pattern="*.tsx" or "*.jsx" (file pattern)
                        - "find TODO comments" → searchType="content", pattern="TODO" (text in files)
                        - "show me login files" → AMBIGUOUS → run both: files with "login" AND content with "login"
                        - "find config" → AMBIGUOUS → run both: config files AND files containing config code
                        
                        COMPREHENSIVE SEARCH EXAMPLES:
                        - Find package.json files: searchType="files", pattern="package.json"
                        - Find all JS files: searchType="files", pattern="*.js"
                        - Search for TODO in code: searchType="content", pattern="TODO", filePattern="*.js|*.ts"
                        - Search for exact code: searchType="content", pattern="toast.error('test')", literalSearch=true
                        - Ambiguous request "find auth stuff": Run two searches:
                          1. searchType="files", pattern="auth"
                          2. searchType="content", pattern="authentication"
                        
                        PRO TIP: When user requests are ambiguous about whether they want files or content,
                        run both searches concurrently and combine results for comprehensive coverage.
                        
'''
    server = replace_once(server, old, '', 'start_search example guidance')

    old = '''                        Unlike regular search tools, this starts a background search process and returns
                        immediately with a session ID. Use get_more_search_results to get results as they
                        come in, and stop_search to stop the search early if needed.
                        
                        Perfect for large directories where you want to see results immediately and
                        have the option to cancel if the search takes too long or you find what you need.
'''
    new = '''                        This starts a background search and returns a session ID; use get_more_search_results for results and stop_search once enough information is found.
'''
    server = replace_once(server, old, new, 'start_search lifecycle guidance')

if "do not poll solely for completion when the initial output already answers the task" not in server:
    server = replace_once(
        server,
        "                        Read output from a running process with file-like pagination support.\n",
        "                        Read output from a running process with file-like pagination support.\n"
        "                        Use this only when more output or completion status is needed; do not poll solely for completion when the initial output already answers the task unless completion itself matters.\n",
        'read_process_output polling guidance'
    )


workspace_marker = '// dc-workspace-root-v1'
if workspace_marker not in config_manager:
    config_manager = replace_once(
        config_manager,
        "import { CONFIG_FILE } from './config.js';\n",
        "import { CONFIG_FILE } from './config.js';\n"
        "// dc-workspace-root-v1\n"
        "function dcWorkspaceAllowedDirectories() {\n"
        "    if (process.env.DC_WORKSPACE_DISABLE === '1') return null;\n"
        "    const root = (process.env.DC_WORKSPACE_ROOT || '').trim();\n"
        "    return root ? [path.resolve(root)] : null;\n"
        "}\n",
        'workspace config helper'
    )
    config_manager = replace_once(
        config_manager,
        "    async getConfig() {\n        await this.init();\n        return { ...this.config };\n    }\n",
        "    async getConfig() {\n"
        "        await this.init();\n"
        "        const workspaceDirs = dcWorkspaceAllowedDirectories();\n"
        "        return { ...this.config, ...(workspaceDirs ? { allowedDirectories: workspaceDirs } : {}) };\n"
        "    }\n",
        'workspace getConfig'
    )
    config_manager = replace_once(
        config_manager,
        "    async getValue(key) {\n        await this.init();\n        return this.config[key];\n    }\n",
        "    async getValue(key) {\n"
        "        await this.init();\n"
        "        const workspaceDirs = dcWorkspaceAllowedDirectories();\n"
        "        if (key === 'allowedDirectories' && workspaceDirs) return workspaceDirs;\n"
        "        return this.config[key];\n"
        "    }\n",
        'workspace getValue'
    )
    config_manager = replace_once(
        config_manager,
        "    async setValue(key, value) {\n        await this.init();\n",
        "    async setValue(key, value) {\n"
        "        await this.init();\n"
        "        const workspaceDirs = dcWorkspaceAllowedDirectories();\n"
        "        if (key === 'allowedDirectories' && workspaceDirs) value = workspaceDirs;\n",
        'workspace setValue'
    )

if workspace_marker not in server:
    old = "const PATH_GUIDANCE = `IMPORTANT: ${getPathGuidance(SYSTEM_INFO)} Relative paths may fail as they depend on the current working directory. Tilde paths (~/...) might not work in all contexts. Unless the user explicitly asks for relative paths, use absolute paths.`;\n"
    new = r'''// dc-workspace-root-v1
const DC_WORKSPACE_ROOT = process.env.DC_WORKSPACE_DISABLE === '1' ? '' : (process.env.DC_WORKSPACE_ROOT || '').trim();
const DC_WORKSPACE_PATH = DC_WORKSPACE_ROOT ? path.resolve(DC_WORKSPACE_ROOT) : '';
function dcWorkspaceTextViolation(value) {
    if (!DC_WORKSPACE_PATH || typeof value !== 'string' || !value.trim()) return null;
    const text = value;
    if (/(^|[\s"'`=])\.\.[\\/]/.test(text)) return 'parent-directory traversal (..) is not allowed';
    if (/(%USERPROFILE%|%APPDATA%|%LOCALAPPDATA%|%TEMP%|%TMP%|\$env:(USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|HOME)|\$HOME|~[\\/])/i.test(text)) return 'home/profile path expansion is not allowed';
    if (/(^|[\s"'`=])\\\\[^\\\s]+\\[^\\\s]+/.test(text)) return 'UNC paths are outside the workspace';
    if (/(^|[\s"'`=])\\(?!\\)[A-Za-z0-9_.-]/.test(text)) return 'drive-root-relative paths are outside the workspace';
    const matches = text.match(/[A-Za-z]:[\\/][^\s"'`;&|<>]*/g) || [];
    for (const raw of matches) {
        const candidate = path.resolve(raw);
        const rel = path.relative(DC_WORKSPACE_PATH, candidate);
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) continue;
        return `path outside workspace: ${raw}`;
    }
    return null;
}
function dcWorkspaceToolViolation(name, args) {
    if (!DC_WORKSPACE_PATH || !args || typeof args !== 'object') return null;
    if (name === 'start_process') {
        const command = String(args.command || '');
        if (command.trim() === 'node:local') return 'node:local is disabled in workspace mode';
        return dcWorkspaceTextViolation(command);
    }
    if (name === 'interact_with_process') return dcWorkspaceTextViolation(String(args.input || ''));
    return null;
}
const PATH_GUIDANCE = `IMPORTANT: ${getPathGuidance(SYSTEM_INFO)} Relative paths may fail as they depend on the current working directory. Tilde paths (~/...) might not work in all contexts. Unless the user explicitly asks for relative paths, use absolute paths.${DC_WORKSPACE_PATH ? ` WORKSPACE RESTRICTION: access files only inside ${DC_WORKSPACE_PATH}; do not use parent traversal, home/profile paths, UNC paths, or absolute paths outside this root.` : ''}`;
'''
    server = replace_once(server, old, new, 'workspace server helper')
    server = replace_once(
        server,
        "        // Track tool call\n        trackToolCall(name, args);\n",
        "        const dcWorkspaceViolation = dcWorkspaceToolViolation(name, args);\n"
        "        if (dcWorkspaceViolation) throw new Error(`Workspace restriction (${DC_WORKSPACE_PATH}): ${dcWorkspaceViolation}`);\n"
        "        // Track tool call\n"
        "        trackToolCall(name, args);\n",
        'workspace call guard'
    )

if workspace_marker not in terminal_manager:
    terminal_manager = replace_once(
        terminal_manager,
        "        // Spawn the process with appropriate arguments\n        const childProcess = spawn(spawnConfig.executable, spawnConfig.args, spawnOptions);\n",
        "        // dc-workspace-root-v1\n"
        "        const dcWorkspaceCwd = process.env.DC_WORKSPACE_DISABLE === '1' ? '' : (process.env.DC_WORKSPACE_ROOT || '').trim();\n"
        "        if (dcWorkspaceCwd) spawnOptions.cwd = dcWorkspaceCwd;\n"
        "        // Spawn the process with appropriate arguments\n"
        "        const childProcess = spawn(spawnConfig.executable, spawnConfig.args, spawnOptions);\n",
        'workspace terminal cwd'
    )

server_path.write_text(server, encoding='utf-8', newline='\n')
device_path.write_text(device, encoding='utf-8', newline='\n')
config_manager_path.write_text(config_manager, encoding='utf-8', newline='\n')
terminal_manager_path.write_text(terminal_manager, encoding='utf-8', newline='\n')
print('ANCHOR_PATCH_OK')
