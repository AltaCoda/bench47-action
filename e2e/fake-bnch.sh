#!/bin/sh
# A stand-in for `bnch ci`, for the Action's end-to-end test only. It sends its
# arguments to the fake server, which answers from e2e/recorded.json, then
# writes the step outputs and summary the way bnch does and exits with the
# recorded code.
set -eu

server=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--server" ]; then server="$a"; fi
  prev="$a"
done
[ -n "$server" ] || { echo "fake bnch: no --server" >&2; exit 2; }

body=$(printf '%s\n' "$@")
if [ -n "${BENCH47_API_KEY:-}" ]; then body="$body
api-key=present"; fi

resp=$(curl -fsS -X POST --data-binary "$body" "$server/api/v1/fake-ci")
printf '%s\n' "$resp" | sed -n 's/^output //p' >> "$GITHUB_OUTPUT"
printf '%s\n' "$resp" | sed -n 's/^summary //p' >> "$GITHUB_STEP_SUMMARY"
printf '%s\n' "$resp" | sed -n 's/^say //p'
code=$(printf '%s\n' "$resp" | sed -n 's/^exit //p')
exit "${code:-2}"
