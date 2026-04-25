// 启动前自检：验证 Codex CLI 可执行且已登录；Claude 仅在显式要求时检查。
// 用法：npm run check:cli
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

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
  writeLine(`[${name}] ok — ${(r.stdout || r.stderr).trim().split('\n')[0]}`);
  return true;
}

const requireClaude = process.env.REQUIRE_CLAUDE_CLI === 'true';
const claudeOk = requireClaude
  ? check('claude', process.env.CLAUDE_CLI_PATH ?? 'claude', ['--version'])
    && check('claude-login', process.env.CLAUDE_CLI_PATH ?? 'claude', ['auth', 'status'])
  : true;
const codexOk = check('codex', process.env.CODEX_CLI_PATH ?? 'codex', ['--version'])
  && check('codex-login', process.env.CODEX_CLI_PATH ?? 'codex', ['login', 'status']);

if (!claudeOk || !codexOk) {
  console.error('\n订阅模式 CLI 自检未通过。请：');
  console.error('  1. 确认 WSL PATH 包含 CLI 安装目录，或在 .env 中配置 CODEX_CLI_PATH 绝对路径');
  console.error('  2. 当前机器 Codex CLI 位于 Conda 环境 homework-v2：/home/lsy/miniconda3/envs/homework-v2/bin/codex');
  console.error('  3. 若需重装 Codex CLI，可在该环境中安装，并执行 `conda activate homework-v2 && codex login`');
  console.error('  4. 若启用 Claude 兜底，安装 Claude Code CLI，并执行 `claude login`');
  process.exit(1);
}

writeLine(requireClaude
  ? '\nCodex/Claude CLI 均可用，且要求的 OAuth 登录态存在。'
  : '\nCodex CLI 可用，且 OAuth 登录态存在。');
