# Arxiv Digest

一个面向个人研究者的论文阅读自动化仓库：定时筛选 arXiv 新论文，在飞书生成粗读决策卡，并按需完成快速精读、实验配置抽取、深度笔记和多论文对比。

核心原则是**先给出处，再给判断**：机构、代码链接和实验数字只能来自 arXiv 元数据或实际解析到的论文页面；文档解析失败时明确降级为“仅摘要”，不会假装读过全文。

## 功能

| 功能 | 产物 | 触发方式 |
|---|---|---|
| 每日论文速递 | 机构、代码、问题、方法、实验、风险和透明评分组成的飞书决策卡 | GitHub Actions 定时或手动运行 |
| 快速精读 | 30 秒总结、核心直觉、方法步骤、关键实验、局限和阅读指南 | 飞书消息含“精读”、速递卡按钮、Issue 或手动 workflow |
| 实验配置抽取 | 数据集、模型、超参、硬件、评测、消融和复现缺口 | 飞书直接发送 arXiv 链接、速递卡按钮、Issue 或手动 workflow |
| 深度笔记 | Obsidian Markdown 研究笔记 | 精读判定“值得精读”后自动生成 |
| 多论文对比 | 指定任务下的实验对比 Markdown | 手动运行 `Benchmark Extractor` |

## 工作流

### 每日速递

```text
arXiv API
  → 摘要相关性预筛
  → 最多 20 篇候选交给 MinerU 解析
  → 提取首页机构、可信代码链接和实验章节
  → 内容分 + 有限机构加分
  → 飞书自定义机器人群卡片
```

机构只增加最多 `0.08`，内容相关度低于 `0.5` 时不加分；大厂或名校不会让无关论文自动入选。

### 飞书私聊触发

```text
飞书应用机器人私聊
  → 腾讯云 SCF 接收 im.message.receive_v1
  → GitHub repository_dispatch
  → Feishu Arxiv Dispatch
  → MinerU + LLM
  → 飞书应用机器人把结果发回原会话
```

- 直接发送 arXiv 链接：抽取实验配置。
- 消息包含“精读”：执行快速精读。

腾讯云函数只接收事件和触发 Actions，不执行 LLM 或论文解析，因此运行轻、响应快。

## 为什么从 PaddleOCR 改为 MinerU

早期版本使用 PaddleOCR 的远程 `fileUrl` 模式处理 arXiv PDF。实际端到端验证中，PaddleOCR 对 arXiv 链接返回 `10004 文件格式不支持`，导致 workflow 虽然传入了 `--use-ocr`，最终却静默降级为仅摘要分析。

当前版本改用 MinerU：

- 将 arXiv `abs`、`pdf` 链接或论文 ID 统一为标准 PDF URL。
- 由 MinerU 服务端下载并解析，本地和 GitHub Actions 不下载 PDF。
- 默认解析前 20 页，可通过 `OCR_PAGE_LIMIT` 调整。
- 配置 `MINERU_TOKEN` 时优先使用精准解析 API（`vlm`）；失败或未配置 Token 时回退到免登录的 Agent 轻量 API。
- 输出记录 `ocr_source`、`ocr_status` 和 `input_coverage`，可确认分析究竟读取了什么。

## 快速部署

### 1. Fork 与基础配置

1. Fork 本仓库。
2. 在 Fork 的 `Settings → Actions → General` 中允许 GitHub Actions 运行。
3. 编辑 [`config/keywords.yaml`](config/keywords.yaml)：
   - `categories`：关注的 arXiv 分类。
   - `keywords`：研究关键词。
   - `threshold`：最终推送阈值。
   - `ocr_candidate_limit`：每天最多解析多少篇候选。
   - `institution_bonus_max`：机构加分上限。

定时任务定义在 [`.github/workflows/daily-digest.yml`](.github/workflows/daily-digest.yml)，默认 `22:17 UTC`，即北京时间次日 `06:17`。GitHub Actions 的整点调度容易延迟或被丢弃，因此避开 `:00`。

### 2. 配置 LLM

使用任何兼容 OpenAI Chat Completions 的服务。在 GitHub 仓库 `Settings → Secrets and variables → Actions` 添加：

| Secret | 必需 | 说明 |
|---|---:|---|
| `LLM_API_KEY` | 是 | API Key |
| `LLM_BASE_URL` | 是 | 兼容 OpenAI 的 API Base URL |
| `LLM_MODEL` | 是 | 模型名称，需支持 JSON 输出 |

