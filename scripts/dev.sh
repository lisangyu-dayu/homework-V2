#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

echo "== homework-V2 dev helper =="

node --version
python3 --version

if ! command -v npm >/dev/null 2>&1; then
  echo "npm missing. Install Node.js/npm inside WSL before starting." >&2
  exit 1
fi

if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

if ! python3 -c "import sympy" >/dev/null 2>&1; then
  echo "SymPy missing. Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env created from .env.example. Fill required secrets before starting." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

npm run check:cli
npm run db:init
npm run dev
