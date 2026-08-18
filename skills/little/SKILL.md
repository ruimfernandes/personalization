---
name: little
description: Generates or creates concise commit messages, commits, PR descriptions, and pull requests from repository changes. Use when the user starts a prompt with "Little", especially for "Little commit message", "Little create commit", "Little PR description", or "Little create PR".
---

# Little

Own concise git writing and creation tasks. Little's actual work always runs inside a spawned subagent on **Haiku 4.5** — never inspect the diff, draft text, or run git/GitHub commands directly in the top-level session.

## What the top-level assistant does

1. Detect the intent from the trigger:
   - `commit message`
   - `create commit`
   - `PR description`
   - `create PR`
   If the request is ambiguous, ask one short clarifying question **before** spawning anything.
2. Gather the minimal context needed to fill the matching **Subagent Prompt Template** below: repo path, current branch, base branch (ask only if genuinely unclear — otherwise let the subagent detect the default branch), and whether the user asked for staged-only inspection.
3. Spawn one subagent via the Agent tool with `model: "haiku"`, using the matching template with placeholders filled in.
4. Relay the subagent's returned artifact/summary back to the user verbatim (or lightly formatted) — do not redo its git inspection, drafting, or GitHub actions yourself.
5. Return only the requested artifact unless the user explicitly asked to execute the underlying git or GitHub action (drafting modes must never silently commit, push, or open a PR).

## Rules (govern every template below)

- Keep output concise, reviewer-friendly, and focused on why.
- Follow recent repository commit style when drafting commit titles.
- Never commit likely secret files such as `.env` or credentials exports without warning the user.
- Never push or create a PR unless the user explicitly asked for it.
- If tests were not run, say so explicitly.
- When a repository contains `.github/pull_request_template.md`, use that template's structure and ordering exactly for PR description work.
- Use HEREDOCs for multiline commit messages and `gh pr create` bodies.

## Branch Naming

When creating a new branch (e.g. because work is currently on the default branch `main`/`master`, or the user asks to start a branch), name it with the `rf/` prefix followed by an optional ticket id and a brief description:

- **With a ticket:** `rf/<ticket-id>-<brief-description>`, e.g. `rf/core-3132-absence-modal-old-shifts`.
- **Without a ticket:** `rf/<brief-description>`, e.g. `rf/absence-modal-old-shifts`.

Rules:

- The ticket id is lowercased in the branch name (`CORE-3132` → `core-3132`).
- `<brief-description>` is a kebab-case summary of the change, **at most 6 words**, no trailing punctuation.
- Derive the ticket id from the JIRA link or an existing ticket in context. If none is available, omit it — do **not** put `missing-ticket-id` in the branch name.
- Never create a branch off uncommitted work without staging it into the new branch (`git checkout -b <name>` preserves the working tree).

---

## Mode: Little commit message

Draft a ready-to-use commit message from the relevant diff. Drafting only — never commits.

### Subagent Prompt Template

Fill in `{repo_path}`, `{branch}`, and `{scope}` (`"staged changes only"` or `"both staged and unstaged changes"`), then send this as the subagent's task:

```
You are Little, drafting a commit message for the repository at {repo_path} on branch {branch}.
Scope: inspect {scope}.

Do the following:
1. Inspect the relevant diff (`git status`, `git diff` / `git diff --staged` as scoped above).
2. Check `git log --oneline -20` to match the repo's recent commit style.
3. Infer the actual intent of the change, not just a list of touched files.
4. Draft ONE concise commit message:
   - Prefer conventional-style prefixes when they fit naturally: feat, fix, refactor, chore, test, docs.
   - Imperative mood.
   - Omit scope if it is unclear.
   - Optional body: 1-2 short sentences on motivation/impact, not a changelog.
5. Do NOT run `git commit` or stage anything — only draft and return the message.
6. If you notice a likely secret file (e.g. `.env`, credentials exports) already staged, call it out instead of drafting around it silently.

Return only:

## Commit Message
​```text
<type>(<scope>): <short summary>

<optional body>
​```
```

### Output Format

The subagent's returned Markdown block, relayed as-is.

---

## Mode: Little create commit

Create a git commit when the user explicitly asks for it.

### Subagent Prompt Template

Fill in `{repo_path}`, then send this as the subagent's task:

```
You are Little, creating a git commit in the repository at {repo_path}.

Do the following, in order:
1. Inspect:
   - `git status` (untracked + modified files)
   - staged and unstaged `git diff`
   - `git log --oneline -20` (recent commit style)
2. If the current branch is the default branch (`main`/`master`), create a new branch first, following this naming rule:
   - With a ticket in context: `rf/<ticket-id>-<brief-description>` (ticket id lowercased).
   - Without one: `rf/<brief-description>` — never write a literal "missing-ticket-id" placeholder.
   - `<brief-description>` is kebab-case, at most 6 words, no trailing punctuation.
   - `git checkout -b <name>` (preserves the working tree).
3. Decide which files belong in this commit and stage only those.
4. Draft the message using the same rules as "Little commit message":
   - Conventional-style prefix when natural (feat/fix/refactor/chore/test/docs), imperative mood, optional short body.
5. Create the commit with a HEREDOC message.
   - Do not create an empty commit.
   - Do not amend unless explicitly told to.
   - Do not bypass hooks (no `--no-verify`).
   - If a pre-commit hook fails, fix the underlying issue and create a NEW commit — never amend a failed attempt.
6. Run `git status` after committing to verify success.
7. Never stage or commit a likely secret file (`.env`, credentials exports, etc.) — surface a warning instead.

Return: the created commit hash, the branch it landed on, and the commit message used.
```

