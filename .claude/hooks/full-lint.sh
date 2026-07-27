#!/bin/bash
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 1

echo "== eslint (весь workspace) ==" >&2
lint_out=$(pnpm lint 2>&1)
lint_status=$?

echo "== tsc --noEmit (type-check по пакетам) ==" >&2
type_out=$(pnpm -r --if-present run typecheck 2>&1)
type_status=$?

if [ "$lint_status" -ne 0 ] || [ "$type_status" -ne 0 ]; then
  [ "$lint_status" -ne 0 ] && echo "$lint_out" >&2
  [ "$type_status" -ne 0 ] && echo "$type_out" >&2
  exit 2
fi
exit 0