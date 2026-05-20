# Release Notes

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