### 3. 配置飞书每日速递

每日速递使用群“自定义机器人”，适合固定群广播：

1. 在目标群添加自定义机器人。
2. 复制 Webhook。
3. 添加 GitHub Secret：`FEISHU_WEBHOOK`。

不需要每日速递时可以不配置该 Secret，脚本仍会生成分析 artifact。

### 4. 创建飞书应用机器人

精读和实验配置结果由企业自建应用发送：

1. 在飞书开放平台创建企业自建应用并启用“机器人”能力。
2. 开通以应用身份发送消息所需权限。
3. 若要通过私聊消息触发任务，再订阅事件 `im.message.receive_v1`。
4. 将应用可用范围包含使用者。
5. 创建并发布应用版本；新增权限或事件后必须重新发布。
6. 在 GitHub Actions Secrets 添加：

| Secret | 必需 | 说明 |
|---|---:|---|
| `FEISHU_APP_ID` | 是 | 应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 应用 App Secret |
| `FEISHU_RECEIVE_ID` | Issue/手动触发需要 | 默认结果接收者的 `open_id` 或群 `chat_id` |
| `FEISHU_RECEIVE_ID_TYPE` | Issue/手动触发需要 | 私聊填 `open_id`，群聊填 `chat_id` |

通过飞书消息触发时，workflow 自动使用事件中的 `chat_id`，无需固定接收者。

### 5. 配置 MinerU

在 MinerU API 管理页创建 Token，然后添加 GitHub Secret：

```text
MINERU_TOKEN
```

该项可选；没有 Token 时使用免登录 Agent API，但可能受 IP 限频影响。

### 6. 部署腾讯云 SCF 接收器

仓库只保留当前生产使用的腾讯云事件函数实现：[`feishu-serverless/index.py`](feishu-serverless/index.py) 和 [`feishu-serverless/core.py`](feishu-serverless/core.py)。

1. 创建腾讯云函数，运行时选择 Python 3.10 或更高版本。
2. 将 `index.py`、`core.py` 放在 ZIP 根目录后上传。
3. 执行方法填写：

   ```text
   index.main_handler
   ```

4. 创建函数 URL 触发器，允许飞书服务器访问。
5. 配置云函数环境变量：

   | 变量 | 必需 | 说明 |
   |---|---:|---|
   | `GITHUB_REPO` | 是 | Fork 后的 `owner/repo` |
   | `GITHUB_TOKEN` | 是 | 调用 GitHub repository dispatch 的 PAT |
   | `FEISHU_VERIFICATION_TOKEN` | 推荐 | 飞书事件订阅 Verification Token |
   | `FEISHU_ENCRYPT_KEY` | 启用事件加密时 | 飞书事件 Encrypt Key；部署包需包含 `cryptography` |

6. GitHub 细粒度 PAT 必须选择目标仓库，并授予 **Contents: Read and write**；经典 PAT 使用 `repo` scope。
7. 在飞书事件订阅中选择“将事件发送至开发者服务器”，填写函数 URL，完成 URL 验证后重新发布应用。

函数收到有效论文消息时，成功响应包含：

```json
{"code": 0, "dispatch_attempted": true, "dispatch_ok": true, "task": "setup"}
```

GitHub 401/403/404 会返回 HTTP 502 和具体错误，便于在腾讯云日志中定位。

### 7. GitHub Secrets 汇总

| Secret | 每日速递 | 私聊/Issue 精读 | 实验配置 |
|---|---:|---:|---:|
| `LLM_API_KEY` | 是 | 是 | 是 |
| `LLM_BASE_URL` | 是 | 是 | 是 |
| `LLM_MODEL` | 是 | 是 | 是 |
| `FEISHU_WEBHOOK` | 是 | 否 | 否 |
| `FEISHU_APP_ID` | 否 | 是 | 是 |
| `FEISHU_APP_SECRET` | 否 | 是 | 是 |
| `FEISHU_RECEIVE_ID` | 否 | Issue/手动触发需要 | Issue/手动触发需要 |
| `FEISHU_RECEIVE_ID_TYPE` | 否 | Issue/手动触发需要 | Issue/手动触发需要 |
| `MINERU_TOKEN` | 推荐 | 推荐 | 推荐 |

腾讯云函数的 `GITHUB_TOKEN` 是云函数环境变量，不是同名 GitHub Actions Secret。

