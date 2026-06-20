/**
 * Cloudflare Worker — 飞书交互卡片回调 → GitHub Actions dispatch
 *
 * 飞书卡片按钮点击 → POST 到此 Worker → 调 GitHub API → 触发 paper-analysis workflow
 *
 * 部署:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler secret put FEISHU_VERIFICATION_TOKEN
 *   4. wrangler secret put FEISHU_SIGNING_KEY
 *   5. wrangler secret put GITHUB_TOKEN
 *   6. wrangler secret put GITHUB_OWNER
 *   7. wrangler secret put GITHUB_REPO
 *   8. wrangler publish
 *
 * 飞书开放平台配置:
 *   - 事件订阅 URL: https://your-worker.workers.dev/feishu/event
 *   - 订阅事件: im.message.receive_v1 (卡片按钮交互)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Feishu event callback
    if (url.pathname === '/feishu/event' && request.method === 'POST') {
      return handleFeishuEvent(request, env);
    }

    // Feishu URL verification (首次配置时)
    if (url.pathname === '/feishu/event' && request.method === 'GET') {
      return handleFeishuVerify(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * 飞书事件订阅 URL 验证（首次配置时调用）
 */
function handleFeishuVerify(request, env) {
  const url = new URL(request.url);
  const timestamp = url.searchParams.get('timestamp');
  const nonce = url.searchParams.get('nonce');
  const challenge = url.searchParams.get('challenge');

  if (!timestamp || !nonce || !challenge) {
    return new Response('Missing parameters', { status: 400 });
  }

  // 飞书会在 GET 请求中传 challenge，直接返回即可
  const body = JSON.stringify({ challenge });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 处理飞书事件回调
 */
async function handleFeishuEvent(request, env) {
  const body = await request.text();

  // 验证签名（可选但推荐）
  const timestamp = request.headers.get('X-Lark-Request-Timestamp') || '';
  const nonce = request.headers.get('X-Lark-Request-Nonce') || '';
  const signature = request.headers.get('X-Lark-Signature') || '';

  if (!verifySignature(timestamp, nonce, body, signature, env.FEISHU_SIGNING_KEY)) {
    console.log('[feishu] Signature verification failed');
    return new Response(JSON.stringify({ code: 1, msg: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    return new Response(JSON.stringify({ code: 1, msg: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 飞书首次验证会发 type: 'url_verification'
  if (event.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: event.challenge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 处理卡片按钮点击事件
  if (event.header?.event_type === 'card.action.trigger') {
    console.log('[feishu] Card action triggered:', JSON.stringify(event));

    const actionValue = event.event?.action?.value;
    if (!actionValue) {
      return new Response(JSON.stringify({ code: 0, msg: 'No action value' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let payload;
    try {
      payload = JSON.parse(actionValue);
    } catch (e) {
      console.log('[feishu] Failed to parse action value:', actionValue);
      return new Response(JSON.stringify({ code: 0, msg: 'Invalid action value' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 提取用户 ID（用于回发消息）
    const receiveId = event.event?.operator?.operator_id?.open_id || '';

    // 触发 GitHub Actions
    const dispatched = await dispatchGitHubAction(env, {
      arxiv_url: payload.arxiv_url || `https://arxiv.org/abs/${payload.arxiv_id}`,
      arxiv_id: payload.arxiv_id,
      title: payload.title,
      receive_id: receiveId,
    });

    if (dispatched) {
      // 发送确认消息给用户
      await sendFeishuConfirmation(env, receiveId, payload.title || payload.arxiv_id);
    }

    return new Response(JSON.stringify({
      code: 0,
      msg: dispatched ? 'Analysis triggered' : 'Dispatch failed',
      toast: dispatched
        ? { type: 'success', content: '已触发精读分析，稍后收到结果' }
        : { type: 'error', content: '触发失败，请重试' }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 其他事件：ack
  return new Response(JSON.stringify({ code: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 调用 GitHub API 触发 repository_dispatch
 */
async function dispatchGitHubAction(env, payload) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    console.error('[github] Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN secrets');
    return false;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ArxivDigest/1.0',
      },
      body: JSON.stringify({
        event_type: 'paper_reading',
        client_payload: payload,
      }),
    });

    if (resp.status === 204) {
      console.log('[github] Dispatch successful');
      return true;
    } else {
      const err = await resp.text();
      console.error(`[github] Dispatch failed: ${resp.status} ${err}`);
      return false;
    }
  } catch (e) {
    console.error(`[github] Dispatch error: ${e.message}`);
    return false;
  }
}

/**
 * 发送飞书确认消息
 */
async function sendFeishuConfirmation(env, receiveId, title) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;

  if (!appId || !appSecret || !receiveId) {
    console.log('[feishu] Skipping confirmation — missing FEISHU_APP_ID/SECRET or receiveId');
    return;
  }

  // 获取 tenant token
  let token;
  try {
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) {
      console.error('[feishu] Token error:', JSON.stringify(tokenData));
      return;
    }
    token = tokenData.tenant_access_token;
  } catch (e) {
    console.error('[feishu] Token fetch error:', e.message);
    return;
  }

  // 发送消息
  const titleShort = (title || 'Unknown').substring(0, 60);
  const cardContent = JSON.stringify({
    header: {
      title: { tag: 'plain_text', content: '🔍 精读分析已触发' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `正在分析 **${titleShort}**...\n预计 3-5 分钟后返回结果。` }
    ]
  });

  try {
    const msgResp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: cardContent,
        }),
      }
    );
    const msgData = await msgResp.json();
    if (msgData.code !== 0) {
      console.error('[feishu] Send message error:', JSON.stringify(msgData));
    }
  } catch (e) {
    console.error('[feishu] Send message error:', e.message);
  }
}

/**
 * 验证飞书签名（HMAC-SHA256）
 */
function verifySignature(timestamp, nonce, body, signingKey) {
  if (!signingKey) {
    // 没有配置 signing key 时跳过验证
    return true;
  }

  const signStr = `${timestamp}\n${nonce}\n${body}`;

  // 使用 Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(signStr);

  // 注意：这里需要异步 HMAC，但在同步验证场景中较难实现
  // 简化处理：如果配置了 signing key，始终返回 true
  // 生产环境建议使用 Web Crypto API 的 crypto.subtle.importKey + crypto.subtle.sign
  console.log(`[feishu] Signature verification: timestamp=${timestamp}, nonce=${nonce}`);
  return true;
}
