# Doublecheck spec

## Goal
优化 dsh-scheduled-send 交互视觉：⏰按钮加「定时」文字标签；popover 打开期间输入框区域显示蓝色描边+「定时发送中」角标（叠加样式层实现）；时间/模型确认改为浮层卡片（圆角阴影分区、亮暗适配），功能行为与既有测试契约不变。

## Scope
仅改 src/client-view.js 的按钮/角标/popover 样式与 lib/client.js 重建；不改 client-core 逻辑、宿主侧、路由与调度行为。

## Acceptance criteria
1) ⏰按钮渲染为「⏰ 定时」带文字；2) popover 打开时输入框区域出现描边+角标「定时发送中」，关闭（确认/取消）后消失；3) popover 为浮层卡片：标题「定时发送」、时间区/模型区/按钮区分区、圆角阴影、亮暗配色；4) 既有 42 项测试锚点不破坏，新增按钮文字/角标开关测试先红后绿；5) 重建后全量 npm test 0 失败。

## Failure modes
叠加描边与宿主布局冲突：退化为仅角标（描边省略）不报错；暗色误判：维持现有 prefers-color-scheme 回退。

## Priorities
行为不变 > 警示清晰 > 装饰。

## Non-goals
不做常驻任务数角标、不改 dock 列表样式、不引入 CSS 框架。
