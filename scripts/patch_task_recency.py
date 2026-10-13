from pathlib import Path
import re

p = Path(__file__).resolve().parent.parent / "overrides" / "dc-stats-dashboard.html"
s = p.read_text(encoding="utf-8")
def replace_one(a, b):
    global s
    count = s.count(a)
    if count != 1:
        raise RuntimeError(f"Expected 1 occurrence, got {count}: {a[:90]!r}")
    s = s.replace(a, b, 1)

replace_one(
    ".panel-actions{display:flex;align-items:center;gap:7px}.search{width:150px;padding-right:9px;font-size:11px}",
    ".panel-actions{display:flex;align-items:center;gap:7px}.search{width:150px;padding-right:9px;font-size:11px}.task-rank-head{flex-wrap:wrap}.task-rank-head .panel-actions{margin-left:auto}.task-sort{width:106px;padding-right:4px;cursor:pointer}",
)
replace_one(
    '<section class="panel"><div class="panel-head"><div><h2>任务 / 子 Agent 排行</h2><div class="hint">输入 / 输出同时保留 · 点击行筛选</div></div><input class="search" id="taskSearch" placeholder="搜索任务"></div><div class="scroll" id="tasks"></div></section>',
    '<section class="panel"><div class="panel-head task-rank-head"><div><h2>任务 / 子 Agent 排行</h2><div class="hint" id="taskRankHint">近期优先 · 点击行筛选</div></div><div class="panel-actions"><select class="search task-sort" id="taskSort" aria-label="任务排序方式"><option value="weighted">近期优先</option><option value="total">累计优先</option></select><input class="search" id="taskSearch" placeholder="搜索任务"></div></div><div class="scroll" id="tasks"></div></section>',
)
replace_one(
    "toolSearch:'',taskSearch:''};let data=null,loadSeq=0;",
    "toolSearch:'',taskSearch:'',taskSort:'weighted'};let data=null,loadSeq=0,rankRequestId=0,rankSnapshot={key:'',fetchedAt:0,day:new Map(),week:new Map()};",
)

old_start = s.index("function rankRows(kind){")
old_end = s.index("\n\nfunction trendSeries()", old_start)
new_functions = """function rankReady(){return state.days>1&&!state.filters.day&&rankSnapshot.key===query()}
function rankValue(kind,row){const m=metrics[state.metric],raw=m.value(row);if(kind!=='task'||state.taskSort!=='weighted'||!rankReady())return raw;const day=m.value(rankSnapshot.day.get(row.name)),week=m.value(rankSnapshot.week.get(row.name));return .5*day+.3*week/Math.min(7,state.days)+.2*raw/state.days}
function rankRows(kind){const rows=[...(kind==='tool'?data.tools:data.tasks)];return rows.sort((a,b)=>rankValue(kind,b)-rankValue(kind,a)||b.calls-a.calls)}
function renderRank(kind){const box=$('#'+(kind==='tool'?'tools':'tasks')),search=(kind==='tool'?state.toolSearch:state.taskSearch).trim().toLowerCase(),m=metrics[state.metric],weighted=kind==='task'&&state.taskSort==='weighted'&&rankReady(),rows=rankRows(kind).filter(x=>!search||x.name.toLowerCase().includes(search)).slice(0,60),max=Math.max(1,...rows.map(x=>rankValue(kind,x)));if(kind==='task'){$('#taskSort').value=state.taskSort;$('#taskRankHint').textContent=state.taskSort==='total'?'按区间累计值排序 · 点击行筛选':state.days===1||state.filters.day?'单日范围 · 按实际值排序':weighted?'权重：今日 50% · 近7日日均 30% · 区间日均 20%':'正在计算近期权重…'}if(!rows.length){box.innerHTML='<div class="empty">没有匹配数据</div>';return}box.innerHTML='<table><thead><tr><th>名称</th><th>'+m.label+'</th>'+(weighted?'<th title="今日50% + 近7日日均30% + 所选区间日均20%">加权日均</th>':'')+'<th>调用</th><th>失败</th><th>平均耗时</th></tr></thead><tbody>'+rows.map(x=>'<tr class="rank-row '+(state.filters[kind]===x.name?'on':'')+'" data-kind="'+kind+'" data-name="'+esc(x.name)+'"><td class="rank-name"><div class="rank-title">'+esc(x.name)+'</div><div class="rank-sub">输入 '+f(x.outputTokens)+' · 输出 '+f(x.inputTokens)+'</div><div class="rank-bar"><i style="width:'+Math.max(2,rankValue(kind,x)/max*100).toFixed(1)+'%"></i></div></td><td class="main-val">'+m.fmt(m.value(x))+'</td>'+(weighted?'<td title="按近期活动加权的日均值">'+m.fmt(rankValue(kind,x))+'</td>':'')+'<td>'+f(x.calls)+'</td><td class="'+(x.failures?'bad':'')+'">'+f(x.failures)+'</td><td>'+fd(x.avgDurationMs)+'</td></tr>').join('')+'</tbody></table>';box.querySelectorAll('.rank-row').forEach(r=>r.onclick=()=>setFilter(r.dataset.kind,r.dataset.name))}
async function refreshTaskRank(){if(!data||state.taskSort!=='weighted'||state.days===1||state.filters.day)return;const key=query();if(rankSnapshot.key===key&&Date.now()-rankSnapshot.fetchedAt<30000)return;const seq=++rankRequestId;try{const getRows=async days=>{if(days===state.days)return data.tasks;const q=new URLSearchParams(key);q.set('days',String(days));const res=await fetch('/api/summary?'+q.toString(),{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);return(await res.json()).tasks};const dayRows=await getRows(1),weekRows=await getRows(Math.min(7,state.days));if(seq!==rankRequestId||key!==query())return;rankSnapshot={key,fetchedAt:Date.now(),day:new Map(dayRows.map(r=>[r.name,r])),week:new Map(weekRows.map(r=>[r.name,r]))};renderRank('task')}catch(e){if(seq===rankRequestId)$('#taskRankHint').textContent='近期排序加载失败，暂按累计值排序'}}
"""
s = s[:old_start] + new_functions + s[old_end:]
replace_one(
    "data=next;data.scope=data.scope||data.range;renderAll()}catch(e)",
    "data=next;data.scope=data.scope||data.range;renderAll();refreshTaskRank()}catch(e)",
)
replace_one(
    "$('#toolSearch').oninput=e=>{state.toolSearch=e.target.value;renderRank('tool')};$('#taskSearch').oninput=e=>{state.taskSearch=e.target.value;renderRank('task')};",
    "$('#toolSearch').oninput=e=>{state.toolSearch=e.target.value;renderRank('tool')};$('#taskSearch').oninput=e=>{state.taskSearch=e.target.value;renderRank('task')};$('#taskSort').onchange=e=>{state.taskSort=e.target.value;renderRank('task');refreshTaskRank()};",
)
# The donut is still an unweighted composition of actual recorded values.
replace_one("source=rankRows(kind).filter(r=>m.value(r)>0)", "source=[...(kind==='tool'?data.tools:data.tasks)].sort((a,b)=>m.value(b)-m.value(a)).filter(r=>m.value(r)>0)")
p.write_text(s, encoding="utf-8")
print("Patched", str(p), "bytes", len(s.encode("utf-8")))
