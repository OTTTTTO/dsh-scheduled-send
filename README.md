# dsh-scheduled-send

DSH 插件：定时发送。在输入框打好草稿后点 ⏰，选择时间（默认当前时间 + 5 分钟），
确认后草稿转为定时任务并清空输入框（不立即发送）；到点后消息以**正常用户气泡**出现在
创建时的会话中并触发模型响应。

## 功能

- ⏰ 按钮挂在 `conversation.input.right`（与发送按钮同行的工具行）。
  弹出时间确认（datetime-local，默认 = 当前时间 + 5 分钟）。
- 已排程条目挂在 `conversation.input.dock`（输入框上方）：
  - 多条按 sendAt 升序；
  - 每条 = 等宽字体完整源文（`whiteSpace: pre-wrap` + `fontFamily: monospace`，
    保留换行/缩进/Markdown 源码）+ 计划时间（本地时区 `YYYY-MM-DD HH:mm`）+ 倒计时 + 取消按钮；
  - 折叠策略：>1 条时常显 sendAt 最近（最先到期）1 条 + 「其余 N 条定时任务 ⌄」，
    点开全量、再点收起；任意条数（含 1 条）都可手动折叠；移动端（≤480px）默认收起。
- 切换会话时 dock 立即重新拉取目标会话的任务（`?conversationId=` 过滤）；
  拉取失败保留上一次数据并显示错误提示，不闪空。
- 创建成功后**无需刷新立即显示**（POST 成功即以服务端返回条目入列，id 去重；
  失败不入列并保留表单）。
- 到点投递：宿主侧用真实用户消息形状（`role: 'user'` + 新 UUID id + `source: {kind: 'user', via: 'dsh-scheduled-send'}`）
  经 `agent.runMaintenance(() => agent.followup(message))` 注入原会话 —— 与真实发送路径一致，
  渲染为正常用户气泡并触发模型响应。
- 会话绑定：任务持久化 `conversationId`（`<dataDir>/tasks.json`，默认 `$HOME/.dsh/dsh-scheduled-send`），
  重启后恢复队列并向**原会话**补发；会话不在线时保留原到期时间，会话恢复即补发。
- 移动端（≤480px）：popover 近全宽弹出、按钮/输入触控高度 ≥40px、
  条目允许纵向换行但禁横向溢出（`maxWidth:100%` + `word-break`）。
- 模型切换功能已彻底移除（UI/路由/投递路径）；旧 `tasks.json` 中含 `model` 字段的任务
  照常投递（字段被忽略，不报错）。

## 安装

```bash
dsh plugin --profile web add /home/otto/repos/dsh-scheduled-send
```

然后重启 DSH Web GUI。

## 使用

1. 在输入框输入内容（支持多行/Markdown 源码）。
2. 点输入框工具行的 ⏰ → 确认时间（默认 +5 分钟）→ 确认。
3. 输入框被清空；输入框上方出现已排程条目（含倒计时），可随时取消。
4. 到点后消息以你的正常用户气泡出现在当前会话并触发模型响应。

## 开发

```bash
npm test            # 全量测试（node --test）
npm run build       # 重新生成 lib/client.js（改 src/client-*.js 后必须执行）
```

结构：`src/scheduler.js`（持久化队列/补发/退避）、`src/delivery.js`（kind:'user' 气泡注入）、
`src/host-routes.js`（state/schedule 路由）、`src/client-core.js`（纯逻辑：排序/折叠/即时入列/会话切换）、
`src/client-view.js`（⏰ 按钮 + dock 列表 + 移动端自适应）、
`lib/client.js`（由 `scripts/build-client.mjs` 生成的 web bundle）。

## 限制

- 到点投递要求创建时的会话在 DSH 宿主中处于活跃状态；不活跃则保留任务，会话恢复即补发。
- 不发布 npm；本地路径安装。
