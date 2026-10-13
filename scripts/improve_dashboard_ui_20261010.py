from pathlib import Path

p = Path(__file__).resolve().parent.parent / "overrides" / "dc-stats-dashboard.html"
s = p.read_text(encoding="utf-8")

def change(old, new, expected=1):
    global s
    n=s.count(old)
    if n != expected:
        raise RuntimeError(f"Expected {expected} match(es), found {n}: {old[:130]!r}")
    s=s.replace(old,new,expected)

# Names accurately describe tool-call payloads, not full LLM prompt/reasoning consumption.
change('<option value="totalTokens">总 Tokens</option><option value="modelInput">模型输入 Tokens</option><option value="modelOutput">模型输出 Tokens</option>',
       '<option value="totalTokens">总 Tokens（估算）</option><option value="modelInput">工具返回 Tokens</option><option value="modelOutput">工具参数 Tokens</option>')
change('<th>模型输入</th><th>模型输出</th>', '<th>工具返回</th><th>工具参数</th>')
change('<option value="weighted">近期优先</option><option value="total">累计优先</option>',
       '<option value="weighted">近期优先</option><option value="today">今日优先</option><option value="week">7天优先</option><option value="total">累计优先</option>')
change("totalTokens:{label:'总 Tokens',value:r=>r?.totalTokens||0,fmt:f},modelInput:{label:'模型输入 Tokens',value:r=>r?.outputTokens||0,fmt:f},modelOutput:{label:'模型输出 Tokens',value:r=>r?.inputTokens||0,fmt:f}",
       "totalTokens:{label:'总 Tokens（估算）',value:r=>r?.totalTokens||0,fmt:f},modelInput:{label:'工具返回 Tokens',value:r=>r?.outputTokens||0,fmt:f},modelOutput:{label:'工具参数 Tokens',value:r=>r?.inputTokens||0,fmt:f}")
change("['totalTokens','总 Tokens',f(r.totalTokens)", "['totalTokens','总 Tokens（估算）',f(r.totalTokens)")
change("['modelInput','模型输入 Tokens',f(r.outputTokens),'工具结果 · '+pct(r.outputTokens,total)+'%']", "['modelInput','工具返回 Tokens',f(r.outputTokens),'返回文本 · '+pct(r.outputTokens,total)+'%']")
change("['modelOutput','模型输出 Tokens',f(r.inputTokens),'工具参数 · '+pct(r.inputTokens,total)+'%']", "['modelOutput','工具参数 Tokens',f(r.inputTokens),'参数文本 · '+pct(r.inputTokens,total)+'%']")
change("[{label:'模型输入',value:r=>r.outputTokens||0,color:'#3978e6'},{label:'模型输出',value:r=>r.inputTokens||0,color:'#7b68d9'}]",
       "[{label:'工具返回',value:r=>r.outputTokens||0,color:'#3978e6'},{label:'工具参数',value:r=>r.inputTokens||0,color:'#7b68d9'}]")
change("?'Token 趋势 · 输入 / 输出':m.label+'趋势'", "?'Token 趋势 · 返回 / 参数':m.label+'趋势'")
change("$('#scope').textContent=hasFilters()?('筛选后 '+f(r)+' 次 / 范围 '+f(s)+' 次 · '+pct(r,s)+'%'):('范围内 '+f(s)+' 次调用');",
       "const t=data?.generatedAt?new Date(data.generatedAt).toLocaleTimeString('zh-CN',{hour12:false}):'--',latest=(data?.recent||[]).reduce((v,x)=>Math.max(v,Date.parse(x.ts)||0),0),ago=latest?Math.max(0,Date.now()-latest):null,last=ago==null?'无近期明细':ago<60000?'刚刚':ago<3600000?Math.floor(ago/60000)+'分钟前':ago<86400000?Math.floor(ago/3600000)+'小时前':Math.floor(ago/86400000)+'天前';$('#scope').textContent=(hasFilters()?('筛选后 '+f(r)+' / '+f(s)+' 次 · '+pct(r,s)+'%'):('范围内 '+f(s)+' 次调用'))+' · 更新 '+t+' · 最近 '+last;$('#scope').title='Token 为工具参数与返回文本的估算量，不代表模型完整上下文或推理用量';")

