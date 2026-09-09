# Doublecheck spec

## Goal
将 dsh-scheduled-send v0.2.0 以 @ottttto/dsh-scheduled-send 发布：npm 公开包 + github.com/OTTTTTO/dsh-scheduled-send（Pages 承载 DSH Community Market Path A 目录 JSON）+ awesome-dsh-plugin 收录 PR 文案，完成全部可由本机执行的准备工作与发布动作（npm publish 与 git push 由用户在终端执行或明确授权执行）。

## Scope
改 package.json（scoped 名、版本 0.2.0、repository/keywords/author/license）、README 双语发布版、catalog/catalog-source.json 与 catalog/v1/plugins.json（Path A schema）、发布检查单 docs/release-checklist.md、awesome PR 文案 docs/awesome-entry.md；本地验证（npm pack、catalog JSON schema 自检、版本一致性检查脚本可选）。不改变插件功能代码与测试。

## Acceptance criteria
1) npm pack 产物含 src/lib/cordis.patch.yml/package.json/README，无测试与 .tmp；2) package.json name=@ottttto/dsh-scheduled-send version=0.2.0 repository 指向 GitHub 仓库；3) catalog-source.json 与 plugins.json 符合官方 schema 最小能力（q/category/cursor/limit，条目含 id/name/displayName/summary/package.registry=npm）；npm 包名与目录条目一致且版本同为 0.2.0；4) manifest URL 与 /v1/plugins 同源（https://ottttto.github.io/dsh-scheduled-send/...）且 HTTPS；5) awesome PR 文案中英双语含一句卖点+安装命令；6) npm test 0 失败不回归；7) 用户终端执行清单：npm login/publish、git remote add + push、开 Pages、验证市场安装，全部写入 release-checklist 且逐步可跟随。

## Failure modes
npm 裸名/scoped 名冲突：发布前 npm view 预检，冲突则中止并报告；GitHub 用户名大小写/仓库已存在：push 前确认远端状态；Pages 未开：目录不可达时市场 fail-closed，检查单含验证步骤；发布后改代码：版本与目录失同步——检查单强制「发布即冻结 0.2.0，改动进下个版本」。

## Priorities
可跟随的发布流程>目录元数据丰富度；三层版本严格同步>速度。

## Non-goals
不做 Path B adapter、不做图标/媒体资源、不自动执行 npm publish（需用户登录态，绝不索取 token）、不改插件功能。
