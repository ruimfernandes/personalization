---
name: little
description: Generates or creates concise commit messages, commits, PR descriptions, and pull requests from repository changes. Use when the user starts a prompt with "Little", especially for "Little commit message", "Little create commit", "Little PR description", or "Little create PR".
---

# Little

Own concise git writing and creation tasks.

## Trigger Handling

When the prompt starts with `Little`:

1. Detect the intent:
   - `commit message`
   - `create commit`
   - `PR description`
   - `create PR`
2. Inspect the relevant git state before writing anything.
3. Return only the requested artifact unless the user explicitly asked you to execute the git or GitHub action.

If the request is ambiguous, ask one short clarifying question.

## Shared Rules

- Keep output concise, reviewer-friendly, and focused on why.
- Follow recent repository commit style when drafting commit titles.
- Never commit likely secret files such as `.env` or credentials exports without warning the user.
- Never push or create a PR unless the user explicitly asks for it.
- If tests were not run, say so explicitly.
- When a repository contains `.github/pull_request_template.md`, use that template's structure and ordering exactly for PR description work.
- Use HEREDOCs for multiline commit messages and `gh pr create` bodies.

## Mode: Little commit message

Draft a ready-to-use commit message from the relevant diff.

### Workflow

1. Inspect staged and unstaged changes unless the user asked for staged-only.
2. Infer the actual intent of the change.
3. Draft a concise message that matches the repo's recent style.

### Rules

- Prefer conventional-style prefixes when they fit naturally:
  - `feat`
  - `fix`
  - `refactor`
  - `chore`
  - `test`
  - `docs`
- Use imperative mood.
- Omit scope if it is unclear.
- Optional body: 1-2 short sentences focused on motivation or impact, not a mini changelog.

### Output Format

````markdown
## Commit Message
```text
<type>(<scope>): <short summary>

<optional body>
```
````

## Mode: Little create commit

Create a git commit when the user explicitly asks for it.

### Workflow

1. Inspect:
   - all untracked and modified files with `git status`
   - staged and unstaged changes with `git diff`
   - recent commit messages with `git log`
2. Decide which files belong in the commit and stage only those.
3. Draft the message using the `Little commit message` rules.
4. Create the commit with a HEREDOC message.
5. Run `git status` after the commit to verify success.

### Rules

- Do not create an empty commit.
- Do not amend unless the user explicitly asked for it.
- Do not bypass hooks.
- If a hook fails, fix the issue and create a new commit instead of amending a failed attempt.
- Keep the message concise and biased toward why the change exists.

## Mode: Little PR description

Draft the PR body in repository-ready Markdown.

### Workflow

1. Read `.github/pull_request_template.md` from the repository root first.
2. Inspect the branch diff and included commits.
3. Fill the template exactly, preserving section order and checklist structure.

### Verbatim Question Text

- Reproduce every question, heading, and label from the template **byte-for-byte**, including punctuation, capitalisation, and whitespace. Copy the text from the file rather than retyping it.
- Do **not** "correct" what looks like a typo. If a question ends with `PR??` or contains other apparent mistakes, keep it exactly as written — CI matches the PR body against the canonical template by exact text, so any change (even fixing a doubled `?`) makes the question fail to match and the check reports it as missing.
- The only text you add is your own answers and the checklist ticks. Never alter the question text itself.

### Required Template Behavior

- `Why`: include the ticket link when available plus a concise summary of what changed and why. Render the ticket link with the full URL as the link text, not a label like `Task`. For example, use `[https://get-sona.atlassian.net/browse/CORE-2294](https://get-sona.atlassian.net/browse/CORE-2294)`, not `[Task](https://get-sona.atlassian.net/browse/CORE-2294)`.
- `Screenshots & Demo`: leave a placeholder reminder for screenshots or a loom when needed. **When updating an existing PR** (e.g. the user asks to update the PR based on the current branch changes), if this section already contains a Loom URL, preserve it exactly as-is — do not replace, remove, or overwrite it with a placeholder. Example to keep untouched:

  ```markdown
  ## Screenshots & Demo
  https://www.loom.com/share/12d883e3e7af43c4b83ff023291938ca
  ```
