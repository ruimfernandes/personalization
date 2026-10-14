---
name: smithers
description: Snapshot a branch's commit titles and hashes, then after a rebase show a table mapping each commit's old hash to its new hash. Use when the user says "Smithers" followed by a commit hash (step 1, take the snapshot), or "Smithers step 2" / "Smithers 2" followed by a hash (compare against the snapshot).
model: haiku
---

# Smithers

Remember which hash each commit had before a rebase, so the user can find its new hash after.

All the work is done by `smithers.sh`, next to this file. Run it from the current worktree. Do not reimplement its logic by hand.

## Which commits it looks at

The hash the user gives is the **oldest** commit to include. Smithers takes every commit from that hash (included) up to `HEAD`.

Example: the branch is `A - B - C - D (HEAD)` and the user gives `B`. Smithers records `B`, `C` and `D`.

## Step 1 — take the snapshot

Trigger: `Smithers <hash>` (or `Smithers step 1 <hash>`).

```bash
~/.claude/skills/smithers/smithers.sh start <hash>
```

The snapshot is saved inside the worktree's own git dir (`<git-dir>/smithers/snapshot.tsv`). A rebase does not touch it. Running step 1 again replaces it.

Show the user the table the script prints. Tell them to run step 2 with the new hash once they have rebased.

## Step 2 — compare after the rebase

Trigger: `Smithers step 2 <hash>` (or `Smithers 2 <hash>`).

```bash
~/.claude/skills/smithers/smithers.sh compare <hash>
```

Add `--full` at the end if the user asks for full hashes instead of short ones.

The script prints a `Title | Old hash | New hash` table and a one-line summary. Show both to the user as they are.

How the table is built:

- Commits are matched by title.
- If a title appears more than once, the 1st old one matches the 1st new one, and so on.
- A commit only in the new list has `—` as its old hash (for example, a new commit, or a reworded title).
- A commit only in the old list has `—` as its new hash (for example, a dropped or squashed commit). These rows come last.

If the summary shows any `—` rows, point them out in one short sentence. A reworded title shows up as one dropped row and one new row.

## Other

- `smithers.sh show` prints the saved snapshot, if the user asks what was recorded.
- If the script errors (unknown hash, hash not in the history of `HEAD`, no snapshot yet), tell the user the error as it is. Do not guess a different hash.