start=s.index("function rankValue(kind,row){")
end=s.index("\n\nfunction trendSeries()",start)
new="""function rankValue(kind,row){const m=metrics[state.metric],raw=m.value(row);if(kind!=='task'||state.taskSort==='total'||!rankReady())return raw;const day=m.value(rankSnapshot.day.get(row.name)),week=m.value(rankSnapshot.week.get(row.name));if(state.taskSort==='today')return day;if(state.taskSort==='week')return week/Math.min(7,state.days);return .5*day+.3*week/Math.min(7,state.days)+.2*raw/state.days}
function rankRows(kind){const rows=[...(kind==='tool'?data.tools:data.tasks)];return rows.sort((a,b)=>rankValue(kind,b)-rankValue(kind,a)||b.calls-a.calls)}
function renderRank(kind){const box=$('#'+(kind==='tool'?'tools':'tasks')),search=(kind==='tool'?state.toolSearch:state.taskSearch).trim().toLowerCase(),m=metrics[state.metric],weighted=kind==='task'&&state.taskSort!=='total'&&rankReady(),rows=rankRows(kind).filter(x=>!search||x.name.toLowerCase().includes(search)).slice(0,60),max=Math.max(1,...rows.map(x=>rankValue(kind,x))),mode=state.taskSort,scoreLabel=mode==='weighted'?'加权日均':mode==='today'?'今日值':'7日日均';if(kind==='task'){$('#taskSort').value=mode;$('#taskRankHint').textContent=mode==='total'?'按区间累计值排序 · 点击行筛选':state.days===1||state.filters.day?'单日范围 · 按实际值排序':weighted?(mode==='weighted'?'今日50% · 7日日均30% · 区间日均20%':mode==='today'?'按今日实际使用排序':'按近7日日均排序'):'正在计算近期活动…'}if(!rows.length){box.innerHTML='<div class="empty">没有匹配数据</div>';return}box.innerHTML='<table><thead><tr><th>名称</th><th>'+m.label+'</th>'+(weighted?'<th title="以所选指标计算的近期活动值">'+scoreLabel+'</th>':'')+'<th>调用</th><th>失败</th><th>平均耗时</th></tr></thead><tbody>'+rows.map(x=>'<tr class="rank-row '+(state.filters[kind]===x.name?'on':'')+'" data-kind="'+kind+'" data-name="'+esc(x.name)+'"><td class="rank-name"><div class="rank-title" title="'+esc(x.name)+'">'+esc(x.name)+'</div><div class="rank-sub">返回 '+f(x.outputTokens)+' · 参数 '+f(x.inputTokens)+(kind==='task'&&rankReady()?' · 今日 '+f(rankSnapshot.day.get(x.name)?.calls||0)+'次 · 7天 '+f(rankSnapshot.week.get(x.name)?.calls||0)+'次':'')+'</div><div class="rank-bar"><i style="width:'+Math.max(2,rankValue(kind,x)/max*100).toFixed(1)+'%"></i></div></td><td class="main-val">'+m.fmt(m.value(x))+'</td>'+(weighted?'<td title="近期活动排序值">'+m.fmt(rankValue(kind,x))+'</td>':'')+'<td>'+f(x.calls)+'</td><td class="'+(x.failures?'bad':'')+'">'+f(x.failures)+'</td><td>'+fd(x.avgDurationMs)+'</td></tr>').join('')+'</tbody></table>';box.querySelectorAll('.rank-row').forEach(r=>r.onclick=()=>setFilter(r.dataset.kind,r.dataset.name))}
async function refreshTaskRank(){if(!data||state.taskSort==='total'||state.days===1||state.filters.day)return;const key=query();if(rankSnapshot.key===key&&Date.now()-rankSnapshot.fetchedAt<30000)return;if(rankPendingKey===key)return;rankPendingKey=key;const seq=++rankRequestId;try{const getRows=async days=>{if(days===state.days)return data.tasks;const q=new URLSearchParams(key);q.set('days',String(days));const res=await fetch('/api/summary?'+q.toString(),{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);return(await res.json()).tasks};const [dayRows,weekRows]=await Promise.all([getRows(1),getRows(Math.min(7,state.days))]);if(seq!==rankRequestId||key!==query())return;rankSnapshot={key,fetchedAt:Date.now(),day:new Map(dayRows.map(r=>[r.name,r])),week:new Map(weekRows.map(r=>[r.name,r]))};renderRank('task')}catch(e){if(seq===rankRequestId)$('#taskRankHint').textContent='近期数据加载失败，暂按累计值排序'}finally{if(rankPendingKey===key)rankPendingKey=''}}
"""
s=s[:start]+new+s[end:]
change("const rows=data.recent||[];$('#recentHint')", "const rows=[...(data.recent||[])].sort((a,b)=>(Date.parse(b.ts)||0)-(Date.parse(a.ts)||0));$('#recentHint')")
p.write_text(s,encoding="utf-8")
print("UPDATED",p,len(s))
