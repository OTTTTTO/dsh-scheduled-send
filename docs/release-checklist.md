# Release Checklist — @ottttto/dsh-scheduled-send v0.2.0

> 本清单由用户在**自己的终端**逐步执行。任何步骤都不需要、也绝不应把 npm token / GitHub token 交给任何代理或脚本。
>
> 版本纪律：**发布即冻结**。`0.2.0` 发布后不再改动该版本的任何产物；后续改动一律进入 `0.3.0`（或补丁号），并同步更新 `package.json`、`catalog/v1/plugins.json` 的 `latestVersion` 与 README 安装命令，再重新走本清单。

## 0. 前置状态（本仓库已就绪）

- `package.json`：`@ottttto/dsh-scheduled-send@0.2.0`，`files` 仅含 `src/lib/cordis.patch.yml/package.json/README.md`。
- 目录源文件（本仓库内的权威副本）：
  - `catalog/catalog-source.json` → 发布为 `https://ottttto.github.io/dsh-scheduled-send/catalog-source.json`
  - `catalog/v1/plugins.json` → 发布为 `https://ottttto.github.io/dsh-scheduled-send/v1/plugins`
- Pages 服务副本（部署用，与上面同步）：`docs/catalog-source.json`、`docs/v1/plugins`（无扩展名，因为 Market 契约要求 endpoint 路径**必须**以 `/v1/plugins` 结尾）。
- 本地校验已通过：两份 catalog JSON 通过官方 Draft 2020-12 schema 校验；`npm pack --dry-run` 文件清单正确；`npm test` 55/55 通过。

## 1. npm 预检与登录

```bash
npm whoami                  # 已登录则显示用户名，跳过 npm login
npm login                   # 未登录时在浏览器完成（2FA 按提示）
npm view @ottttto/dsh-scheduled-send versions --json
# 期望：404（scoped 名尚未被占用）。若已存在 0.2.0，说明版本已发布——停止，改走下个版本。
```

## 2. 发布 npm 包（scoped 必须显式 public）

```bash
cd /path/to/dsh-scheduled-send
npm pack --dry-run          # 再次核对清单：只有 src/ lib/ cordis.patch.yml package.json README.md LICENSE*
npm publish --access public
npm view @ottttto/dsh-scheduled-send@0.2.0 dist.tarball   # 确认 registry 已可见
```

## 3. GitHub 建仓并推送

在 https://github.com/new 新建仓库 `OTTTTTO/dsh-scheduled-send`（**不要**勾选初始化 README/LICENSE/.gitignore，保持空仓）。然后：

```bash
git remote add origin https://github.com/OTTTTTO/dsh-scheduled-send.git
# 若 remote 已存在则：git remote set-url origin https://github.com/OTTTTTO/dsh-scheduled-send.git
git push -u origin main     # 分支名按本地实际（main 或 master）
```

## 4. 开启 GitHub Pages（deploy from branch）

仓库 **Settings → Pages**：

- Source: **Deploy from a Git branch**
- Branch: `main`（或你的默认分支），Folder: **`/docs`**

保存后等待 1–2 分钟构建。站点路径映射：

| 仓库文件 | 线上 URL |
| --- | --- |
| `docs/catalog-source.json` | `https://ottttto.github.io/dsh-scheduled-send/catalog-source.json` |
| `docs/v1/plugins` | `https://ottttto.github.io/dsh-scheduled-send/v1/plugins` |

> 若改动过 `catalog/` 下的权威副本，先同步再推送：
> ```bash
> cp catalog/catalog-source.json docs/catalog-source.json
> cp catalog/v1/plugins.json docs/v1/plugins
> ```

## 5. curl 验证两个 URL（缺一不可）

```bash
curl -fsS https://ottttto.github.io/dsh-scheduled-send/catalog-source.json | python3 -m json.tool
curl -fsS https://ottttto.github.io/dsh-scheduled-send/v1/plugins      | python3 -m json.tool
```

检查三点：

1. 两个 URL 均 200 且可解析为 JSON；
2. `/v1/plugins` 中条目 `name=@ottttto/dsh-scheduled-send`、`latestVersion=0.2.0`，与 `npm view` 一致；
3. `curl -sI` 各查一次 `Content-Type`：
   ```bash
   curl -sI https://ottttto.github.io/dsh-scheduled-send/catalog-source.json | grep -i content-type
   curl -sI https://ottttto.github.io/dsh-scheduled-send/v1/plugins          | grep -i content-type
   ```
   两者都应含 `application/json`。**风险提示**：GitHub Pages 对**无扩展名**文件（`docs/v1/plugins`）可能返回 `application/octet-stream`，而 DSH Market 的标准 adapter 严格要求 `application/json`。若第 5 步检出非 JSON Content-Type，暂不要把该来源分享给他人：改用能为 `/v1/plugins` 设置 JSON Content-Type 的静态托管（同一 origin 承载 manifest 与 page 两份文件即可，manifest URL 随之更新），并重跑本步验证。`.json` 结尾的 `catalog-source.json` 在 GitHub Pages 上正常返回 `application/json`。

## 6. 在 DSH 市场登记来源

DSH Desktop → Community Market → 来源管理 → 添加来源，manifest URL 填：

```
https://ottttto.github.io/dsh-scheduled-send/catalog-source.json
```

选择该来源后应能看到「定时发送 Scheduled Send」条目。

## 7. 实测安装

方式一（市场内）：在条目上发起安装，预览确认包身份为 `@ottttto/dsh-scheduled-send@0.2.0` 后确认。

方式二（命令行等价）：

```bash
dsh plugin --profile web add @ottttto/dsh-scheduled-send@0.2.0
```

安装后重启 DSH Web GUI，在任一会话输入框：输入草稿 → ⏰ → 确认时间 → 列表出现 → 到点收到以你身份发出的消息 → 取消路径也试一次。

## 8. 收尾

- 通过后向 [awesome-dsh-plugin / awesome-deepseek-harness-plugins] 提交收录 PR（文案见 `docs/awesome-entry.md`）。
- 打 tag：`git tag v0.2.0 && git push origin v0.2.0`。
- 冻结 0.2.0：此后任何代码/元数据改动都递增版本并同步 catalog 与 README。
