# -*- coding: utf8 -*-
"""
腾讯云 SCF「事件函数」入口（配合「函数 URL」触发器）。

执行方法填：index.main_handler
只依赖标准库 + 同目录 core.py，无需安装 Flask 等第三方依赖（除非开启事件加密需 cryptography）。

环境变量：
  GITHUB_TOKEN               必填，细粒度 PAT 需 Contents: Read and write；经典 PAT 需 repo scope
  GITHUB_REPO                必填，形如 "owner/repo"
  FEISHU_VERIFICATION_TOKEN  可选，事件订阅 Verification Token（校验来源）
  FEISHU_ENCRYPT_KEY         可选，开启事件加密时填（需 cryptography 依赖）
"""

import base64
import json
import os
import urllib.request
import urllib.error

import core


def _dispatch(url, task, chat_id):
    body = json.dumps({
        "event_type": "arxiv-paper",
        "client_payload": {"url": url, "task": task, "chat_id": chat_id},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPO']}/dispatches",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "arxiv-feishu-bot",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 204:
                raise RuntimeError(f"GitHub dispatch returned HTTP {resp.status}")
            return resp.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"GitHub dispatch returned HTTP {exc.code}: {detail}") from exc


def main_handler(event, context):
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")

    status, resp = core.handle_event(body, dict(os.environ), dispatch=_dispatch)

    return {
        "isBase64Encoded": False,
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(resp, ensure_ascii=False),
    }
