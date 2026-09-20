import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { measureArgs, measureResult } from './dc-traffic-meter.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 17891;
const MAX_DAYS = 365;
const DASHBOARD_FILE = process.env.DC_STATS_DASHBOARD_FILE ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'dc-stats-dashboard.html');

async function dashboardPage() {
    try { return await fs.readFile(DASHBOARD_FILE, 'utf8'); }
    catch { return PAGE + PAGE2 + PAGE3; }
}

async function dashboardVersion() {
    try { return Math.round((await fs.stat(DASHBOARD_FILE)).mtimeMs); }
    catch { return 0; }
}

function localDay(value = Date.now()) {
    const d = new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function statsRoot() {
    if (process.env.DC_STATS_DIR) return process.env.DC_STATS_DIR;
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, 'DesktopCommander', 'stats');
    }
    return path.join(os.homedir(), '.desktop-commander', 'stats');
}

function metric() {
    return { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0,
        inputBytes: 0, outputBytes: 0, durationMs: 0 };
}

function addMetric(target, event) {
    target.calls += event.callsCount == null ? 1 : Math.max(0, Number(event.callsCount) || 0);
    target.failures += event.status === 'error' ? 1 : 0;
    target.inputTokens += Number(event.inputTokens) || 0;
    target.outputTokens += Number(event.outputTokens) || 0;
    target.inputBytes += Number(event.inputBytes) || 0;
    target.outputBytes += Number(event.outputBytes) || 0;
    target.durationMs += Number(event.durationMs) || 0;
    return target;
}

function finishMetric(value) {
    return {
        ...value,
        totalTokens: value.inputTokens + value.outputTokens,
        totalBytes: value.inputBytes + value.outputBytes,
        avgDurationMs: value.calls ? Math.round(value.durationMs / value.calls) : 0
    };
}

function parseDays(url) {
    const value = Number(url.searchParams.get('days') || 30);
    return Math.max(1, Math.min(MAX_DAYS, Number.isFinite(value) ? Math.round(value) : 30));
}

function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

async function readEvents(dir, days) {
    let names = [];
    try { names = await fs.readdir(dir); } catch { return []; }
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days + 1);
    const minDay = localDay(cutoff);
    const files = names
        .filter((name) => /^traffic-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .filter((name) => name.slice(8, 18) >= minDay)
        .sort();
    const events = [];
    for (const name of files) {
        let text = '';
        try { text = await fs.readFile(path.join(dir, name), 'utf8'); } catch { continue; }
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try { events.push(JSON.parse(line)); } catch {}
        }
    }
    return events;
}

function rank(map, limit = 12) {
    return [...map.entries()]
        .map(([name, value]) => ({ name, ...finishMetric(value) }))
        .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)
        .slice(0, limit);
}

function aggregate(events, days) {
    const range = metric();
    const today = metric();
    const byDayMap = new Map();
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...metric() }));
    const tools = new Map();
    const tasks = new Map();
    const todayKey = localDay();

    for (const event of events) {
        addMetric(range, event);
        const day = localDay(event.ts);
        if (!byDayMap.has(day)) byDayMap.set(day, metric());
        addMetric(byDayMap.get(day), event);
        if (day === todayKey) addMetric(today, event);
        const hour = new Date(event.ts).getHours();
        addMetric(byHour[hour], event);
        if (event.source !== 'history-correction') {
            const tool = event.tool || 'unknown';
            if (!tools.has(tool)) tools.set(tool, metric());
            addMetric(tools.get(tool), event);
            const task = event.taskLabel || '未标注任务';
            if (!tasks.has(task)) tasks.set(task, metric());
            addMetric(tasks.get(task), event);
        }
    }

    const dayRows = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - days + 1);
    for (let i = 0; i < days; i += 1) {
        const key = localDay(cursor);
        dayRows.push({ day: key, ...finishMetric(byDayMap.get(key) || metric()) });
        cursor.setDate(cursor.getDate() + 1);
    }

    return {
        generatedAt: new Date().toISOString(),
        days,
        approximateTokens: true,
        today: finishMetric(today),
        range: finishMetric(range),
        byDay: dayRows,
        byHour: byHour.map(finishMetric),
        tools: rank(tools),
        tasks: rank(tasks),
        recent: events.filter((x) => x.source !== 'history-correction').slice(-60).reverse()
    };
}

