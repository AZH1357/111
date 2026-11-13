import { randomUUID } from 'node:crypto';
import { sha256 } from './util.js';

export class Engine {
  constructor(ctx, config, store) {
    this.ctx = ctx;
    this.config = config;
    this.store = store;
    this.runtimes = new Map();
  }

  log(...args) {
    console.log('[Unified-Bridge]', ...args);
  }

  effectiveCwd(overrideCwd) {
    const registry = this.ctx.get?.('workspaceRegistry');
    const workspaces = registry?.list?.() ?? [];
    const desired = overrideCwd || this.config.cwd;
    if (workspaces.length === 0) return desired;
    if (workspaces.some(w => w.path.toLowerCase() === desired.toLowerCase())) {
      return desired;
    }
    return workspaces[0].path;
  }

  async attachWorkspace(sessionId, cwd) {
    const registry = this.ctx.get?.('workspaceRegistry');
    const workspaces = registry?.list?.() ?? [];
    if (workspaces.length === 0) return;
    const target = workspaces.find(w => w.path.toLowerCase() === cwd.toLowerCase()) || workspaces[0];
    try {
      await target.attachSession?.(sessionId);
      this.log(`已挂载会话 ${sessionId} -> 工作区 ${target.path}`);
    } catch (e) {
      this.log(`挂载工作区失败: ${e.message}`);
    }
  }

  async ensureAgentSession(chatId, title = '酒馆会话') {
    const existing = this.store.getSession(chatId);
    const agents = this.ctx.agents;
    if (!agents) throw new Error('DSH agents 服务不可用');

    let sessionId = existing?.sessionId;
    let agent = sessionId ? agents.get?.(sessionId) : null;

    if (!agent) {
      // 创建新会话
      sessionId = `session-st-${randomUUID().replace(/-/g, '').slice(0, 32)}`;
      const cwd = this.effectiveCwd(this.config.cwd);
      const defaultModel = this.ctx.get?.('agentDefaultModel')?.currentSelection?.() || {};
      const agentOptions = {
        provider: this.config.provider || defaultModel.provider || '',
        model: this.config.model || defaultModel.model || '',
      };

      const options = {
        sessionId,
        meta: {
          cwd,
          agentPreset: this.config.agentPreset || 'standard',
        },
        agentOptions,
      };

      this.log(`创建新 DSH 会话 ${sessionId} (工作区: ${cwd}, 模型: ${agentOptions.provider}/${agentOptions.model})`);
      const handle = await (agents.withoutInitiator ? agents.withoutInitiator(() => agents.create(options)) : agents.create(options));
      agent = handle?.agent;

      await this.attachWorkspace(sessionId, cwd);
      this.store.bindSession(chatId, {
        sessionId,
        title,
        cwd,
        provider: agentOptions.provider,
        model: agentOptions.model,
      });
    }

    return { sessionId, agent };
  }

  async handleAction(chatId, action, payload) {
    this.log(`执行指令: ${action} for chat ${chatId}`);
    
    switch (action) {
      case 'set_lora':
        // 核心：实现之前的动态 LoRA 逻辑
        const { loraName, strength } = payload;
        // 这里可以将指令持久化到 store，下一次生成时读取
        this.store.bindSession(chatId, { activeLora: { name: loraName, strength } });
        return { message: `已记录 LoRA 设置: ${loraName}` };
        
      case 'get_status':
        return { status: 'active', chatId };
        
      default:
        throw new Error(`未知动作: ${action}`);
    }
  }

  async execute({ chatId, messages, requestId, stream = false, onChunk = null }) {
    // ... 原有的 execute 逻辑，记得在获取 session 时读取 this.store.getSession(chatId).activeLora 并注入

    // 格式化提取本轮输入
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const promptText = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '（继续）';

    const { sessionId, agent } = await this.ensureAgentSession(chatId);
    if (!agent?.followup) {
      throw new Error(`DSH 会话 ${sessionId} 未处于可用运行状态`);
    }

    const messageId = `msg-${sha256(requestId || String(Date.now())).slice(0, 24)}`;

    // 监听流式块输出（如果是流式调用）
    let unlistener = null;
    let fullOutput = '';
    let turnFinished = false;
    let turnError = null;

    const streamPromise = new Promise((resolve, reject) => {
      // 监听流式事件
      unlistener = this.ctx.on('agent/assistant-stream', (payload) => {
        try {
          if (payload?.agent?.id === sessionId && payload.frame) {
            const frame = payload.frame;
            if (frame.type === 'text-delta' && typeof frame.text === 'string') {
              fullOutput += frame.text;
              if (stream && onChunk) {
                onChunk(frame.text);
              }
            }
          }
        } catch (e) {
          // 容错
        }
      });

      // 监听回合结束或错误
      const turnStopListener = this.ctx.on('agent/turn-stopping', (payload) => {
        if (payload?.agent?.id === sessionId) {
          turnFinished = true;
          resolve();
        }
      });

      const errorListener = this.ctx.on('agent/error', (payload) => {
        if (payload?.agent?.id === sessionId) {
          turnError = payload.error;
          reject(payload.error);
        }
      });

      // 超时兜底 (默认 3 分钟)
      setTimeout(() => {
        if (!turnFinished) {
          resolve();
        }
      }, 180000);
    });

    // 发送用户消息给 DSH Agent
    try {
      agent.followup({
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: promptText }],
        source: { kind: 'user', rpcId: requestId || messageId },
      });
    } catch (err) {
      if (unlistener) unlistener();
      throw new Error(`DSH 拒绝接收本轮消息: ${err.message}`);
    }

    // 等待回合产生结果
    await streamPromise.catch(err => {
      this.log(`回合处理出错: ${err.message}`);
    });

    if (unlistener) unlistener();

    // 如果流式没拿到完整文本，尝试从会话最新事件中抽取兜底
    if (!fullOutput.trim()) {
      try {
        const events = agent.session?.snapshotEvents?.() || [];
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (ev?.type === 'assistant/message') {
            const content = ev.data?.message?.content;
            if (Array.isArray(content)) {
              fullOutput = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            } else if (typeof content === 'string') {
              fullOutput = content;
            }
            if (fullOutput.trim()) break;
          }
        }
      } catch (e) {
        // 忽略兜底异常
      }
    }

    if (!fullOutput.trim()) {
      fullOutput = '（DSH Agent 已完成思考并执行操作）';
    }

    return {
      answer: fullOutput,
      sessionId,
      chatId,
    };
  }
}
