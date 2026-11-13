// DSH Unified Tavern Extension for SillyTavern / TauriTavern
const KEY = 'dsh_unified_tavern_settings';

function getCtx() {
  return window.SillyTavern?.getContext?.();
}

function getSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    enabled: true,
    url: 'http://10.105.77.189:43121',
  };
}

function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {}
}

async function sendToDsh(endpoint, data) {
  const s = getSettings();
  if (!s.enabled) return;
  const base = s.url.replace(/\/+$/, '');
  try {
    const resp = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await resp.json();
  } catch (err) {
    console.error('[DSH-Bridge] 通信失败:', err);
    throw err;
  }
}

function mount() {
  const parent = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
  if (!parent || document.querySelector('#dsh-unified-tavern-drawer')) return;

  const current = getSettings();
  const drawer = document.createElement('div');
  drawer.id = 'dsh-unified-tavern-drawer';
  drawer.className = 'inline-drawer';
  drawer.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>DSH 统一桥接 (Unified Tavern)</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="padding: 10px 0;">
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <input type="checkbox" id="dsh-unified-enabled" ${current.enabled ? 'checked' : ''}>
        <span>启用 DSH 桥接</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">
        <span>电脑桥接地址：</span>
        <input type="text" class="text_pole" id="dsh-unified-url" value="${current.url}" placeholder="http://10.105.77.189:43121">
      </label>
      <button type="button" class="menu_button" id="dsh-unified-test">测试电脑连接</button>
      <pre id="dsh-unified-status" style="white-space:pre-wrap;margin-top:8px;max-height:120px;overflow:auto;display:none;"></pre>
    </div>
  `;

  parent.append(drawer);

  const enabledInput = drawer.querySelector('#dsh-unified-enabled');
  const urlInput = drawer.querySelector('#dsh-unified-url');
  const testBtn = drawer.querySelector('#dsh-unified-test');
  const statusBox = drawer.querySelector('#dsh-unified-status');

  enabledInput.onchange = (e) => {
    const s = getSettings();
    s.enabled = e.target.checked;
    saveSettings(s);
  };

  urlInput.onchange = (e) => {
    const s = getSettings();
    s.url = e.target.value.trim();
    saveSettings(s);
  };

  testBtn.onclick = async () => {
    statusBox.style.display = 'block';
    statusBox.textContent = '正在测试连接...';
    const s = getSettings();
    const base = s.url.replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/health`, { cache: 'no-store' });
      const data = await resp.json();
      statusBox.textContent = `连接成功！\n服务: ${data.service || 'ok'}\n版本: ${data.version || '0.1.0'}\n工作区: ${data.workspace || '正常'}`;
    } catch (err) {
      statusBox.textContent = `连接失败: ${err.message}\n请检查电脑是否已开启 DSH，且手机和电脑在同一 Wi-Fi。`;
    }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

console.log('[DSH-Unified-Tavern] 手机端扩展已加载完毕！');
