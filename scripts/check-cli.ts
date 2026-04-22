// 启动前自检：验证 claude / codex CLI 可执行且已登录
// 用法：npm run check:cli
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

function check(name: string, cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.error) {
    console.error(`[${name}] cannot spawn ${cmd}: ${r.error.message}`);
    return false;
  }
  if (r.status !== 0) {
    console.error(`[${name}] exit ${r.status}: ${(r.stderr || r.stdout).trim()}`);
    return false;
  }
  console.log(`[${name}] ok — ${(r.stdout || r.stderr).trim().split('\n')[0]}`);
  return true;
}

const claudeOk = check('claude', process.env.CLAUDE_CLI_PATH ?? 'claude', ['--version']);
const codexOk  = check('codex',  process.env.CODEX_CLI_PATH  ?? 'codex',  ['--version']);

if (!claudeOk || !codexOk) {
  console.error('\n订阅模式下，两侧 CLI 都必须可执行。请：');
  console.error('  1. 安装：https://claude.ai/download 与 https://developers.openai.com/codex');
  console.error('  2. 登录：`claude login` 与 `codex login`');
  process.exit(1);
}

console.log('\n两侧 CLI 均可用。登录态请通过 `claude doctor` / `codex --help` 自行确认。');