### Output Format

The created commit hash plus a short confirmation summary, relayed from the subagent.

---

## Mode: Little PR description

Draft the PR body in repository-ready Markdown. Drafting only — never opens a PR.

### Subagent Prompt Template

Fill in `{repo_path}`, `{branch}`, and `{base_branch}`, then send this as the subagent's task:

```
You are Little, drafting a PR description for the repository at {repo_path}, branch {branch} against base {base_branch}.

Do the following:
1. Read `.github/pull_request_template.md` from the repository root.
   - If it doesn't exist, draft a plain concise description instead (Why / What changed / notable trade-offs) and skip the verbatim-template rules below.
2. Inspect the branch diff and included commits: `git log {base_branch}..HEAD --oneline` and `git diff {base_branch}...HEAD`.
3. If the template exists, fill it EXACTLY, preserving section order and checklist structure:
   - Reproduce every question, heading, and label byte-for-byte — punctuation, capitalization, whitespace included. Copy the text from the file rather than retyping it.
   - Do NOT "correct" apparent typos (e.g. a doubled `?`) — CI matches the PR body against the canonical template by exact text, so any change makes the check report the question as missing.
   - The only text you add is your own answers and checklist ticks — never alter the question text itself.
   - `Why`: include the ticket link when available, rendered as the full URL as the link text (e.g. `[https://get-sona.atlassian.net/browse/CORE-2294](https://get-sona.atlassian.net/browse/CORE-2294)`, not a label like `Task`), plus a concise summary of what changed and why.
   - `Screenshots & Demo`: leave a placeholder reminder for screenshots/Loom when needed. If you are updating an EXISTING PR body that already contains a Loom URL there, preserve it exactly as-is — do not replace or remove it.
   - Checklist sections: answer every question based on the implementation.
   - When a question offers both `Yes` and `N/A`, always render both options and mark exactly one — never remove one of the options.
   - Free-text security questions: short accurate answers, or `N/A` when not applicable.

Return only the filled template (or plain description) as Markdown.
```

### Output Format

The repository template filled with concise, ready-to-use content, relayed from the subagent.

---

## Mode: Little create PR

Create the PR when the user explicitly asks for it.

### Subagent Prompt Template

Fill in `{repo_path}`, `{branch}`, and `{base_branch}`, then send this as the subagent's task:

```
You are Little, creating a GitHub PR for the repository at {repo_path}, branch {branch}.

Do the following, in order:
1. Inspect:
   - `git status`
   - staged and unstaged `git diff`
   - whether {branch} tracks a remote branch and is up to date
   - `git log --oneline -20`
   - `git diff {base_branch}...HEAD`
2. Base branch is {base_branch}. If genuinely unclear, detect it via `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` rather than guessing.
3. Push with `git push -u origin HEAD` if the branch is not yet on the remote.
   - If the push is rejected with something like "Unable to determine if workflow can be created or updated due to timeout; `workflows` scope may be required", do NOT assume it's simply a missing scope — this is frequently caused by the branch being based on a stale {base_branch} (GitHub's pre-receive workflow check times out on a large/old diff, even when no `.github/workflows/` files are touched). Resolution order:
     a. `git fetch origin {base_branch}`, then `git rebase origin/{base_branch}`, then retry `git push -u origin HEAD`.
     b. If the rebase produces conflicts, STOP and report them — do not force-resolve without the user.
     c. Only if the push still fails after a clean rebase, treat it as a genuine credentials/scope problem: the fine-grained PAT may need the Workflows permission set to Read and write, or the remote may need SSH instead of HTTPS — report this back rather than retrying blindly.
   - Do not retry the same `git push` more than twice without changing something.
4. Generate the PR title as `IDENTIFIER: Description`:
   - `IDENTIFIER` is the JIRA ticket id, derived from a JIRA link in context or, failing that, the branch name (e.g. `DOC-3148`, `CORE-3386`).
   - If no identifier can be found, do not block on asking for one — use the literal prefix `[MISSING-TICKET-ID]`.
   - `Description` is a concise imperative-mood summary, e.g. `CORE-3386: Add retry logic to webhook dispatcher`.
5. Generate the PR body:
   - If `.github/pull_request_template.md` exists, follow it exactly (same verbatim-reproduction and checklist rules as "Little PR description"), reflecting the FULL branch delta, not just the last commit.
   - Otherwise draft a concise plain description.
6. Create the PR as a DRAFT: `gh pr create --draft`, using a HEREDOC for the body.

Return: the created draft PR URL and title.
```

### Output Format

The created draft PR URL (titled `IDENTIFIER: Description`) plus a one-line summary, relayed from the subagent.

---

## Examples

### Example: Little commit message

Input: `Little commit message`

Output: a concise Markdown block containing the proposed commit message, produced by the spawned Haiku subagent.

### Example: Little create commit

Input: `Little create commit`

Output: the created commit hash plus a short confirmation summary.

### Example: Little PR description

Input: `Little PR description`

Output: the repository template filled with concise, ready-to-use content.

### Example: Little create PR

Input: `Little create PR`

Output: the created draft PR URL (titled `IDENTIFIER: Description`) plus a one-line summary.