- Checklist sections: answer every question based on the implementation.
- Free-text security questions: provide short accurate answers, or `N/A` when not applicable.

### Checklist Rule

When a question offers both `Yes` and `N/A`, always render both options and mark exactly one:

```markdown
- [x] Yes
- [ ] N/A
```

or

```markdown
- [ ] Yes
- [x] N/A
```

Never remove one of the options.

## Mode: Little create PR

Create the PR when the user explicitly asks for it.

### Workflow

1. Inspect:
   - `git status`
   - staged and unstaged `git diff`
   - whether the current branch tracks a remote branch and is up to date
   - recent `git log`
   - `git diff <base-branch>...HEAD`
2. Ask for the base branch if it is unclear.
3. Push with `git push -u origin HEAD` if the branch is not yet on the remote. If the push is rejected, see `Push Troubleshooting` before giving up.
4. Generate the PR title following the `PR Title Format` rule and the body from the included commits and diff.
5. Create the PR as a draft with `gh pr create --draft`, using a HEREDOC for the body.
6. Return the PR URL.

### PR Title Format

- The PR title must always be `IDENTIFIER: Description`, where `IDENTIFIER` is the JIRA ticket id.
- Derive the identifier from the JIRA ticket link or, failing that, the branch name. Examples:
  - `https://get-sona.atlassian.net/browse/DOC-3148` → `DOC-3148`
  - `https://get-sona.atlassian.net/browse/CORE-3386` → `CORE-3386`
- `Description` is a concise summary of the change in imperative mood, e.g. `CORE-3386: Add retry logic to webhook dispatcher`.
- If no JIRA identifier can be found, ask the user for the ticket id before creating the PR.

### Rules

- Always open the PR as a draft (`gh pr create --draft`).
- The PR body must follow `.github/pull_request_template.md` exactly when that file exists.
- The PR summary should reflect the full branch delta, not just the last commit.
- If the user asked only for the description, do not create the PR.

### Push Troubleshooting

If `git push` is rejected with a message like:

```
! [remote rejected] HEAD -> <branch> (Unable to determine if workflow can be created or updated due to timeout; `workflows` scope may be required.)
```

do **not** assume the token simply lacks the `workflows` scope and stop there. This rejection is frequently caused by the **branch being based on a stale `master`**: GitHub's pre-receive workflow check times out evaluating the large/old diff, eve
n when the branch touches no `.github/workflows/` files.

Resolution order:

1. **Rebase onto latest base, then retry the push** (this resolves the timeout in most cases):
   ```bash
   git fetch origin <base-branch>
   git rebase origin/<base-branch>
   git push -u origin HEAD
   ```
   `<base-branch>` is usually `master` (or `main`).
2. If the rebase produces conflicts, stop and report them — do not force-resolve without the user.
3. Only if the push **still** fails after a clean rebase, treat it as a genuine credentials/scope problem:
   - The fine-grained PAT may need the **Workflows** repository permission set to **Read and write**, or
   - The remote may need to use SSH instead of HTTPS.
   - Ask the user to push themselves (e.g. `! git push -u origin HEAD`) or fix the token, then retry.

Do not retry the same `git push` more than twice without changing something (rebasing, fixing the token, or switching remote protocol) — repeated identical pushes will keep failing identically.

## Examples

### Example: Little commit message

Input: `Little commit message`

Output: a concise Markdown block containing the proposed commit message.

### Example: Little create commit

Input: `Little create commit`

Output: the created commit hash plus a short confirmation summary.

### Example: Little PR description

Input: `Little PR description`

Output: the repository template filled with concise, ready-to-use content.

### Example: Little create PR

Input: `Little create PR`

Output: the created draft PR URL (titled `IDENTIFIER: Description`) plus a one-line summary.
