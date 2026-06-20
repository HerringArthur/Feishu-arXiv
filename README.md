# Arxiv Digest

LLM 驱动的 arxiv 论文筛选 + 速递 + 精读系统。推送到飞书。

## 功能

| Skill | 说明 | 触发方式 |
|-------|------|---------|
| **paper-feishu-digest** | 盯 arxiv 指定类别，LLM 保守打分 + 中文速递卡片 | 每日定时 (GitHub Actions) |
| **paper-reading** | 决策性阅读：claim、证据、复现价值分析 | 飞书按钮 → Cloudflare Worker → Actions |
| **paper-deep-note** | 结构化精读卡（Obsidian 格式） | paper-reading 判定「值得精读」自动触发 |
| **benchmark-extractor** | 多篇论文实验表抽取 | workflow_dispatch 手动触发 |

## 快速开始

1. Fork 此仓库
2. 在 Settings → Secrets 中添加必要的 secrets（见下方）
3. 修改 `config/keywords.yaml` 配置你的关键词和类别
4. 启用 GitHub Actions

## 需要的 Secrets

| Secret | 用途 |
|--------|------|
| `LLM_API_KEY` | LLM API key |
| `LLM_BASE_URL` | LLM API base URL |
| `LLM_MODEL` | 模型名称 |
| `FEISHU_WEBHOOK` | 飞书自定义机器人 Webhook |
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `GH_PAT` | GitHub PAT（供 Cloudflare Worker 调用） |

## 本地测试

```bash
pip install -r requirements.txt
python scripts/digest.py --categories cs.CL --keywords "agent,RAG" --dry-run
```

## 架构

```
arxiv API → LLM 打分 → LLM 中文速递 → 飞书卡片推送
                  ↓
        用户点击「精读」
                  ↓
    Cloudflare Worker → GitHub Actions → paper-reading
                  ↓
        分析结果 → 飞书消息 / 精读卡归档
```
