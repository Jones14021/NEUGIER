#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  exec node --import tsx server/src/podcast-example.ts "$@"
fi

if command -v nix-shell >/dev/null 2>&1; then
  command='node --import tsx server/src/podcast-example.ts'
  for argument in "$@"; do
    printf -v quoted ' %q' "$argument"
    command+="$quoted"
  done
  exec nix-shell --run "$command"
fi

printf '%s\n' 'Node.js 24 oder nix-shell wird benötigt.' >&2
exit 1