# gemini-fullstack-langgraph-quickstart 离线下载与使用指南

本指南面向无法长期联网的环境，目标是在有网窗口期一次性完成代码与依赖下载，并在离线环境可重复部署与运行。

更新时间：2025-08-21（UTC+8）

---

## 目录
- 1. 环境准备
- 2. 在线阶段：下载代码与依赖
- 3. 离线阶段：安装与启动
- 4. 配置方法
- 5. 本地运行命令
- 6. 常见问题与注意事项
- 7. 附录：离线资产目录结构与校验

---

## 1. 环境准备

请在“有网环境”和“离线目标环境”均准备如下软件，版本建议如下（高于或同等均可）：

- Git ≥ 2.39
- Python 3.10 ~ 3.12（建议 3.11）
- Node.js 20 LTS（含 npm ≥ 10）
- zip 或 tar 工具（用于打包离线资产）

验证版本：

```bash
git --version
python --version
node -v
npm -v
```

预先获取并妥善保存 Google Gemini API Key（AI Studio）：`GEMINI_API_KEY`（或 `GOOGLE_API_KEY`）。离线环境仅读取本地 `.env` 文件，不会联网申请。

---

## 2. 在线阶段：下载代码与依赖

该项目包含 Python 后端与 Node.js 前端。建议在“有网环境”完整拉取仓库并预下载依赖与运行时缓存，然后将离线资产整体拷贝到目标环境。

### 2.1 克隆项目代码

```bash
git clone https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart.git
cd gemini-fullstack-langgraph-quickstart
```

如需固定版本，切换到特定 tag 或 commit：

```bash
git checkout <tag_or_commit>
```

### 2.2 Python 后端依赖（在线预下载）

创建并启用虚拟环境（可选但推荐）：

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate
```

安装依赖并生成离线 wheel 仓库：

```bash
# 安装（可先安装一次保证开发可跑）
pip install --upgrade pip
pip install -r requirements.txt

# 生成离线 wheel 仓库
mkdir -p offline/wheels
pip download -r requirements.txt -d offline/wheels

# 冻结精确版本（便于复现）
pip freeze > offline/requirements.lock.txt
```

如后端使用 `uvicorn` 启动，确保其包含于 `requirements.txt` 或单独下载：

```bash
pip download uvicorn -d offline/wheels
```

### 2.3 Node.js 前端依赖（在线预下载）

使用 npm 生成锁文件并预热缓存：

```bash
npm ci

# 预热 npm 离线缓存目录
npm config set cache ./offline/npm-cache --location=project
# 将依赖写入缓存（npm ci 已写入大部分包）
npm cache verify

# 可选：将 node_modules 打包，离线时直接解压使用（最快）
zip -r ./offline/node_modules.zip node_modules
```

如果使用 pnpm 或 yarn，可采用各自的离线镜像能力（如 `pnpm fetch` + 离线 store，或 yarn unplugged），本文以 npm 为例。

### 2.4 复制运行所需模板与示例配置

```bash
# 复制示例环境文件
cp .env.example offline/.env.example 2>/null || true
```

### 2.5 打包离线资产

将以下目录与文件整体打包，准备拷贝到离线环境：

- 项目源码目录 `gemini-fullstack-langgraph-quickstart/`
- `offline/wheels/` 与 `offline/requirements.lock.txt`
- `offline/npm-cache/` 与可选 `offline/node_modules.zip`
- `.env.example` 或你已填写的 `.env`（避免泄漏注意安全）

示例：

```bash
cd ..
zip -r gemini-quickstart-offline.zip gemini-fullstack-langgraph-quickstart
```

---

## 3. 离线阶段：安装与启动

将离线压缩包拷贝至目标环境并解压：

```bash
unzip gemini-quickstart-offline.zip
cd gemini-fullstack-langgraph-quickstart
```

### 3.1 安装 Python 依赖（离线）

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

# 使用本地 wheel 仓库离线安装
pip install --no-index --find-links=offline/wheels -r requirements.txt

# 如需安装额外包，同理：
# pip install --no-index --find-links=offline/wheels uvicorn
```

### 3.2 安装 Node.js 依赖（离线）

优先方案 A：使用已打包的 `node_modules.zip`：

