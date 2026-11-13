import { createHash } from 'node:crypto';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-api-key, x-chat-id, x-request-id, x-client-id, x-task-id',
    'Access-Control-Max-Age': '86400',
  };
}

export function sendJson(res, status, data, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res, status, message, code = 'internal_error', extraHeaders = {}) {
  sendJson(res, status, {
    error: {
      message,
      type: code,
      code,
    },
  }, extraHeaders);
}

export function readBody(req, maxBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error(`请求体超过上限 ${maxBytes} 字节`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(raw);
        resolve(json);
      } catch (err) {
        reject(new Error(`请求体 JSON 格式非法: ${err.message}`));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('客户端提前断开连接')));
  });
}
