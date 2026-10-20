# Anlan OpenAI Tunnel 本地 DC 与子 Agent

## 架构

- 原 Remote DC 继续独立运行，无需登录或使用 Remote MCP 月度调用额度。
- GPT Plus 自定义插件 -> OpenAI Tunnel -> `anlan-mcp-broker.mjs` -> 本地 Desktop Commander 0.2.50。
- 主 DC 的 26 个工具仍直接暴露；另有 `agent_create`、`agent_call`、`agent_list`、`agent_close`。
- 每个显式创建的 Agent 对应单独的 stdio DC 子进程及终端会话。相同任务名重复创建时复用原 Agent；最多 6 个（`ANLAN_MAX_AGENTS` 可改，最大 12）；空闲满 24 小时后清理。
- 不依赖 Remote `deviceId`、Remote Token 或 17891 端口进行 RPC。

## 17891

`anlan-local-stats.mjs` 以独立 Node 进程承载原定制统计面板，并从用户目录下的 Desktop Commander 统计 JSONL 读取聚合。
主 DC、子 Agent 不争用 17891。子 Agent 在 MCP 请求 `_meta` 中写入任务标签，因此现有统计面板的任务 / 子 Agent 排名可直接按任务区分。

Windows 本地访问 `http://127.0.0.1:17891`；`/health` 可验证服务健康。

## 一键 BAT 与切换

- 新 BAT 在 `scripts/Start-AnlanTunnel-Agents.bat`，并已复制到原 `tunnel-client.exe` 目录下。
- BAT 设置 7890 代理、`DC_WORKSPACE_ROOT=C:\Code`、最大 Agent 数量，先启动 17891（若端口未被占用），再启动 Tunnel 指向本地 Broker。
- **不要把 Runtime API Key 提交到 Git 或聊天中**。BAT 默认使用无效占位符；需填写重新创建的有效 Runtime Key。此前公开过的 Key 必须撤销。
- 切换时先停止当前单实例 Tunnel，再启动新 BAT。若想回滚，停止新 BAT 并使用以前的 `Start-AnlanTunnel-fixed.bat`。
- 两个启动脚本切勿同时运行同一个 Tunnel ID。

## 使用子 Agent

ChatGPT 插件工具更新后：

1. `agent_create({task_label:"工作台前端排查"})` 返回 `agent_id`。
2. `agent_call({agent_id:"返回的ID",tool:"list_directory",args:{path:"C:\\Code"}})`。
3. `agent_list({})` 查看所有当前 Agent。
4. `agent_close({agent_id:"返回的ID"})` 关闭空闲任务。

**限制：** OpenAI Tunnel 的请求未验证会稳定携带 ChatGPT 对话 ID，因此不自动按对话建立子 Agent，不把跨对话共享的全局默认 DC 当作隔离实例。需要隔离时显式选择 `agent_id`。Remote 的独立设备注册/可见子窗口仍只存在于 Remote 模式；本地模式不伪造 Remote 设备。

## 已测

- Broker 单独 stdio 测试：30 个工具注册，主工具调用、Agent 创建、Agent 工具调用、列出、关闭均通过。
- 任务归属日志：`ANLAN_AGENT_ATTRIBUTION_OK`，已记录 2 次带 Agent 任务标签的调用。
- 17891 健康检查：`ok: true`，监听 `127.0.0.1:17891`。
- 正式 Tunnel 切换及插件重新发现工具：**尚待用新的 BAT 完成**，不应将离线测试当作生产切换已完成。

测试脚本：
- `node scripts/test-anlan-mcp-broker.mjs`
- `node scripts/test-anlan-stats-attribution.mjs`

本地 Broker/统计模块仅有独立脚本改动，没有覆盖已安装的 DC `dist` 或现有 Remote 进程。
