#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = dirname(fileURLToPath(import.meta.url));
const START = '# >>> dsh-unified-tavern (managed by install.js)';
const END = '# <<< dsh-unified-tavern';

function parseArgs(argv) {
  const args = { port: 43121, cwd: 'G:\\waaa\\生图', uninstall: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--uninstall') args.uninstall = true;
    else if (arg === '--port') args.port = Number(argv[++index]);
    else if (arg === '--cwd') args.cwd = argv[++index];
    else if (arg === '--profile') args.profile = argv[++index];
  }
  return args;
}

function getProfileDir(args) {
  if (args.profile) return resolve(args.profile);
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR);
  // 优先匹配当前用户的 desktop profile
  const candidate = 'E:\\DSH\\profiles\\desktop';
  if (existsSync(candidate)) return candidate;
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'profiles', 'desktop');
}

function buildBlock({ port, cwd }) {
  return [
    START,
    '- insert:',
    '    - id: dsh-unified-tavern',
    '      name: dsh-unified-tavern',
    '      config:',
    "        host: '0.0.0.0'",
    `        port: ${port}`,
    `        cwd: '${cwd.replaceAll("'", "''")}'`,
    '        agentPreset: standard',
    '        allowRemote: true',
    END,
  ].join('\n');
}

function stripBlock(content) {
  const startIndex = content.indexOf(START);
  const endIndex = content.indexOf(END);
  if (startIndex === -1 || endIndex === -1) return content;
  const before = content.slice(0, startIndex).trimEnd();
  const after = content.slice(endIndex + END.length).trimStart();
  return [before, after].filter(Boolean).join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getProfileDir(args);
  const nodeModules = join(profile, 'node_modules');
  const targetLink = join(nodeModules, 'dsh-unified-tavern');
  const patchFile = join(profile, 'cordis.patch.yml');

  console.log(`[安装脚本] 目标 Profile 目录: ${profile}`);

  // 1. 卸载逻辑
  if (args.uninstall) {
    if (existsSync(targetLink)) {
      console.log(`[安装脚本] 正在移除链接: ${targetLink}`);
      try {
        rmSync(targetLink, { recursive: true, force: true });
      } catch (e) {
        unlinkSync(targetLink);
      }
    }
    if (existsSync(patchFile)) {
      console.log(`[安装脚本] 正在从 cordis.patch.yml 移除配置`);
      const content = readFileSync(patchFile, 'utf8');
      writeFileSync(patchFile, stripBlock(content), 'utf8');
    }
    console.log('[安装脚本] 卸载完成。请完全退出并重启 DSH Desktop。');
    return;
  }

  // 2. 安装/链接逻辑
  if (!existsSync(nodeModules)) {
    mkdirSync(nodeModules, { recursive: true });
  }

  if (existsSync(targetLink)) {
    try {
      rmSync(targetLink, { recursive: true, force: true });
    } catch {
      unlinkSync(targetLink);
    }
  }

  console.log(`[安装脚本] 正在创建目录链接: ${targetLink} -> ${PROJECT}`);
  symlinkSync(PROJECT, targetLink, 'junction');

  // 3. 配置写入
  let patchContent = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : '';
  patchContent = stripBlock(patchContent).trimEnd();
  const newBlock = buildBlock(args);
  const finalContent = `${patchContent}\n\n${newBlock}\n`;
  writeFileSync(patchFile, finalContent, 'utf8');
  console.log(`[安装脚本] 已更新配置文件: ${patchFile}`);
  console.log('\n======================================================');
  console.log('✅ 安装成功！');
  console.log('提示：请从系统托盘完全退出 DSH Desktop，然后重新启动它。');
  console.log(`启动后，手机酒馆即可直接连接: http://电脑局域网IP:${args.port}/v1`);
  console.log('======================================================\n');
}

main();
