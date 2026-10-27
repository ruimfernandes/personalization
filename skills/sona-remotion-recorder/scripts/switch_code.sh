#!/bin/bash
# Switch the worktree the dev server runs from, then make the dev server
# recompile and confirm it came back healthy.
# Usage: switch_code.sh <branch-or-commit>   (from anywhere inside the worktree)
#
# Use the PR's merge base for the "before" run (git merge-base HEAD master),
# not the latest master: a big checkout makes the in-process recompile touch
# hundreds of files and it can get stuck on "cannot define module
# Backend.Gettext because it is currently being defined". If that happens the
# dev server has to be restarted by the user.
set -euo pipefail
ref="$1"
root=$(git rev-parse --show-toplevel)
cd "$root"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "The worktree has uncommitted tracked changes. Stop and ask the user." >&2
  exit 1
fi
pid=$(lsof -tiTCP:4000 -sTCP:LISTEN | head -1 || true)
if [ -n "$pid" ]; then
  cwd=$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')
  if [ "$cwd" != "$root/backend" ]; then
    echo "The dev server on :4000 runs from $cwd, not $root/backend. Switching here won't change what it serves." >&2
    exit 1
  fi
fi
if git show-ref --verify --quiet "refs/heads/$ref"; then git checkout -q "$ref"; else git checkout -q --detach "$ref"; fi
echo "HEAD: $(git log -1 --format='%h %s')"
body=$(mktemp)
code=$(curl -s -m 900 -o "$body" -w "%{http_code}" http://localhost:4000/users/log_in || echo 000)
if [ "$code" != "200" ]; then
  echo "Dev server answered $code after the switch." >&2
  python3 - "$body" <<'PY' >&2
import html, re, sys
t = open(sys.argv[1], errors='ignore').read()
t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t)))
i = t.find('Compilation error')
print(t[i:i + 800] if i >= 0 else t[:400])
PY
  exit 2
fi
echo "Dev server recompiled and answers 200."
