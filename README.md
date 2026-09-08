# dsh-scheduled-send

DSH 插件：定时发送。在输入框打好草稿后点 ⏰，选择时间（默认当前时间 + 5 分钟）与可选模型，
确认后草稿转为定时任务并清空输入框（不立即发送）；到点后消息以**正常用户气泡**出现在
创建时的会话中并触发模型响应。

## 功能

- ⏰ 按钮挂在 `conversation.input.right`（与发送按钮同行的工具行）。
  弹出时间确认（datetime-local，默认 = 当前时间 + 5 分钟）+ 可选模型下拉。
- 已排程条目挂在 `conversation.input.dock`（输入框上方）：
  - 多条按 sendAt 升序；
  - 每条 = 等宽字体完整源文（`whiteSpace: pre-wrap` + `fontFamily: monospace`，
    保留换行/缩进/Markdown 源码）+ 计划时间（本地时区 `YYYY-MM-DD HH:mm`）+ 倒计时 + 取消按钮；
  - 超过 3 条折叠为「N 条定时任务 ⌄」，可点开展开。
- 创建成功后**无需刷新立即显示**（POST 返回后本地立即入列）。
- 到点投递：宿主侧用真实用户消息形状（`role: 'user'` + 新 UUID id + `source: {kind: 'user', via: 'dsh-scheduled-send'}`）
  经 `agent.runMaintenance(() => agent.followup(message))` 注入原会话 —— 与真实发送路径一致，
  渲染为正常用户气泡并触发模型响应。
- 指定模型：创建时可从模型目录选模型存入任务；到点先由客户端 `dir.select` 切换再发送；
  切换失败（客户端离线/超时 15s）降级按当前模型发送，并在条目上提示「模型切换失败」。
- 会话绑定：任务持久化 `conversationId`（`<dataDir>/tasks.json`，默认 `$HOME/.dsh/dsh-scheduled-send`），
  重启后恢复队列并向**原会话**补发；会话不在线时保留原到期时间，会话恢复即补发。

## 安装

```bash
dsh plugin --profile web add /home/otto/repos/dsh-scheduled-send
```

然后重启 DSH Web GUI。

## 使用

1. 在输入框输入内容（支持多行/Markdown 源码）。
2. 点输入框工具行的 ⏰ → 确认时间（默认 +5 分钟）→ 可选选择模型 → 确认。
3. 输入框被清空；输入框上方出现已排程条目（含倒计时），可随时取消。
4. 到点后消息以你的正常用户气泡出现在当前会话并触发模型响应。

## 开发

```bash
npm test            # 全量测试（node --test）
npm run build       # 重新生成 lib/client.js（改 src/client-*.js 后必须执行）
```

结构：`src/scheduler.js`（持久化队列/补发/退避）、`src/delivery.js`（kind:'user' 气泡注入 +
模型切换）、`src/host-routes.js`（state/schedule/model-selected 三路由 + 切换协调 hub）、
`src/client-core.js`（纯逻辑：排序/折叠/即时入列）、`src/client-view.js`（⏰ 按钮 + dock 列表）、
`lib/client.js`（由 `scripts/build-client.mjs` 生成的 web bundle）。

## 限制

- 到点投递要求创建时的会话在 DSH 宿主中处于活跃状态；不活跃则保留任务，会话恢复后补发。
- 模型切换依赖浏览器客户端在线轮询（~3s）；离线时降级按当前模型发送并提示。
- 不发布 npm；本地路径安装。
