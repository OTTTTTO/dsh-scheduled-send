# 定时发送 Scheduled Send (`@ottttto/dsh-scheduled-send`)

> **EN**: A DeepSeek Harness (DSH) web plugin that sends your drafted message at a chosen time — as you, unattended, in the original conversation, with offline catch-up delivery. 中文说明如下。

**到点以你的身份发送、无人值守、会话隔离、断电补发** —— 在 DSH Web 输入框打好草稿，点 ⏰ 选个时间，到点后消息以**正常用户气泡**出现在原会话中并自动触发模型响应。

## 特性

- ⏰ **定时按钮**：挂在输入框工具行（与发送按钮同行），弹出时间确认（`datetime-local`，默认当前时间 + 5 分钟）。
- 📋 **折叠列表**：已排程任务挂在输入框上方，按到期时间升序；多条时常显最先到期 1 条 + 「其余 N 条 ⌄」可展开/收起；任意条数均可手动折叠；移动端（≤480px）默认收起。
- ✉️ **以你的身份发送**：到点投递走与真实发送一致的路径（`role: 'user'` 气泡 + `followup`），渲染为正常用户消息并触发模型响应。
- 🔒 **会话隔离**：任务绑定创建时的会话（`conversationId`），切换会话只看到该会话的任务，互不串扰。
- 🔁 **断电补发**：任务持久化在本地（`<dataDir>/tasks.json`），重启 DSH 后恢复队列并向原会话补发；会话不在线时保留任务，会话恢复即补发。
- ✕ **一键取消**：列表中每条任务均可随时取消。
- 📱 **移动端适配**：近全宽弹窗、≥40px 触控高度、防横向溢出。

## 安装

```bash
dsh plugin --profile web add @ottttto/dsh-scheduled-send@0.2.0
```

然后重启 DSH Web GUI。

## 使用

1. 在输入框输入内容（支持多行 / Markdown 源码）。
2. 点输入框工具行的 **⏰** → 确认时间（默认 +5 分钟）→ 确认。
3. 输入框被清空；上方出现已排程条目（含计划时间与倒计时），可随时点取消。
4. 到点后消息以你的正常用户气泡出现在**创建时的会话**并触发模型响应。

## 隐私

- **无遥测**：不发起任何统计、上报或第三方网络请求。
- **数据本地**：定时任务仅持久化在本机 `<dataDir>/tasks.json`（默认 `$HOME/.dsh/dsh-scheduled-send`），不上传任何内容。

## 限制

- 模型切换功能已移除（v0.2.0 起不再支持为定时任务指定模型）；旧任务中的 `model` 字段被忽略，照常投递。
- 到点投递要求创建时的会话在 DSH 宿主中处于活跃状态；不活跃则保留任务，会话恢复即补发。

## 开发

```bash
npm test            # 全量测试（node --test）
npm run build       # 重新生成 lib/client.js（改 src/client-*.js 后必须执行）
```

结构：`src/scheduler.js`（持久化队列/补发/退避）、`src/delivery.js`（kind:'user' 气泡注入）、
`src/host-routes.js`（state/schedule 路由）、`src/client-core.js`（纯逻辑）、
`src/client-view.js`（⏰ 按钮 + dock 列表）、`lib/client.js`（构建产物）。

## License

MIT © ottttto