## 使用

### 飞书

```text
https://arxiv.org/abs/2210.03629
```

默认抽取实验配置。

```text
精读 https://arxiv.org/abs/2210.03629
```

执行快速精读。每日速递卡也提供“精读”“实验配置”“打开”按钮。

### GitHub Actions

- `Daily Arxiv Digest`：每日自动运行，也可手动覆盖分类、关键词、阈值和回溯天数。
- `Feishu Arxiv Dispatch`：接收腾讯云函数 dispatch；也可填写论文 URL、任务和 `chat_id` 手动诊断。
- `Paper Analysis`：Issue 标题含 `[精读]` 时运行。
- `Experiment Setup Extraction`：Issue 标题含 `[实验配置]` 时运行。
- `Benchmark Extractor`：输入多篇 URL 生成对比报告。

## 自定义

### Prompt

Prompt 都是独立 Markdown，无需修改 Python：

| 文件 | 用途 |
|---|---|
| [`prompts/digest_scoring.md`](prompts/digest_scoring.md) | 摘要相关性预筛 |
| [`prompts/digest_decision.md`](prompts/digest_decision.md) | 粗读决策卡字段 |
| [`prompts/reading.md`](prompts/reading.md) | 快速精读结构 |
| [`prompts/experiment_setup.md`](prompts/experiment_setup.md) | 实验配置结构 |
| [`prompts/deep_note.md`](prompts/deep_note.md) | 深度笔记结构 |

### 机构名单

[`config/institutions.yaml`](config/institutions.yaml) 包含固定的 CSRankings AI 相关院校参考集和主流生成模型厂商别名。匹配结果只作为有限加分并显示在卡片上，可按个人需求增删。

### Fork 后的仓库地址

GitHub Actions 自动提供 `GITHUB_REPOSITORY`，速递卡的 Issue 按钮会指向当前 Fork。腾讯云函数仍需显式设置自己的 `GITHUB_REPO=owner/repo`。

## 本地运行

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

复制 [`.env.example`](.env.example) 为 `.env` 并填写所需变量。`.env` 已被 Git 忽略。

```bash
# 每日速递预览；会实际调用 LLM/MinerU，但不发送飞书
python scripts/digest.py --categories cs.CL,cs.AI --keywords "agent,RAG" --dry-run

# 快速精读
python scripts/reading.py --url https://arxiv.org/abs/2210.03629 --use-ocr --dry-run

# 实验配置
python scripts/extract_setup.py --url https://arxiv.org/abs/2210.03629 --dry-run

# 测试
python -m unittest discover -s tests -v
```

## 产物与排障

Actions 会上传：

- `digest-analysis`：粗读评分、机构匹配和解析状态。
- `paper-reading-evidence`：精读 JSON、MinerU Markdown 和深度笔记。
- `experiment-setup-evidence`：实验配置 JSON 与解析证据。
- `benchmark-result`：多论文对比 Markdown。

常见问题：

| 现象 | 检查 |
|---|---|
| 飞书消息存在但 Actions 没运行 | 腾讯云函数是否收到事件；响应中是否有 `dispatch_attempted=true`；PAT 是否为 Contents 写权限 |
| 手动 `Feishu Arxiv Dispatch` 成功，私聊不触发 | 飞书 `im.message.receive_v1` 订阅、函数 URL、应用是否重新发布 |
| Actions 成功但飞书没结果 | 应用发送消息权限、App ID/Secret、接收 ID 类型 |
| `ocr_status=failed` | MinerU Token、额度、Agent API 限频和 Actions artifact 日志 |
| 只得到摘要分析 | 查看 `input_coverage` 和 `ocr_source`，确认 MinerU 是否返回 Markdown |

## 项目结构

```text
.github/workflows/      GitHub Actions 入口
config/                 关键词、阈值和机构名单
feishu-serverless/      腾讯云 SCF 事件接收器
prompts/                可编辑的阅读 Prompt
scripts/                抓取、解析、分析和飞书卡片
tests/                  workflow、飞书、MinerU 和分析契约测试
```

## 安全说明

- 不要把 `.env`、App Secret、MinerU Token 或 GitHub PAT 提交到仓库。
- 腾讯云函数 URL 是公开入口，建议配置并校验 `FEISHU_VERIFICATION_TOKEN`。
- Token 只授予所需仓库和最小权限，并定期轮换。
