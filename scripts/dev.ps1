# 开发辅助：检查环境、初始化 DB、启动 Next.js
# 用法：.\scripts\dev.ps1
$ErrorActionPreference = 'Stop'

Write-Host '== homework-V2 dev helper ==' -ForegroundColor Cyan

# Node
$node = node --version
Write-Host "node: $node"

# Python (for SymPy)
try {
  $py = python --version 2>&1
  Write-Host "python: $py"
} catch {
  Write-Host 'python missing — SymPy 验证器将无法工作' -ForegroundColor Yellow
}

# Codex CLI
try {
  $codex = codex --version 2>&1
  Write-Host "codex: $codex"
} catch {
  Write-Host 'codex CLI missing — Codex Provider 将无法工作' -ForegroundColor Yellow
}

# .env
if (-not (Test-Path .env)) {
  Write-Host '.env 不存在，从 .env.example 复制' -ForegroundColor Yellow
  Copy-Item .env.example .env
  Write-Host '请编辑 .env 填入 ANTHROPIC_API_KEY 等配置'
  exit 1
}

# deps
if (-not (Test-Path node_modules)) {
  Write-Host 'installing deps...'
  npm install
}

# DB
Write-Host 'init DB...'
npm run db:init

# Next
Write-Host 'starting next dev on :3100...'
npm run dev
