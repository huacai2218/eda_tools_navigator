# EDA Tools Navigator

一个面向芯片设计 EDA 工具 user guide 的 RAG 检索问答网页。系统会把导入的手册切成片段，建立本地 SQLite 全文索引，然后在聊天窗口中根据问题检索相关内容并返回带来源的答案。

项目只保留两种运行方式：

- 个人部署：在自己的电脑上运行，浏览器访问本机地址。
- Linux 服务器公共部署：部署到团队服务器，团队成员通过同一个网页地址直接访问。

项目不内置登录或权限控制。

## 目录结构

```text
eda_tools_navigator/
  server.py              # 后端服务、索引、检索、LLM 调用
  static/                # 前端网页
  manuals/               # 手册文件，按工具分目录存放
  data/                  # SQLite 索引数据库
  scripts/               # 打包与升级脚本
  VERSION                # 代码版本号
  RELEASE_NOTES.md       # 每个版本的发布说明
  .env.example           # 环境变量模板
  requirements.txt       # Python 依赖
```

## 团队共享与个人 LLM 设置

默认模式适合团队共享：服务端统一读取部署目录下的 `manuals/` 和 `data/`，所有同事打开网页后看到同一套 manual；LLM URL、Model、API key 和 Timeout 由每位同事在网页 `LLM 设置` 弹窗中填写，配置只保存在自己的浏览器 localStorage 中，不会写入服务器 `.env`，也不会覆盖其他同事的设置。

手册导入和重建索引默认隐藏。需要维护 manual 时，用 debug 模式启动：

```bash
python3 server.py --host 0.0.0.0 --port 8765 --debug
```

生产共享时不加 `--debug`，团队成员只能查询和配置自己的 LLM。

## 工作方式

团队成员只需要打开网页并提问。manual 和索引保存在服务器端；LLM 的 URL、Model、Timeout 和 API key 由每位用户在网页 `LLM 设置` 弹窗中维护，保存在各自浏览器。

```text
用户浏览器 -> EDA Tools Navigator 服务器 -> 内部 LLM API
```

网页中的 `LLM 设置` 弹窗只维护当前浏览器的个人配置。API key 不会写入服务器 `.env`，也不会影响其他同事；每次提问时，浏览器会把自己的 LLM URL、Model、API key 和 Timeout 随请求发送给后端处理。

如果没有配置内部 LLM，系统仍然可以使用本地检索结果回答。

## 个人部署

进入项目目录：

```bash
cd /path/to/eda_tools_navigator
```

安装 Python 依赖：

```bash
python3 -m pip install -r requirements.txt
```

如需启用内部 LLM，复制并编辑 `.env`：

```bash
cp .env.example .env
```

`.env` 示例：

```text
LLM_BASE_URL=https://your-internal-llm.example.com/v1
LLM_API_KEY=your-internal-api-key
LLM_MODEL=your-model-name
LLM_TIMEOUT=120
```

启动：

```bash
python3 server.py
```

浏览器访问：

```text
http://127.0.0.1:8765
```

如果默认端口被占用：

```bash
python3 server.py --port 8766
```

### 个人本地后台运行

如果希望关闭终端窗口后服务仍继续运行，可以使用 `nohup`：

```bash
cd /path/to/eda_tools_navigator
mkdir -p logs
nohup python3 server.py --host 127.0.0.1 --port 8765 > logs/server.log 2>&1 &
echo $! > logs/server.pid
```

查看日志：

```bash
tail -f logs/server.log
```

停止后台进程：

```bash
kill $(cat logs/server.pid)
```

如果使用虚拟环境，后台启动命令改为：

```bash
nohup .venv/bin/python server.py --host 127.0.0.1 --port 8765 > logs/server.log 2>&1 &
```

## Linux 服务器公共部署

目标效果：管理员在 Linux 服务器上部署一次，团队成员只需要访问一个网页地址，例如：

```text
http://<服务器IP>:8765
```

或者配置域名后访问：

```text
http://eda-tools-reader.example.com
```

### 1. 准备服务器

安装 Python 3.9 或更高版本。

