import http from 'node:http';
import { corsHeaders, sendJson, sendError, readBody } from './util.js';

export function createServer(engine, config) {
  const startedAt = Date.now();

  const server = http.createServer(async (req, res) => {
    const origin = req.headers['origin'] || '*';
    const cors = corsHeaders(origin);
    for (const [key, value] of Object.entries(cors)) {
      res.setHeader(key, value);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = req.headers['host'] || '127.0.0.1';
    const parsedUrl = new URL(req.url || '/', `http://${hostHeader}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    // 1. 健康检查与探测
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'dsh-unified-tavern',
        version: '0.1.0',
        uptime: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    // 4. 桥接状态查询 (用于手机端判断连接情况)
    if (req.method === 'GET' && pathname === '/v1/bridge/status') {
      sendJson(res, 200, {
        status: 'connected',
        server: 'dsh-unified-tavern',
        config: { workspace: config.cwd },
      });
      return;
    }

    // 5. Agent 指令与交互接口 (关键互通点)
    if (req.method === 'POST' && pathname === '/v1/agent/action') {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const chatId = body.chat_id || 'default-chat';
        // 调用引擎执行特殊指令（如动态LoRA注入、角色切换等）
        const result = await engine.handleAction(chatId, body.action, body.payload);
        sendJson(res, 200, { ok: true, result });
      } catch (err) {
        sendError(res, 500, err.message, 'action_failed');
      }
      return;
    }

    // 2. 模型列表接口 (支持 /v1/models 及 /clients/:client_id/v1/models)
    const isModelsRoute = pathname === '/v1/models' || /^\/clients\/[^/]+\/v1\/models$/.test(pathname);
    if (req.method === 'GET' && isModelsRoute) {
      sendJson(res, 200, {
        object: 'list',
        data: [
          { id: 'dsh-default', object: 'model' },
          { id: 'gemini-3.8-flash-high', object: 'model' },
        ],
      });
      return;
    }

    // 3. 聊天补全接口 (支持 /v1/chat/completions 及 /clients/:client_id/v1/chat/completions)
    const isChatRoute = pathname === '/v1/chat/completions' || /^\/clients\/[^/]+\/v1\/chat\/completions$/.test(pathname);
    if (req.method === 'POST' && isChatRoute) {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const chatId = body.chat_id || body.chatId || body.dsh_session?.chat_id || req.headers['x-chat-id'] || 'default-chat';
        const requestId = body.request_id || body.requestId || req.headers['x-request-id'] || String(Date.now());
        const isStream = body.stream === true;
        const completionId = `chatcmpl-${requestId.slice(0, 32)}`;

        // 如果是流式请求，配置 SSE 响应头
        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-store',
            'Connection': 'keep-alive',
          });

          // 发送首个角色块
          const initChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'dsh-default',
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(initChunk)}\n\n`);

          const result = await engine.execute({
            chatId,
            messages: body.messages,
            requestId,
            stream: true,
            onChunk: (deltaText) => {
              const deltaChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'dsh-default',
                choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(deltaChunk)}\n\n`);
            },
          });

          // 结束分片
          const endChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'dsh-default',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // 非流式请求：直接返回标准 JSON 响应
        const result = await engine.execute({
          chatId,
          messages: body.messages,
          requestId,
          stream: false,
        });

        sendJson(res, 200, {
          id: completionId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'dsh-default',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.answer,
              },
              finish_reason: 'stop',
            },
          ],
          dsh_session: {
            chat_id: chatId,
            session_id: result.sessionId,
          },
        });
        return;
      } catch (err) {
        console.error('[Unified-Server] 处理请求出错:', err);
        sendError(res, 500, err.message, 'internal_error');
        return;
      }
    }

    sendError(res, 404, `未找到路由: ${req.method} ${pathname}`, 'not_found');
  });

  return server;
}
