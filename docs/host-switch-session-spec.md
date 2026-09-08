# Doublecheck spec

## Goal
dsh-scheduled-send 三项修复：到点切模型改为宿主侧执行（GUI 关闭也可用，客户端路径仅兜底）；已排程列表按会话隔离（每个会话只见自己的任务，经 state 路由按 conversationId 过滤或客户端按 sessionId 过滤）；模型切换失败等提示不再常驻（投递完成后有限期显示或可关闭，不永久留在 dock）。

## Scope
改 src/{scheduler,delivery,host-routes,index,client-core,client-view}.js 与 lib/client.js 重建；宿主侧切换需调研 dsh 宿主的模型配置入口（agentDefaultModel/会话 config/agent/request waterfall 的 currentSelection 写路径）并采用最可靠者；测试先红后绿，全量 0 失败。

## Acceptance criteria
1) 到点时宿主直接完成模型切换再发送（无人值守可用），切换成功条目不出现失败提示；2) 会话 A 创建的任务在会话 B 的 dock 不可见，A 中可见；state 路由支持按 conversationId 过滤或客户端过滤，且取消/补发仍限定原会话；3) 切换失败提示只在相关任务条目上显示且可关闭/超时消失，不污染其他条目与后续新任务；4) 既有验收（用户气泡、升序折叠、等宽源文、重启补发）不回归；5) npm test 0 失败。

## Failure modes
宿主切换入口不可用/失败：降级当前模型发送+可关闭提示（现语义保留）；过滤后空列表：dock 不渲染占位；客户端旧缓存混入他會话任务：以 conversationId 严格匹配清除。

## Priorities
无人值守可靠切换 > 会话隔离 > 提示清理。

## Non-goals
不做跨会话任务管理 UI、不做重复规则。