Ubuntu / Debian:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv poppler-utils
```

Rocky Linux / CentOS:

```bash
sudo dnf install -y python3 python3-pip poppler-utils
```

`poppler-utils` 提供 `pdftotext`。PDF 解析顺序是先使用 Python 依赖 `pypdf`；如果 `pypdf` 不支持该 PDF、解析报错，或解析结果基本为空，则自动 fallback 到 `pdftotext`。

### 2. 上传项目

推荐部署路径：

```bash
sudo mkdir -p /opt/eda-tools-reader
sudo chown -R $USER:$USER /opt/eda-tools-reader
```

把项目文件上传到：

```text
/opt/eda-tools-reader
```

### 3. 安装依赖

```bash
cd /opt/eda-tools-reader
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. 配置内部 LLM

团队共享部署时，推荐让每位同事在网页顶部 `LLM 设置` 弹窗中填写自己的 LLM URL、Model、API key 和 Timeout。配置只保存在各自浏览器，不写入服务器，也不会互相覆盖。

服务器 `.env` 可作为运维默认配置或个人部署默认值使用：

```bash
cp .env.example .env
```

```text
LLM_BASE_URL=https://your-internal-llm.example.com/v1
LLM_API_KEY=your-internal-api-key
LLM_MODEL=your-model-name
LLM_TIMEOUT=120
```

如果暂时不接内部 LLM，可以留空 `LLM_BASE_URL` 和 `LLM_API_KEY`，系统会使用本地检索回答。

### 5. 准备手册

生产共享模式下，网页不会显示上传入口。建议在服务器上按工具目录放置手册：

```text
/opt/eda-tools-reader/manuals/<工具名称>/
```

示例：

```text
/opt/eda-tools-reader/manuals/Calibre/
/opt/eda-tools-reader/manuals/Innovus/
/opt/eda-tools-reader/manuals/PrimeTime/
```

当前支持：

- `.txt`
- `.md`
- `.html`
- `.pdf`

### 6. 构建索引

如果已经提前复制了大量手册，先执行：

```bash
cd /opt/eda-tools-reader
source .venv/bin/activate
python server.py --reindex
```

后续新增手册后，可以再次执行上述命令。维护人员如果需要在网页中上传或重建索引，可以用 `--debug` 模式启动服务；生产共享时不要加该参数。

### 7. 手动启动验证

```bash
cd /opt/eda-tools-reader
source .venv/bin/activate
python server.py --host 0.0.0.0 --port 8765
```

在服务器上检查：

```bash
curl http://127.0.0.1:8765/api/status
```

团队成员访问：

```text
http://<服务器IP>:8765
```

确认可访问后，按 `Ctrl+C` 停止手动进程，再配置 systemd 后台服务。

### 8. 配置 systemd 后台服务

创建服务文件：

```bash
sudo tee /etc/systemd/system/eda-tools-reader.service >/dev/null <<'EOF'
[Unit]
Description=EDA Tools Navigator
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/eda-tools-reader
ExecStart=/opt/eda-tools-reader/.venv/bin/python /opt/eda-tools-reader/server.py --host 0.0.0.0 --port 8765
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eda-tools-reader
```

查看状态：

```bash
sudo systemctl status eda-tools-reader
```

查看日志：

```bash
sudo journalctl -u eda-tools-reader -f
```

重启服务：

```bash
sudo systemctl restart eda-tools-reader
```

### 9. 可选：Nginx 反向代理

如果希望团队访问域名而不是端口，可以用 Nginx 转发。

安装 Nginx：

```bash
sudo apt-get install -y nginx
```

配置示例：

