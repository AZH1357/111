
// 手机端核心逻辑：连接桥接器并拦截消息
import { getApiUrl } from "../../power-user.js";

const EXTENSION_NAME = "dsh-unified-tavern-st";
const DSH_BRIDGE_URL = "http://10.105.77.189:43121"; // 需根据实际情况动态修改

async function sendToDsh(endpoint, data) {
    try {
        const response = await fetch(`${DSH_BRIDGE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (e) {
        console.error("DSH Bridge 通信失败:", e);
    }
}

// 示例：当酒馆界面角色切换时，通知 DSH 切换 LoRA
export function onCharacterChanged(charName) {
    sendToDsh('/v1/agent/action', {
        action: 'set_lora',
        payload: { loraName: `${charName.toLowerCase()}.safetensors`, strength: 0.8 }
    });
}

console.log("DSH Unified Tavern 手机插件加载成功");
