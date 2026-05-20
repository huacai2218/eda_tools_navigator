# Release Notes

## 0.1.19 - 2026-05-20

- Navigator 默认改为 PDF manual 浏览，优先打开 `calbr_ver_user.pdf`，并保留 `svrf_ur`、`calbr_perc_user`、`calbr_pmatch_user`、`xact_user`、`calbr_opcv_useref` 快捷切换。
- Manual 搜索候选改为从 `raw/` 全局扫描支持文档，同名文档优先选择 PDF，不再罗列全部材料列表。
- PDF reader 顶部新增当前文档查找框，可基于已索引文本跳转到匹配页。
- 右侧工作区栏目命名调整为 `LLM-WIKI`、`Scripts Comment`、`Settings`，chat 输入提示改为 raw materials 语义。
- 启动服务和后台 reindex 前会显示 SQLite runtime 版本与 FTS5 支持状态；页面状态栏同步显示 `SQLite FTS5: ON/OFF`。

## 0.1.18 - 2026-05-20

- 网页端移除上传、重建索引和用户创建等维护入口；后台仍保留对应 admin API，正式 reindex 通过 `python3 server.py --reindex` 执行。
- 左侧栏改回 `Navigator`，不再显示 docs/chunks 统计信息。
- Manual viewer 默认优先打开 `calbr_ver_user/index.html`，并提供 `svrf_ur`、`calbr_perc_user`、`calbr_pmatch_user`、`xact_user`、`calbr_opcv_useref` 快捷切换。
- 新增 HTML manual 页面搜索自动补齐，来源限定为 `raw/manuals/**/htmldocs/*/index.html`。
- 新增轻量 patch 包生成和应用脚本，便于已安装目录快速更新程序文件。

## 0.1.17 - 2026-05-20

- 资料根目录从 `manuals/` 扩展为 `raw/`，支持 `raw/manuals/` 和 `raw/books/`。
- 新增本地账号密码登录，支持管理员和普通用户权限。
- 新增管理员材料维护入口：上传 raw 材料、创建用户、重建索引并生成 wiki。
- 引入 wiki-first RAG：重建索引时生成 `data/wiki/`，问答优先检索 wiki，并对 command/rule/option 类问题补充 raw 整页上下文。
- 新增脚本注解工作台，支持粘贴或上传脚本、浏览器本地保存、结构化 Markdown 注解和下载。
- 前端改为 raw material 阅读器 + 右侧可调整工作面板。

## 0.1.16 - 2026-05-20

- 发布流程新增 release note 要求：生成 release 包前必须维护当前版本的发布说明。
- release 包会包含 `RELEASE_NOTES.md`，服务器升级时也会同步更新该文件。
- 资料根目录从 `manuals/` 扩展为 `raw/`，支持 `raw/manuals/` 和 `raw/books/`。
- 新增本地登录、管理员材料维护、wiki-first 检索和脚本注解工作台。
