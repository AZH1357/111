import fs from 'node:fs';
import path from 'node:path';

export class SessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, chats: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.chats) this.data.chats = {};
      }
    } catch (e) {
      console.warn(`[Unified-Tavern] 读取会话映射表失败，使用默认值: ${e.message}`);
      this.data = { version: 1, chats: {} };
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error(`[Unified-Tavern] 保存会话映射表失败: ${e.message}`);
    }
  }

  getSession(chatId) {
    return this.data.chats[chatId];
  }

  bindSession(chatId, sessionInfo) {
    this.data.chats[chatId] = {
      ...this.data.chats[chatId],
      ...sessionInfo,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  deleteSession(chatId) {
    if (this.data.chats[chatId]) {
      delete this.data.chats[chatId];
      this.save();
    }
  }
}
