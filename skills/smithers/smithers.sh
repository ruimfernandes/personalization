#!/usr/bin/env bash
# Smithers: snapshot a branch's commits, then map old hashes to new ones after a rebase.
set -euo pipefail

usage() {
  echo "usage: smithers.sh start <hash> | compare <hash> [--full] | show" >&2
  exit 2
}

[ $# -ge 1 ] || usage
cmd=$1
shift

snapshot_dir="$(git rev-parse --absolute-git-dir)/smithers"
snapshot="$snapshot_dir/snapshot.tsv"

# Prints "<full hash>\t<short hash>\t<title>" for every commit from <hash> (included) to HEAD, oldest first.
list_commits() {
  local hash
  hash=$(git rev-parse --verify --quiet "$1^{commit}") || { echo "smithers: '$1' is not a commit" >&2; exit 1; }
  git merge-base --is-ancestor "$hash" HEAD || { echo "smithers: $1 is not in the history of HEAD" >&2; exit 1; }

  if git rev-parse --verify --quiet "$hash^" >/dev/null; then
    git log --reverse --format='%H%x09%h%x09%s' "$hash^..HEAD"
  else
    git log --reverse --format='%H%x09%h%x09%s' HEAD
  fi
}

case "$cmd" in
  start)
    [ $# -eq 1 ] || usage
    mkdir -p "$snapshot_dir"
    commits=$(list_commits "$1")
    {
      echo "# branch: $(git branch --show-current)"
      echo "# from: $1"
      echo "# taken: $(date '+%Y-%m-%d %H:%M:%S')"
      echo "$commits"
    } > "$snapshot"
    echo "Saved $(echo "$commits" | wc -l | tr -d ' ') commits (from $1 to HEAD):"
    echo
    echo "| Title | Hash |"
    echo "| --- | --- |"
    echo "$commits" | awk -F'\t' '{ t = $3; gsub(/\|/, "\\|", t); print "| " t " | " $2 " |" }'
    ;;

  compare)
    [ $# -ge 1 ] || usage
    full=0
    [ "${2:-}" = "--full" ] && full=1
    [ -f "$snapshot" ] || { echo "smithers: no snapshot found. Run step 1 first." >&2; exit 1; }

    current=$(mktemp)
    trap 'rm -f "$current"' EXIT
    list_commits "$1" > "$current"

    # Match old and new commits by title. When a title appears more than once,
    # the 1st old one matches the 1st new one, the 2nd the 2nd, and so on.
    awk -F'\t' -v full="$full" '
      function key(title) { seen[FILENAME, title]++; return title SUBSEP seen[FILENAME, title] }
      function hash(f, s) { return full ? f : s }
      function cell(t) { gsub(/\|/, "\\|", t); return t }

      /^#/ { next }
      NR == FNR { k = key($3); old[k] = hash($1, $2); oldtitle[k] = $3; oldorder[++n_old] = k; next }
                { k = key($3); new[k] = hash($1, $2); newtitle[k] = $3; neworder[++n_new] = k }

      END {
        print "| Title | Old hash | New hash |"
        print "| --- | --- | --- |"
        for (i = 1; i <= n_new; i++) {
          k = neworder[i]
          if (k in old) { matched++; if (old[k] == new[k]) unchanged++ } else added++
          print "| " cell(newtitle[k]) " | " ((k in old) ? old[k] : "—") " | " new[k] " |"
        }
        for (i = 1; i <= n_old; i++) {
          k = oldorder[i]
          if (!(k in new)) { dropped++; print "| " cell(oldtitle[k]) " | " old[k] " | — |" }
        }
        print ""
        printf "%d matched (%d with the same hash), %d only in the new list, %d only in the old list.\n",
          matched, unchanged, added, dropped
      }
    ' "$snapshot" "$current"
    ;;

  show)
    [ -f "$snapshot" ] || { echo "smithers: no snapshot found. Run step 1 first." >&2; exit 1; }
    cat "$snapshot"
    ;;

  *)
    usage
    ;;
esac