```nginx
server {
    listen 80;
    server_name eda-tools-reader.example.com;

    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 快速升级机制

升级目标：服务器上只更新程序代码和依赖，保留以下运行数据：

- `manuals/`：已导入的手册
- `data/`：SQLite 索引库
- `.env`：内部 LLM URL、API key 等服务器配置
- `.venv/`：Python 虚拟环境，可复用并按新依赖更新

升级流程分为两步：

1. 在开发机或本机项目目录生成 release 包。
2. 把 release 包上传到服务器，在服务器项目目录执行 `scripts/upgrade.sh`。

### 1. 生成 release 包

在本机项目目录执行：

```bash
cd /path/to/eda_tools_navigator
chmod +x scripts/*.sh
./scripts/make_release.sh
```

生成 release 包前，必须先在 `RELEASE_NOTES.md` 中增加当前 `VERSION` 对应的条目，例如：

```markdown
## 0.1.16 - 2026-05-20

- 说明本版本新增、修复或调整的内容。
```

如果缺少当前版本的 release note，脚本会停止打包，避免漏写发布说明。

输出示例：

```text
/path/to/eda_tools_navigator/dist/eda-tools-reader-0.1.0-20260518-120000.tar.gz
```

release 包只包含程序文件，不包含 `manuals/`、`data/`、`.env`。

### 2. 上传 release 包到服务器

示例：

```bash
scp dist/eda-tools-reader-*.tar.gz user@server:/tmp/
```

### 3. 在服务器上一键升级

登录服务器后执行：

```bash
cd /opt/eda-tools-reader
./scripts/upgrade.sh /tmp/eda-tools-reader-0.1.0-20260518-120000.tar.gz
```

脚本会执行：

1. 解压 release 包到临时目录。
2. 备份当前代码到 `backups/pre-upgrade-<时间>.tar.gz`。
3. 更新 `server.py`、`static/`、`scripts/`、`README.md`、`requirements.txt` 等程序文件。
4. 保留 `manuals/`、`data/`、`.env`。
5. 安装或更新 Python 依赖。
6. 执行 `server.py` 语法检查。
7. 如果服务器存在 `eda-tools-reader` systemd 服务，自动重启服务。

依赖安装会在覆盖代码之前执行。如果依赖安装失败，脚本会停止，避免出现代码已升级但依赖未安装的半升级状态。

### 4. 升级后检查

```bash
sudo systemctl status eda-tools-reader
curl http://127.0.0.1:8765/api/status
```

浏览器访问团队地址确认页面正常：

```text
http://<服务器IP>:8765
```

### 5. 需要重建索引时升级

多数代码升级不需要重建索引。如果升级涉及切片逻辑、文件解析逻辑、索引 schema，执行：

```bash
cd /opt/eda-tools-reader
./scripts/upgrade.sh /tmp/eda-tools-reader-0.1.0-20260518-120000.tar.gz --reindex
```

`--reindex` 会重新解析 `manuals/` 下所有手册。手册很多时耗时较长。

### 6. 不自动重启服务

如果想先升级文件，再手动重启：

```bash
./scripts/upgrade.sh /tmp/eda-tools-reader-0.1.0-20260518-120000.tar.gz --no-restart
sudo systemctl restart eda-tools-reader
```

### 7. 依赖不变或离线服务器升级

如果确认 `requirements.txt` 没有变化，或者服务器不能访问 Python 包源，可以跳过依赖安装：

```bash
./scripts/upgrade.sh /tmp/eda-tools-reader-0.1.0-20260518-120000.tar.gz --skip-deps
```

如果后续依赖发生变化，需要提前在服务器上配置可用的 pip 源，或手动安装依赖后再使用 `--skip-deps`。

### 8. 回滚

升级前脚本会自动生成备份：

```text
backups/pre-upgrade-<时间>.tar.gz
```

回滚程序文件：

```bash
cd /opt/eda-tools-reader
tar -xzf backups/pre-upgrade-<时间>.tar.gz -C /opt/eda-tools-reader
sudo systemctl restart eda-tools-reader
```

回滚只恢复程序文件，不会覆盖 `manuals/`、`data/`、`.env`。

## 网页 LLM 设置

顶部 `LLM 设置` 按钮会打开个人设置弹窗，分为接口地址、模型与密钥、请求控制三部分：

- 配置保存在当前浏览器 localStorage 中，不会写入服务器 `.env`。
- 不同同事在自己的浏览器中填写不同 API key 时，互不影响。
- 每次提问时，浏览器会把当前个人 LLM 配置随请求发送给服务器，仅用于这一次回答。
- API key 会保存在当前浏览器本地；如果使用公共电脑，测试结束后建议点击弹窗中的 `清空`。
- 如果个人 LLM 配置不完整，系统会回退为本地检索回答。

服务器端 `.env` 仍可作为运维默认配置使用，但网页 `LLM 设置` 不会覆盖它。

## 内部 LLM 接口要求

内部 LLM API 需要提供 OpenAI-compatible 的聊天接口：

```text
POST <LLM_BASE_URL>/chat/completions
Authorization: Bearer <LLM_API_KEY>
Content-Type: application/json
```

请求体格式：

```json
{
  "model": "internal-llm",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "temperature": 0.2
}
```

返回体需要包含：

```json
{
  "choices": [
    {
      "message": {
        "content": "answer text"
      }
    }
  ]
}
```

相关环境变量：

```text
LLM_BASE_URL     内部 LLM 服务地址，不包含 /chat/completions
LLM_API_KEY      内部 API key
LLM_MODEL        模型名称，默认 internal-llm
LLM_TIMEOUT      请求超时时间，默认 120 秒
```

## 性能优化说明

问答时服务端会缓存短时间内的增量索引检查结果，避免每次提问都扫描整套 `manuals/`；上传和手动重建索引仍会立即更新索引。LLM 上下文默认只发送排名靠前的少量片段，以降低接口耗时。

## 引用与原文查看

回答中的引用标注如 `[1]`、`[2]` 可以直接点击。HTML 手册会直接打开 `manuals/` 下的原 HTML 文件，并注入轻量定位脚本滚动到被引用文本，同时加入 base 路径以保持原页面 CSS、图片和相对链接可用；PDF 手册会打开内置 PDF viewer 页面并把原 PDF 加载到指定页码；其他文本类手册会打开网页化原文视图并定位到被引用的索引片段。

原文视图来自已经建立索引的手册内容，支持 `.txt`、`.md`、`.html` 和已成功抽取文本的 `.pdf`。如果 PDF 无法抽取文本，需要先确认服务器已安装 `pdftotext` 所属的 `poppler-utils`。

## 新增或更新手册

推荐目录方式：

```text
manuals/
  PrimeTime/
    user_guide.pdf
    command_reference.pdf
  Innovus/
    user_guide.pdf
  Calibre/
    svrf_reference.pdf
```

更新索引：

```bash
python3 server.py --reindex
```

如需在网页中执行上传或重建索引，请用 `--debug` 模式启动服务后再操作。

## 迁移

复制整个项目文件夹即可，包括：

- `server.py`
- `static/`
- `manuals/`
- `data/`
- `.env`
- `.env.example`
- `requirements.txt`

如果目标机器不能安装 PDF 解析依赖，可以先在原机器完成导入和索引，再复制 `data/index.sqlite`，已有内容仍可检索。建议服务器安装 `poppler-utils`，用于处理 `pypdf` 无法正确抽取文本的 PDF。

## 注意事项

- 项目不内置登录或权限控制，团队成员打开网页后都可以提问。
- 生产共享模式默认隐藏并禁用上传手册和重建索引；只有用 `--debug` 启动时才开放维护入口。
- 团队成员的内部 API key 保存在各自浏览器 localStorage 中；不要在公共电脑长期保存个人 key。
- 服务器 `.env` 已加入 `.gitignore`，不要把内部 API key 写入 `server.py` 或提交到版本库。

## SQLite 兼容模式

程序启动时会自动检测当前 Python 绑定的 SQLite 是否支持 FTS5：

- 支持 FTS5：使用 `chunks_fts` 全文索引，检索速度和排序效果最好。
- 不支持 FTS5，例如系统 SQLite 3.7.17：自动切换到 `sqlite-like` 兼容检索，不创建 FTS5 表。

如果旧服务器打开了由新 SQLite/FTS5 创建的 `data/index.sqlite`，可能出现 `malformed database schema` 或 `near "WITHOUT": syntax error`。新版启动时会把不兼容的索引库移动为：

```text
data/index.sqlite.incompatible-<时间>
data/index.sqlite-wal.incompatible-<时间>
data/index.sqlite-shm.incompatible-<时间>
```

随后会按当前 SQLite 能力重建索引。只要 `manuals/` 目录还在，数据不会丢失；如果只复制了 `data/index.sqlite` 而没有复制 `manuals/`，旧库被隔离后无法自动恢复原文内容。

兼容模式会有性能下降：因为 SQLite 3.7.17 没有 FTS5，检索会退化为对 `chunks` 表做 `LIKE` 扫描，再由 Python 做二次排序。manual 数量较小时通常可用；manual 很多或索引片段达到数万级时，查询会明显慢于 FTS5。推荐生产服务器尽量使用 Python 3.9+ 且绑定较新的 SQLite。

如需强制测试兼容模式，可以这样启动：

```bash
EDA_FORCE_SQLITE_LEGACY=1 python3 server.py --host 0.0.0.0 --port 8765
```
