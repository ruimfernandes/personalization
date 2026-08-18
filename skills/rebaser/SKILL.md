---
name: rebaser
description: Rebase the current branch onto the latest master/main, resolving conflicts, push the result, and update existing PR comments that reference old commit hashes with the new ones. Use when the user says "Rebaser", or asks to rebase the current branch onto master/main and refresh commit-hash references in PR comments.
---

# Rebaser

Keep a feature branch current with its base branch, and keep every PR comment that points at a commit hash pointing at the *right* one after the rebase rewrites history.

## Trigger

The user says `Rebaser`, optionally followed by a base branch override (e.g. `Rebaser onto develop`) or a PR number if it can't be inferred from the current branch.

## What the top-level assistant does

Rebaser's actual work always runs inside a spawned subagent on **Haiku 4.5** — never do the git/GitHub work directly in the top-level session.

1. Gather the minimal context needed to fill the prompt template below:
   - Repo `owner/repo` (from `git remote get-url origin`).
   - Current branch name (`git branch --show-current`).
   - Base branch: use what the user specified; otherwise let the subagent detect it (see Step 2 in the template).
   - PR number for the current branch, if easily known (e.g. already discussed in this conversation); otherwise let the subagent detect it.
2. If the current branch **is** the repo's default branch (`main`/`master`), refuse and tell the user — there is nothing to rebase, and rewriting the default branch's history is out of scope for this skill.
3. Spawn one subagent via the Agent tool with `model: "haiku"`, using the **Subagent Prompt Template** below with placeholders filled in.
4. Relay the subagent's final summary back to the user verbatim (or lightly formatted) — do not re-run or duplicate any of its git/GitHub actions yourself.
5. If the subagent reports it stopped for conflicts it couldn't safely resolve, or a push/API failure, surface that to the user exactly as reported rather than retrying automatically.

## Subagent Prompt Template

Fill in `{owner}`, `{repo}`, `{branch}`, `{base_branch_override}` (or omit if none given), and `{pr_number_hint}` (or omit if unknown), then send this as the subagent's task:

```
You are Rebaser, working in the local git checkout of {owner}/{repo} on branch {branch}.
Base branch override from the user: {base_branch_override or "none — detect it"}
Known PR number: {pr_number_hint or "unknown — detect it"}

Do the following, in order, and do not skip a step:

STEP 1 — Track current commits
- Detect the base branch if not given: `git remote show origin | grep "HEAD branch"`, or
  `gh repo view {owner}/{repo} --json defaultBranchRef -q .defaultBranchRef.name`.
- Record every commit unique to this branch relative to the base branch, in order, with both
  hash and subject line:
    git log origin/<base>..HEAD --format="%H %s"
  Keep this list in memory — you will need it in Step 5 to map old hashes to new ones. If this
  list is empty, stop and report: there is nothing to rebase.

STEP 2 — Pull the latest base branch
- git fetch origin <base>
- Do not merge or fast-forward your local base branch pointer unexpectedly; only fetch.

STEP 3 — Rebase onto the latest base
- git rebase origin/<base>
- If conflicts appear:
  - Open each conflicted file, read the conflict markers plus surrounding context (and
    `git log`/`git blame` on both sides if intent is unclear).
  - Resolve by preserving the intent of BOTH sides where they don't logically collide (e.g. two
    unrelated additions near the same line). Never resolve a conflict by silently dropping one
    side's change just to make the marker disappear.
  - If a conflict is ambiguous enough that a wrong resolution would silently break behavior (not
    just a formatting clash), STOP: `git rebase --abort`, and report the conflicting files and
    why you couldn't safely resolve them. Do not guess.
  - After resolving a file, `git add` it, and continue with `git rebase --continue` once all
    conflicts in that step are staged.
- If the rebase fully succeeds, capture the new commit list the same way as Step 1:
    git log origin/<base>..HEAD --format="%H %s"

STEP 4 — Push
- git push --force-with-lease
- If rejected, try once: `git fetch origin {branch}` then re-check whether someone else pushed to
  this branch (`git log origin/{branch}..HEAD` / `HEAD..origin/{branch}`). If someone else's
  commits are on the remote branch that aren't in your rebased history, STOP and report this to
  the user rather than force-pushing over their work.
- If the rejection is unrelated to that (e.g. a GitHub workflow-check timeout), retry the push
  once after re-confirming the rebase is still clean. Do not retry more than twice.

STEP 5 — Update PR comments with the new commit hashes
- Find the PR for this branch: `gh pr view --json number,url` (or use the known PR number above).
  If there is no open PR, skip this step and note it in the final summary — there's nothing to
  update.
- Build an old-hash → new-hash map by matching the Step 1 and Step 3 commit lists in order by
  subject line (rebasing preserves commit messages even though hashes change). If the commit
  counts differ (e.g. a conflict resolution split/squashed a commit), map what you can match by
  subject and note any commit you couldn't map in the summary — do not guess a mapping.
- Fetch every comment that could reference a commit hash from this repo, across all three
  endpoints:
    gh api repos/{owner}/{repo}/pulls/<pr_number>/comments --paginate
    gh api repos/{owner}/{repo}/pulls/<pr_number>/reviews --paginate
    gh api repos/{owner}/{repo}/issues/<pr_number>/comments --paginate
- For each comment whose body contains one of the OLD hashes (match full 40-char SHA or the
  short form actually used in the comment) from your map:
  - If the comment's author is the authenticated GitHub user (`gh api user -q .login`), EDIT it
    in place to replace the old hash (and any commit link built from it, e.g.
    `https://github.com/{owner}/{repo}/commit/<old_sha>`) with the new one, leaving the rest of
    the comment text untouched:
      gh api repos/{owner}/{repo}/pulls/comments/<comment_id> -X PATCH --field body="<updated body>"
    (Use the issue-comments endpoint's own PATCH path for issue-level comments:
      gh api repos/{owner}/{repo}/issues/comments/<comment_id> -X PATCH --field body="<updated body>")
  - If the comment was authored by someone else (a bot or a human reviewer), you cannot and must
    not edit their comment. Instead, post a reply noting the rebase:
      gh api repos/{owner}/{repo}/pulls/comments/<comment_id>/replies --method POST \
        --field body="Rebaser note: this branch was rebased — commit <old_short> now corresponds to <new_short> (https://github.com/{owner}/{repo}/commit/<new_sha>)."
    Review-summary bodies (from the /reviews endpoint) have no reply endpoint — just note the
    stale reference in your final summary instead.
  - Skip a comment silently only if the old hash it references maps to a commit that is
    unchanged content-wise and whose short hash still happens to resolve correctly, or if it's
    already been updated (body already contains the new hash).

Finally, report a concise summary: which commits were rebased (old hash → new hash), whether
push succeeded, how many PR comments were edited vs. replied-to vs. left as notes, and any step
you stopped on and why.
```

## Rules

- Never resolve a rebase conflict by guessing when the correct resolution isn't clear from context — abort and report instead. This mirrors "fix root causes, never work around a problem."
- Always use `--force-with-lease`, never a bare `--force`, so the subagent can't silently clobber someone else's push to the same branch.
- Never edit a PR comment authored by someone else — reply instead. Editing another person's comment misrepresents what they wrote.
- Only touch comments that actually reference one of the tracked old hashes; leave everything else on the PR untouched.
- If the branch has no unique commits over the base, or no open PR exists, say so plainly rather than performing a no-op silently.

## Examples

### Example: Rebaser

Input: `Rebaser`

Output: a summary listing each rebased commit's old → new hash, confirmation the push succeeded, and a breakdown of PR comments updated in place vs. replied-to vs. left as a note (with reasons).

### Example: Rebaser with an explicit base

Input: `Rebaser onto develop`

Output: same as above, but rebasing onto `origin/develop` instead of the auto-detected default branch.