```bash
unzip -o offline/node_modules.zip -d .
```

方案 B：使用 npm 离线缓存重建：

```bash
npm ci --offline --cache ./offline/npm-cache
```

### 3.3 构建前端静态资源（如适用）

```bash
npm run build
```

---

## 4. 配置方法

项目通常在后端与前端各自读取 `.env` 或 `.env.local`。建议按下列方式创建文件并填入密钥与运行参数。

### 4.1 后端 `.env`

在仓库根目录创建 `.env` 文件，示例：

```bash
# 必填：从 AI Studio 获取
GEMINI_API_KEY=填入你的密钥
# 可选：与上等价
GOOGLE_API_KEY=

# 模型与推理参数（可选）
GEMINI_MODEL=gemini-2.5-pro
GEMINI_TEMPERATURE=0.3

# 服务配置
PORT=8000
HOST=127.0.0.1
CORS_ORIGIN=http://127.0.0.1:3000
```

### 4.2 前端 `.env.local`

在前端目录（若前后端同仓库，请按实际子目录）创建 `.env.local`：

```bash
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_MODEL_HINT=gemini-2.5-pro
```

---

## 5. 本地运行命令

以下命令为通用示例，请根据仓库内的实际脚本与目录调整（例如 backend 位于 `server/`、frontend 位于 `web/`）。

### 5.1 启动后端服务

常见方式一（uvicorn）：

```bash
# 进入后端目录（如有）
# cd server

# 读取 .env 并启动（根据实际模块位置更改 app.main:app）
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

常见方式二（项目脚本）：

```bash
# 例如
python scripts/serve.py
```

健康检查（如项目提供 `/health`）：

```bash
curl http://127.0.0.1:8000/health
```

### 5.2 启动前端应用

```bash
# 进入前端目录（如有）
# cd web

npm run dev
# 或生产模式
npm run start
```

访问前端页面（默认）：

```
http://127.0.0.1:3000
```

### 5.3 端到端验证

- 前端控制台输入查询，后端应调用 Gemini API（离线环境需已设置有效 Key；若完全离线将无法访问模型服务）。
- 流式输出需浏览器与后端支持 SSE；如经反向代理，确保代理允许 `text/event-stream`。

---

## 6. 常见问题与注意事项

1) 完全离线是否可用？
- 仅在拥有可用的本地推理服务或专线访问模型时可用。若完全断网，Gemini 云端 API 无法调用，建议在离线前生成示例数据以便演示。

2) Windows 与 Linux 差异
- Windows 激活虚拟环境命令不同；Linux 需安装构建工具链以编译部分依赖：`build-essential`、`python3-dev` 等。

3) NPM 离线缓存命中失败
- 确保在线阶段已执行 `npm ci` 并设置项目局部缓存目录，然后 `npm ci --offline --cache ./offline/npm-cache`。

4) Python 离线安装失败
- 检查 `offline/wheels` 是否包含所有 transitive 依赖；必要时在有网环境执行 `pip download -r requirements.txt -d offline/wheels --platform manylinux2014_x86_64 --only-binary=:all:` 以覆盖常见平台。

5) SSE 无法工作
- 反向代理需放行 `Cache-Control: no-cache`、`Connection: keep-alive`、`Content-Type: text/event-stream`，并禁用缓冲。

6) 安全与密钥
- `.env` 含敏感信息，请通过安全介质传输；必要时在离线环境临时输入密钥并在使用完毕后销毁介质。

---

## 7. 附录：离线资产目录结构与校验

建议的离线包目录结构：

```
gemini-fullstack-langgraph-quickstart/
├─ offline/
│  ├─ wheels/                      # pip 离线 wheel 仓库
│  ├─ requirements.lock.txt
│  ├─ npm-cache/                   # npm 缓存
│  └─ node_modules.zip             # 可选，直接解压使用
├─ requirements.txt
├─ package.json
├─ package-lock.json
├─ .env.example                    # 可选
└─ ...                             # 项目源码与脚本
```

文件完整性校验（可选）：

```bash
# 生成校验和
find . -type f -exec sha256sum {} \; > OFFLINE_SHA256SUMS.txt

# 目标环境验证
sha256sum -c OFFLINE_SHA256SUMS.txt
```

结束。