#!/bin/bash
file=$(jq -r '.tool_input.file_path' <<< "$(cat)")
out=$(npx eslint --quiet --cache "$file" 2>&1)

if [ -n "$out" ]; then
  echo "$out" >&2
  exit 2
fi
exit 0