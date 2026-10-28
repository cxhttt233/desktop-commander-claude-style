import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
const dir = process.env.LOCALAPPDATA;
const pkg = path.join(dir,'DesktopCommander','node_modules','@wonderwhy-er','desktop-commander','package.json');
const require = createRequire(pkg);
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const brokerPath = path.join(path.dirname(fileURLToPath(import.meta.url)),'anlan-mcp-broker.mjs');
const client = new Client({name:'anlan-broker-smoketest',version:'1.0.0'},{capabilities:{}});
const transport = new StdioClientTransport({command:process.execPath,args:[brokerPath],env:{...process.env,DC_WORKSPACE_ROOT:'C:\\Code',DC_STATS_SERVER:'false'},stderr:'inherit'});
const str=(r)=>r?.content?.find(c=>c.type==='text')?.text || '';
try{
  await client.connect(transport);
  const discovered=(await client.listTools()).tools;
  const tools=discovered.map(t=>t.name);
  const description=name=>discovered.find(t=>t.name===name)?.description || '';
  assert(description('start_process').includes('API/SDK'));
  assert.match(description('start_process'), /Verify the real outcome/);
  assert(description('get_config').includes('Prefer API/CLI'));
  assert(tools.includes('get_config') && tools.includes('agent_create') && tools.includes('agent_call'));
  console.log('DISCOVERY_OK tools='+tools.length);
  const cfg=await client.callTool({name:'get_config',arguments:{}});
  assert(!cfg.isError,'main get_config error '+str(cfg));
  console.log('MAIN_CALL_OK');
  if (process.platform === 'win32') {
    for (const gui of ['gui_status','gui_windows','gui_inspect','gui_action','gui_screenshot','gui_batch']) assert(tools.includes(gui), 'missing GUI tool: '+gui);
    assert.match(description('gui_screenshot'), /LAST-RESORT VISUAL FALLBACK/);
    assert.match(description('gui_batch'), /remote round trips/);
    const guiStatus = await client.callTool({name:'gui_status',arguments:{}});
    const status = JSON.parse(str(guiStatus));
    assert.equal(status.available, true, 'WinApp CLI missing');
    const windows = await client.callTool({name:'gui_windows',arguments:{}});
    assert(!windows.isError, 'gui_windows error '+str(windows));
    const desktopWindows=JSON.parse(str(windows)).data;
    assert(Array.isArray(desktopWindows), 'expected window list');
    const notepad=desktopWindows.find(w => w.processName === 'Notepad' && w.title);
    if (notepad) {
      const batch=await client.callTool({name:'gui_batch',arguments:{hwnd:String(notepad.hwnd),steps:[{tool:'gui_inspect',interactive:true}]}});
      assert(!batch.isError, 'gui_batch error '+str(batch));
      const answer=JSON.parse(str(batch));
      assert.equal(answer.completed_steps,1);
      console.log('GUI_BATCH_BROKER_OK duration_ms='+answer.duration_ms);
    }
    console.log('GUI_BROKER_OK');
  }
  const c=await client.callTool({name:'agent_create',arguments:{task_label:'隧道子任务并发隔离测试'}});
  assert(!c.isError,'create error '+str(c));
  const agentId=JSON.parse(str(c)).agent_id;
  console.log('AGENT_CREATE_OK '+agentId);
  const dirCall=await client.callTool({name:'agent_call',arguments:{agent_id:agentId,tool:'list_directory',args:{path:'C:\\Code\\desktop-commander-claude-style',depth:1}}});
  assert(!dirCall.isError,'agent_call error '+str(dirCall));
  assert(str(dirCall).includes('README.md'),'list directory result mismatch');
  console.log('AGENT_CALL_OK');
  const listed=await client.callTool({name:'agent_list',arguments:{}});
  assert(str(listed).includes(agentId),'agent list mismatch');
  console.log('AGENT_LIST_OK');
  const closed=await client.callTool({name:'agent_close',arguments:{agent_id:agentId}});
  assert(!closed.isError,'agent close error '+str(closed));
  console.log('AGENT_CLOSE_OK');
}finally{
 await client.close();
}
