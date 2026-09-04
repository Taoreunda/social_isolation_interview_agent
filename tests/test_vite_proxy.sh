#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

actual="$(
  cd "$REPO_ROOT/frontend"
  VITE_API_PORT=8123 node --input-type=module <<'NODE'
import { loadConfigFromFile } from 'vite'

const loaded = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  'vite.config.ts',
)

console.log(loaded?.config.server?.proxy?.['/api'] ?? '')
console.log(loaded?.config.envDir ?? '')
NODE
)"

expected="http://127.0.0.1:8123
$REPO_ROOT"
if [[ "$actual" != "$expected" ]]; then
  echo "Expected Vite proxy and env directory '$expected', got '$actual'" >&2
  exit 1
fi

echo "Vite proxy port test passed."