function parseJson(line) {
    try { return JSON.parse(line); } catch { return null; }
}

function outputBytesFromHistory(output) {
    const text = output?.content?.[0]?.text;
    const match = typeof text === 'string'
        ? text.match(/\[output omitted from history: (\d+) bytes/)
        : null;
    if (match) return Number(match[1]) || 0;
    try { return Buffer.byteLength(JSON.stringify(output?.content ?? output ?? ''), 'utf8'); }
    catch { return 0; }
}

function deltaMetric(current, previous, field) {
    return Math.max(0, (Number(current?.[field]) || 0) - (Number(previous?.[field]) || 0));
}

async function existingEventIndex(dir) {
    const ids = new Set();
    const rows = [];
    let names = [];
    try { names = await fs.readdir(dir); } catch { return { ids, rows }; }
    for (const name of names.filter((x) => /^traffic-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))) {
        let text = '';
        try { text = await fs.readFile(path.join(dir, name), 'utf8'); } catch { continue; }
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const row = parseJson(line);
            if (!row) continue;
            rows.push(row);
            if (row.eventId) ids.add(row.eventId);
        }
    }
    return { ids, rows };
}

function matchesExistingLiveHistory(liveRows, usedRows, candidate) {
    let bestIndex = -1;
    let bestScore = Infinity;
    for (let i = 0; i < liveRows.length; i += 1) {
        if (usedRows.has(i)) continue;
        const row = liveRows[i];
        if (row.tool !== candidate.tool) continue;
        if ((Number(row.inputTokens) || 0) !== candidate.inputTokens) continue;
        if ((Number(row.inputBytes) || 0) !== candidate.inputBytes) continue;
        const timeDelta = Math.abs((Number(row.ts) || 0) - candidate.ts);
        if (timeDelta > 15000) continue;
        const durationDelta = Math.abs((Number(row.durationMs) || 0) - candidate.durationMs);
        if (durationDelta > 15000) continue;
        const score = timeDelta + durationDelta;
        if (score < bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    if (bestIndex < 0) return false;
    usedRows.add(bestIndex);
    return true;
}

async function appendRecoveredRows(dir, rows) {
    const groups = new Map();
    for (const row of rows.sort((a, b) => a.ts - b.ts)) {
        const day = localDay(row.ts);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(JSON.stringify(row));
    }
    for (const [day, lines] of groups) {
        await fs.appendFile(path.join(dir, 'traffic-' + day + '.jsonl'), lines.join('\n') + '\n', 'utf8');
    }
}

async function recoverExistingHistory(dir) {
    const stateFile = path.join(dir, 'history-recovery-v2.json');
    let previousState = null;
    try { previousState = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch {}
    await fs.mkdir(dir, { recursive: true });
    const existing = await existingEventIndex(dir);
    const ids = existing.ids;
    const liveRows = existing.rows.filter((row) => row?.source === 'live');
    const matchedLiveRows = new Set();
    const home = process.env.DC_HISTORY_DIR || path.join(os.homedir(), '.claude-server-commander');
    const historyFile = path.join(home, 'tool-history.jsonl');
    const rows = [];
    let rich = [];
    try {
        const text = await fs.readFile(historyFile, 'utf8');
        rich = text.split(/\r?\n/).map(parseJson).filter(Boolean);
    } catch {}
    const firstRichTs = rich.length ? Math.min(...rich.map((r) => Date.parse(r.timestamp)).filter(Number.isFinite)) : Infinity;
    const sessionInfo = new Map();
    for (const record of rich) {
        const meter = record.output?._meta?.dcTokenMeter;
        if (meter?.sessionStarted == null) continue;
        const key = String(meter.sessionStarted);
        sessionInfo.set(key, {
            start: Number(meter.sessionStarted),
            finalMeter: meter
        });
    }
    const sessionStarts = [...sessionInfo.entries()]
        .map(([key, value]) => ({ key, start: value.start }))
        .sort((a, b) => a.start - b.start);
    const sessionKeyForTs = (ts) => {
        let found = null;
        for (const item of sessionStarts) {
            if (item.start > ts) break;
            found = item.key;
        }
        return found;
    };
    const sessionSums = new Map();
    const addSessionSum = (key, values) => {
        if (!key) return;
        if (!sessionSums.has(key)) {
            sessionSums.set(key, { calls: 0, inputTokens: 0, outputTokens: 0, inputBytes: 0, outputBytes: 0 });
        }
        const sum = sessionSums.get(key);
        sum.calls += Number(values.calls) || 0;
        sum.inputTokens += Number(values.inputTokens) || 0;
        sum.outputTokens += Number(values.outputTokens) || 0;
        sum.inputBytes += Number(values.inputBytes) || 0;
        sum.outputBytes += Number(values.outputBytes) || 0;
    };
    const prevMeter = new Map();
    let richMeter = 0;
    let richEstimated = 0;

    for (const record of rich) {
        const ts = Date.parse(record.timestamp);
        if (!Number.isFinite(ts)) continue;
        const input = measureArgs(record.arguments);
        const output = measureResult(record.output);
        const meter = record.output?._meta?.dcTokenMeter;
        let inputTokens = input.textTokens;
        let outputTokens = output.textTokens;
        let inputBytes = Buffer.byteLength(JSON.stringify(record.arguments ?? ''), 'utf8');
        let outputBytes = outputBytesFromHistory(record.output);
        let quality = 'estimated';
        let eventId = 'h:' + record.timestamp + ':' + record.toolName + ':' + (record.duration || 0);
        let sessionKey = null;

        if (meter?.sessionStarted != null && meter?.calls != null) {
            const key = String(meter.sessionStarted);
            sessionKey = key;
            const previous = prevMeter.get(key);
            eventId = 'm:' + key + ':' + meter.calls;
            if ((previous && Number(meter.calls) === Number(previous.calls) + 1) || (!previous && Number(meter.calls) === 1)) {
                const base = previous || {};
                inputTokens = deltaMetric(meter, base, 'inputTokens');
                outputTokens = deltaMetric(meter, base, 'outputTokens');
                inputBytes = deltaMetric(meter, base, 'inputBytes');
                outputBytes = deltaMetric(meter, base, 'outputBytes');
                quality = 'meter';
                richMeter += 1;
            } else {
                richEstimated += 1;
            }
            prevMeter.set(key, meter);
        } else {
            richEstimated += 1;
        }

        if (!sessionKey) sessionKey = sessionKeyForTs(ts);
        addSessionSum(sessionKey, {
            calls: 1,
            inputTokens, outputTokens, inputBytes, outputBytes
        });

        if (ids.has(eventId)) continue;
        if (!meter && matchesExistingLiveHistory(liveRows, matchedLiveRows, {
            ts,
            tool: record.toolName || 'unknown',
            durationMs: Number(record.duration) || 0,
            inputTokens,
            inputBytes
        })) {
            continue;
        }
        ids.add(eventId);
        rows.push({
            eventId, ts, tool: record.toolName || 'unknown',
            status: record.output?.isError ? 'error' : 'ok',
            durationMs: Number(record.duration) || 0,
            inputTokens, outputTokens, inputBytes, outputBytes,
            taskLabel: null, source: 'history', recoveredQuality: quality
        });
    }

    let legacyImported = 0;
    let logNames = [];
    try {
        logNames = (await fs.readdir(home))
            .filter((n) => /^claude_tool_call(?:_.*)?\.log$/.test(n))
            .sort();
    } catch {}
    for (const name of logNames) {
        let text = '';
        try { text = await fs.readFile(path.join(home, name), 'utf8'); } catch { continue; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            const match = lines[i].match(/^(\S+)\s+\|\s+(.+?)\s*\t\|\s*Arguments:\s*(.*)$/);
            if (!match) continue;
            const ts = Date.parse(match[1]);
            if (!Number.isFinite(ts) || ts >= firstRichTs) continue;
            const args = parseJson(match[3]);
            if (args == null) continue;
            const tool = match[2].trim();
            const eventId = 'legacy:' + name + ':' + (i + 1);
            if (ids.has(eventId)) continue;
            const input = measureArgs(args);
            const inputBytes = Buffer.byteLength(JSON.stringify(args), 'utf8');
            addSessionSum(sessionKeyForTs(ts), {
                calls: 1, inputTokens: input.textTokens, outputTokens: 0,
                inputBytes, outputBytes: 0
            });
            ids.add(eventId);
            rows.push({
                eventId, ts, tool, status: 'unknown', durationMs: 0,
                inputTokens: input.textTokens, outputTokens: 0,
                inputBytes, outputBytes: 0,
                taskLabel: null, source: 'legacy-log', recoveredQuality: 'input-only'
            });
            legacyImported += 1;
        }
    }

    let sessionCorrections = 0;
    for (const [key, info] of sessionInfo) {
        const finalMeter = info.finalMeter || {};
        const sum = sessionSums.get(key) || { calls: 0, inputTokens: 0, outputTokens: 0, inputBytes: 0, outputBytes: 0 };
        const correction = {
            callsCount: Math.max(0, (Number(finalMeter.calls) || 0) - sum.calls),
            inputTokens: Math.max(0, (Number(finalMeter.inputTokens) || 0) - sum.inputTokens),
            outputTokens: Math.max(0, (Number(finalMeter.outputTokens) || 0) - sum.outputTokens),
            inputBytes: Math.max(0, (Number(finalMeter.inputBytes) || 0) - sum.inputBytes),
            outputBytes: Math.max(0, (Number(finalMeter.outputBytes) || 0) - sum.outputBytes)
        };
        if (!correction.callsCount && !correction.inputTokens && !correction.outputTokens &&
            !correction.inputBytes && !correction.outputBytes) continue;
        const eventId = 'correction:' + key;
        if (ids.has(eventId)) continue;
        ids.add(eventId);
        rows.push({
            eventId,
            ts: Number(finalMeter.lastActivity) || info.start,
            tool: '历史校正',
            status: 'unknown',
            durationMs: 0,
            ...correction,
            taskLabel: null,
            source: 'history-correction',
            recoveredQuality: 'session-total'
        });
        sessionCorrections += 1;
    }

    await appendRecoveredRows(dir, rows);
    const importedCalls = rows.reduce((sum, row) =>
        sum + (row.callsCount == null ? 1 : Math.max(0, Number(row.callsCount) || 0)), 0);
    const state = {
        version: 2,
        completedAt: new Date().toISOString(),
        previousCompletedAt: previousState?.completedAt || null,
        imported: importedCalls,
        importedRows: rows.length,
        richRecords: rich.length,
        richMeter,
        richEstimated,
        legacyImported,
        sessionCorrections,
        firstRichTimestamp: Number.isFinite(firstRichTs) ? new Date(firstRichTs).toISOString() : null
    };
    const stateTemp = stateFile + '.' + process.pid + '.tmp';
    await fs.writeFile(stateTemp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(stateTemp, stateFile);
    return state;
}

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desktop Commander · 使用统计</title>
<style>
:root{color-scheme:dark;--bg:#080c15;--panel:#101827;--panel2:#0d1421;--line:rgba(148,163,184,.14);--muted:#7d8da7;--text:#eef5ff;--accent:#68b9ff;--purple:#9187ff;--green:#5bd3a1;--red:#ff7c8b}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;background:radial-gradient(850px 480px at 12% -8%,rgba(65,132,255,.16),transparent 64%),radial-gradient(700px 420px at 95% 0%,rgba(129,104,255,.10),transparent 62%),var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1540px;margin:auto;padding:30px 32px 44px}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:22px;padding-bottom:3px}
h1{font-size:28px;letter-spacing:-.03em;line-height:1.15;margin:0 0 8px;font-weight:720}h1:after{content:"LIVE";display:inline-block;vertical-align:middle;margin-left:10px;padding:3px 6px;border-radius:999px;background:rgba(91,211,161,.10);border:1px solid rgba(91,211,161,.22);color:#7fe0b5;font-size:9px;letter-spacing:.08em}
.sub{color:var(--muted);font-size:12px}.ranges{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:10px;background:rgba(15,23,38,.8);box-shadow:0 10px 30px rgba(0,0,0,.15)}
button{border:0;background:transparent;color:#8796ad;padding:7px 12px;border-radius:7px;cursor:pointer;font:inherit;transition:.16s ease}button:hover{color:#d6e2f3;background:rgba(255,255,255,.035)}
button.on{color:#fff;background:linear-gradient(180deg,rgba(104,185,255,.22),rgba(104,185,255,.09));box-shadow:inset 0 0 0 1px rgba(104,185,255,.22)}
.cards{display:grid;grid-template-columns:1.22fr repeat(5,1fr);gap:11px;margin:0 0 12px}.card,.panel{border:1px solid var(--line);background:linear-gradient(180deg,rgba(18,27,43,.92),rgba(12,19,31,.94));box-shadow:0 14px 38px rgba(0,0,0,.14),inset 0 1px rgba(255,255,255,.018)}
.card{position:relative;overflow:hidden;min-height:118px;border-radius:14px;padding:17px 18px}.card:first-child{background:linear-gradient(135deg,rgba(45,111,190,.26),rgba(17,26,43,.94) 60%,rgba(92,73,177,.15));border-color:rgba(104,185,255,.23)}.card:first-child:after{content:"";position:absolute;width:150px;height:150px;border-radius:50%;right:-60px;top:-84px;background:radial-gradient(circle,rgba(104,185,255,.18),transparent 68%)}
.k{position:relative;z-index:1;color:#8392aa;font-size:11px;letter-spacing:.01em}.v{position:relative;z-index:1;font-size:27px;font-weight:720;letter-spacing:-.035em;line-height:1.1;margin-top:12px}.card:first-child .v{font-size:32px}.meta{position:relative;z-index:1;margin-top:10px;color:#687890;font-size:10px}.meta strong{color:#a7b8cf;font-weight:600}
.grid{display:grid;grid-template-columns:minmax(0,1.72fr) minmax(340px,.82fr);gap:12px;margin:12px 0}.panel{border-radius:14px;padding:18px;min-width:0}.panel h2{font-size:14px;color:#dbe7f7;font-weight:650;margin:0 0 13px}
canvas{width:100%;height:248px;display:block;border-radius:8px}table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}th,td{padding:9px 9px;border-bottom:1px solid rgba(148,163,184,.09);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left}th{color:#708099;font-size:10px;font-weight:600;letter-spacing:.02em}tbody tr:hover td{background:rgba(255,255,255,.018)}tbody tr:last-child td{border-bottom:0}.bad,.ok{font-weight:600}.bad{color:var(--red)}.ok{color:var(--green)}
.panel>div[style*="overflow"]{border:1px solid rgba(148,163,184,.08);border-radius:10px;max-height:430px}section.panel:last-of-type{margin-top:12px}
@media(max-width:1200px){.cards{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:700px){main{padding:20px 14px 32px}.cards{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start;flex-direction:column}.ranges{width:100%}.ranges button{flex:1}.v{font-size:23px}}
</style></head><body><main>`;

const PAGE2 = `
<div class="top"><div><h1>Desktop Commander 使用统计</h1>
<div class="sub" id="subtitle">仅本机访问 · Tokens 为 DC 工具载荷的估算文本量，不等同于模型账单 Token</div></div>
<div class="ranges"><button data-d="1">今日</button><button data-d="7">7天</button><button data-d="30" class="on">30天</button><button data-d="90">90天</button></div></div>
<div class="cards" id="cards"></div>
<div class="grid"><section class="panel"><h2>每日 Token 趋势</h2><canvas id="daily"></canvas></section>
<section class="panel"><h2>24 小时调用分布</h2><canvas id="hourly"></canvas></section></div>
<div class="grid"><section class="panel"><h2>工具排行</h2><div id="tools"></div></section>
<section class="panel"><h2>任务 / 子 Agent</h2><div id="tasks"></div></section></div>
<section class="panel"><h2>最近调用</h2><div style="overflow:auto"><table><thead><tr>
<th>时间</th><th>任务</th><th>工具</th><th>状态</th><th>输入 Token</th><th>输出 Token</th><th>耗时</th>
</tr></thead><tbody id="recent"></tbody></table></div></section>
<script>
const f=n=>{n=Number(n)||0;if(n<1e3)return String(Math.round(n));if(n<1e6)return (n/1e3).toFixed(n<1e4?1:0)+'K';return (n/1e6).toFixed(n<1e7?2:1)+'M'};
const fb=n=>{n=Number(n)||0;if(n<1024)return Math.round(n)+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB'};
function table(rows){const m=Math.max(1,...rows.map(x=>x.totalTokens));return '<table><thead><tr><th>名称</th><th>Tokens</th><th>调用</th><th>失败</th></tr></thead><tbody>'+rows.map(x=>{const p=Math.max(2,x.totalTokens/m*100).toFixed(1);return '<tr><td style="background:linear-gradient(90deg,rgba(104,185,255,.08) '+p+'%,transparent '+p+'%)">'+esc(x.name)+'</td><td><strong>'+f(x.totalTokens)+'</strong></td><td>'+f(x.calls)+'</td><td class="'+(x.failures?'bad':'')+'">'+f(x.failures)+'</td></tr>'}).join('')+'</tbody></table>'}
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function dailyChart(rows){const c=document.getElementById('daily'),r=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*r;c.height=h*r;const x=c.getContext('2d');x.setTransform(r,0,0,r,0,0);x.clearRect(0,0,w,h);const p={l:48,r:16,t:16,b:30},cw=w-p.l-p.r,ch=h-p.t-p.b,mt=Math.max(1,...rows.map(v=>v.totalTokens)),mc=Math.max(1,...rows.map(v=>v.calls));x.font='10px system-ui';x.textAlign='right';for(let i=0;i<4;i++){const y=p.t+ch*i/3;x.strokeStyle='rgba(148,163,184,.09)';x.beginPath();x.moveTo(p.l,y);x.lineTo(w-p.r,y);x.stroke();x.fillStyle='#63738b';x.fillText(f(mt*(1-i/3)),p.l-7,y+3)}const step=cw/Math.max(1,rows.length-1),bw=Math.max(2,Math.min(11,cw/Math.max(1,rows.length)*.42));rows.forEach((v,i)=>{const px=p.l+(rows.length===1?cw/2:i*step),bh=ch*.28*v.calls/mc;x.fillStyle='rgba(145,135,255,.18)';x.fillRect(px-bw/2,p.t+ch-bh,bw,bh)});const pts=rows.map((v,i)=>[p.l+(rows.length===1?cw/2:i*step),p.t+ch-ch*v.totalTokens/mt]);const g=x.createLinearGradient(0,p.t,0,p.t+ch);g.addColorStop(0,'rgba(104,185,255,.26)');g.addColorStop(1,'rgba(104,185,255,0)');x.beginPath();pts.forEach((q,i)=>i?x.lineTo(q[0],q[1]):x.moveTo(q[0],q[1]));if(pts.length){x.lineTo(pts[pts.length-1][0],p.t+ch);x.lineTo(pts[0][0],p.t+ch);x.closePath();x.fillStyle=g;x.fill()}x.beginPath();pts.forEach((q,i)=>i?x.lineTo(q[0],q[1]):x.moveTo(q[0],q[1]));x.strokeStyle='#70bdff';x.lineWidth=2;x.lineJoin='round';x.stroke();const every=rows.length<=7?1:Math.max(1,Math.ceil(rows.length/7));x.textAlign='center';x.fillStyle='#64748b';rows.forEach((v,i)=>{if(i%every===0||i===rows.length-1)x.fillText(v.day.slice(5),pts[i][0],h-8)})}
function hourlyChart(rows){const c=document.getElementById('hourly'),r=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*r;c.height=h*r;const x=c.getContext('2d');x.setTransform(r,0,0,r,0,0);x.clearRect(0,0,w,h);const max=Math.max(1,...rows.map(v=>v.calls)),gap=5,bw=Math.max(4,(w-32)/rows.length-gap);rows.forEach((v,i)=>{const bh=Math.max(3,(h-38)*v.calls/max),px=16+i*(bw+gap),gr=x.createLinearGradient(0,h-28-bh,0,h-28);gr.addColorStop(0,'rgba(104,185,255,.95)');gr.addColorStop(1,'rgba(104,185,255,.22)');x.fillStyle=gr;x.fillRect(px,h-28-bh,bw,bh);x.fillStyle='#64748b';x.font='9px system-ui';x.textAlign='center';x.fillText(String(v.hour).padStart(2,'0'),px+bw/2,h-9)})}
`;

const PAGE3 = `
async function load(days=30){const d=await fetch('/api/summary?days='+days,{cache:'no-store'}).then(r=>r.json());
const base='仅本机访问 · Tokens 为 DC 工具载荷的估算文本量，不等同于模型账单 Token';
document.getElementById('subtitle').textContent=base+(d.recovery?.imported?' · 已恢复历史 '+f(d.recovery.imported)+' 次调用':'');
const failRate=d.range.calls?(d.range.failures/d.range.calls*100):0;const cards=[['区间 Tokens',f(d.range.totalTokens),(days===1?'今日':days+' 天')+' · 日均 '+f(Math.round(d.range.totalTokens/Math.max(1,d.byDay.filter(x=>x.calls>0).length)))],['今日 Tokens',f(d.today.totalTokens),'实时累计'],['调用次数',f(d.range.calls),'失败 '+f(d.range.failures)+' 次 · '+failRate.toFixed(2)+'%'],['输入 / 输出',f(d.range.inputTokens)+' / '+f(d.range.outputTokens),'工具载荷结构'],['载荷流量',fb(d.range.totalBytes),'输入 '+fb(d.range.inputBytes)+' · 输出 '+fb(d.range.outputBytes)],['平均耗时',f(d.range.avgDurationMs)+' ms','累计 '+f(d.range.durationMs)+' ms']];
document.getElementById('cards').innerHTML=cards.map(x=>'<div class="card"><div class="k">'+x[0]+'</div><div class="v">'+x[1]+'</div><div class="meta">'+x[2]+'</div></div>').join('');
dailyChart(d.byDay);hourlyChart(d.byHour);
document.getElementById('tools').innerHTML=table(d.tools);document.getElementById('tasks').innerHTML=table(d.tasks);
document.getElementById('recent').innerHTML=d.recent.map(x=>'<tr><td>'+new Date(x.ts).toLocaleString()+'</td><td>'+esc(x.taskLabel||'未标注')+'</td><td>'+esc(x.tool)+'</td><td class="'+(x.status==='error'?'bad':'ok')+'">'+esc(x.status)+'</td><td>'+f(x.inputTokens)+'</td><td>'+f(x.outputTokens)+'</td><td>'+f(x.durationMs)+' ms</td></tr>').join('');
}
document.querySelectorAll('button[data-d]').forEach(b=>b.onclick=()=>{document.querySelectorAll('button[data-d]').forEach(x=>x.classList.remove('on'));b.classList.add('on');load(Number(b.dataset.d))});
addEventListener('resize',()=>{clearTimeout(window.__rt);window.__rt=setTimeout(()=>load(Number(document.querySelector('button.on').dataset.d)),100)});document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(Number(document.querySelector('button.on').dataset.d))});setInterval(()=>{if(!document.hidden)load(Number(document.querySelector('button.on').dataset.d))},5000);load();
</script></main></body></html>`;

export class DCStatsServer {
    constructor() {
        this.host = DEFAULT_HOST;
        this.port = Math.max(1, Number(process.env.DC_STATS_PORT) || DEFAULT_PORT);
        this.dir = statsRoot();
        this.server = null;
        this.writeChain = Promise.resolve();
        this.recoveryPromise = null;
    }

    async record(event) {
        if (process.env.DC_STATS_SERVER !== 'true') return;
        if (this.recoveryPromise) await this.recoveryPromise.catch(() => null);
        const row = { ...event, ts: event.ts || Date.now(), source: event.source || 'live' };
        const file = path.join(this.dir, 'traffic-' + localDay(row.ts) + '.jsonl');
        const write = this.writeChain.catch(() => {}).then(async () => {
            await fs.mkdir(this.dir, { recursive: true });
            await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
        });
        this.writeChain = write.catch((error) => {
            console.warn('[DC stats] could not append traffic row:', error?.message || error);
        });
        return write;
    }

    start() {
        if (this.server || process.env.DC_STATS_SERVER !== 'true' || process.env.DC_STATS_DISABLE === '1') return;
        this.recoveryPromise = process.env.DC_STATS_SKIP_RECOVERY === '1'
            ? Promise.resolve(null)
            : recoverExistingHistory(this.dir).then((state) => {
                if (state?.imported) console.log('[DC stats] recovered ' + state.imported + ' historical calls');
                return state;
            }).catch((error) => {
                console.warn('[DC stats] history recovery skipped:', error?.message || error);
                return null;
            });
        this.server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url || '/', 'http://' + this.host);
                if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
                if (url.pathname === '/health') return json(res, 200, { ok: true, host: this.host, port: this.port });
                if (url.pathname === '/api/ui-version') return json(res, 200, { version: await dashboardVersion() });
                if (url.pathname === '/api/summary') {
                    const days = parseDays(url);
                    const recovery = this.recoveryPromise ? await this.recoveryPromise : null;
                    const events = await readEvents(this.dir, days);
                    return json(res, 200, { ...aggregate(events, days), recovery });
                }
                if (url.pathname === '/' || url.pathname === '/index.html') {
                    const body = await dashboardPage();
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Content-Length': Buffer.byteLength(body),
                        'Cache-Control': 'no-store',
                        'X-Content-Type-Options': 'nosniff'
                    });
                    return res.end(body);
                }
                return json(res, 404, { error: 'not found' });
            } catch (error) {
                return json(res, 500, { error: error?.message || String(error) });
            }
        });
        this.server.on('error', (error) => {
            console.warn('[DC stats] local dashboard unavailable:', error?.message || error);
            this.server = null;
        });
        this.server.listen(this.port, this.host, () => {
            console.log('[DC stats] http://' + this.host + ':' + this.port);
        });
    }

    async close() {
        if (this.recoveryPromise) await this.recoveryPromise.catch(() => null);
        await this.writeChain.catch(() => null);
        const server = this.server;
        this.server = null;
        if (!server) return;
        await new Promise((resolve) => server.close(() => resolve()));
    }
}

export const dcStats = new DCStatsServer();
