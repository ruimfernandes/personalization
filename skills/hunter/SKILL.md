---
name: hunter
description: Hunt down and fix CodeRabbit review comments and failing GitHub Actions from a PR. Use when the user says "Hunter" followed by a GitHub PR URL or attached PR reference, or asks to address CodeRabbit comments or fix CI failures from a pull request.
---

# Hunter - PR Issue Resolver

Systematically address CodeRabbit review comments AND failing GitHub Actions from a PR, creating a separate commit for each fix.

## Trigger

User says "Hunter" followed by:
- A GitHub PR URL (e.g., `Hunter https://github.com/owner/repo/pull/123`)
- An attached PR reference (e.g., `Hunter @PR 20318: owner/repo`)

## Workflow

**The Hunter performs four main tasks in order:**
1. **Check and fix failing GitHub Actions** (CI failures, test failures)
2. **Address CodeRabbit review comments**
3. **Address github-actions bot review comments**
4. **Address the human reviewer's comments** (default: `ruimfernandes`)

---

## Part A: GitHub Actions Failures

### Step A1: Check CI Status

Use the GitHub CLI to check the status of all checks on the PR:

```bash
gh pr checks {pr_number} --repo {owner}/{repo}
```

This returns a list of all checks with their status (pass/fail/pending).

### Step A2: Identify Failing Actions

Look for failing checks, prioritizing:
1. **`Backend CI / Code Quality (push)`** - Linting, formatting, compilation warnings
2. **`Backend CI / Test (push)`** or similar test jobs - Test failures
3. **Any other failing CI jobs**

### Step A3: Get Failure Details

For each failing check, get the detailed logs:

```bash
# List workflow runs for the PR
gh run list --repo {owner}/{repo} --branch {branch_name} --limit 5

# Get the failed run ID from the list, then view logs
gh run view {run_id} --repo {owner}/{repo} --log-failed
```

Parse the logs to identify:
- **Code Quality failures**: Credo issues, unused variables, compilation warnings, formatting errors
- **Test failures**: Which test files and test names are failing

### Step A4: Fix Code Quality Issues

For `Backend CI / Code Quality` failures:

1. **Credo issues**: Read the file, apply the suggested fix
2. **Unused variables**: Prefix with underscore or remove
3. **Compilation warnings**: Address the specific warning
4. **Formatting**: Run `mix format` on the affected files

Create a commit:
```
fix: address CI code quality issues

- {brief description of each fix}
```

### Step A5: Fix Test Failures

For test failures:

1. **Extract the failing test** from the logs (file path and test name)
2. **Run the test locally** to reproduce:
   ```bash
   cd backend && mix test {test_file}:{line_number} --trace
   ```
3. **If test passes locally**: This is a **flaky test** - inform the user:
   > "⚠️ **Flaky Test Detected**: The test `{test_name}` in `{file_path}` fails on GitHub CI but passes locally. This indicates a flaky test that may depend on timing, external services, or test order. Consider investigating race conditions, async operations, or external dependencies."
   
4. **If test fails locally**: 
   - Analyze the failure
   - Read the test file and implementation code
   - Fix the issue
   - Run the test again to confirm the fix
   - Create a commit:
   ```
   fix: resolve failing test - {test_name}
   
   {brief description of what was fixed}
   ```

### Step A6: Verify Fixes

After applying fixes for Part A, do **not** push yet — Parts B and C may add more commits, and Part D handles the single push + per-comment reply flow.

---

## Part B: CodeRabbit Comments

### Step B1: Extract PR Information

Parse the GitHub URL or attached PR reference to get owner, repo, and PR number:

```
https://github.com/{owner}/{repo}/pull/{pr_number}
```

Or from attached PR: `@PR {pr_number}: {owner}/{repo}`

### Step B2: Fetch CodeRabbit Comments

**Priority order for fetching comments:**

#### Option A: Attached PR Data (Preferred)
If the user attached a PR, check for pre-fetched comments in the Cursor projects folder:

```
~/.cursor/projects/{workspace-path}/pull-requests/pr-{number}/comments.json
```

This file contains structured comment data including:
- `threadsByFile`: Comments organized by file path
- `unresolvedThreads`: Count of unresolved comments
- `isResolved`: Whether each thread is resolved

#### Option B: GitHub CLI (Fallback)

If no attached data exists, use the GitHub CLI:

```bash
# First, check if gh is available and not aliased
command -v gh 2>/dev/null | grep -v alias

# If gh is aliased or not found, try common paths
/opt/homebrew/bin/gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate
# or
/usr/local/bin/gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate
```

**Troubleshooting gh CLI issues:**
- If `gh` is aliased to something else, use the full path
- If `gh` is not installed, inform the user: "GitHub CLI not found. Install with `brew install gh` and authenticate with `gh auth login`"
- Use `\gh` or `command gh` to bypass shell aliases

Filter comments where `user.login` is `"coderabbitai[bot]"` or `authorLogin` contains `coderabbit`.

> **Note**: The GitHub API returns bot accounts with a `[bot]` suffix (e.g. `coderabbitai[bot]`, `github-actions[bot]`). Always match with the suffix or use a contains/startswith check — filtering for just `"coderabbitai"` will miss all comments.

### Step B3: Group Comments by File

Organize the CodeRabbit comments by file path. Each comment contains:
- `path`: The file being commented on
- `body`: The comment/suggestion content
- `line` or `original_line`: Line number
- `isResolved`: Whether the comment thread is resolved (skip if true)
- `diff_hunk`: Code context (from gh CLI)

### Step B4: Filter and Prioritize

1. **Skip resolved comments**: Check `isResolved: true` and skip those — no reply needed (already closed)
2. **Skip already-addressed**: Look for "Addressed in commit" or similar in comment body — no reply needed
3. **Handle "Also applies to"**: Some comments mention multiple line ranges - address all of them
4. **Prioritize by severity**: Address Major issues before Minor ones

When skipping an unresolved comment for any other reason (false positive, out of scope, not applicable), **post a reply explaining why** using the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {reason}"
```

### Step B5: Process Each Comment

For each unresolved CodeRabbit comment:

1. **Read the file** at the specified path
2. **Understand the suggestion** from the comment body (look for `Suggested fix` or `Proposed fix` sections)
3. **Apply the fix** following the suggestion
4. **Handle "Also applies to"**: If the comment mentions other locations, fix those too
5. **Create a commit** with a descriptive message
6. **Track the comment → commit mapping** so you can reply after pushing (see Part D)

#### Commit Message Format

```
fix: address CodeRabbit review - {brief description}

Addresses CodeRabbit suggestion in {file_path}:
{first line of the suggestion}
```

### Step B6: Final Summary

After processing both CI failures and CodeRabbit comments, provide a comprehensive summary:

**CI Status:**
- Code Quality issues fixed (with commit hash)
- Test failures fixed (with commit hash)
- Flaky tests identified (tests that pass locally but fail on CI)

**CodeRabbit Comments:**
- Total comments found
- Comments addressed (with commit hashes)
- Comments skipped (and why - resolved, already fixed, etc.)

## Important Notes

- **One commit per logical fix**: Group related changes (e.g., "Also applies to" locations) into a single commit
- **Skip duplicates**: If the same suggestion appears multiple times, address it once
- **Skip already-fixed**: If the code already implements the suggestion, skip it
- **Skip resolved**: Comments marked as resolved have already been addressed
- **Ask if unclear**: If a suggestion is ambiguous or would require significant changes, ask the user before proceeding

## Comment Structure (from comments.json)

```json
{
  "threadsByFile": {
    "path/to/file.ex": [
      {
        "id": "PRRT_xxx",
        "path": "path/to/file.ex",
        "line": 42,
        "startLine": 40,
        "isResolved": false,
        "comments": [
          {
            "id": "PRRC_xxx",
            "body": "The suggestion content with <details> sections...",
            "authorLogin": "coderabbitai",
            "createdAt": "2024-01-01T00:00:00Z"
          }
        ]
      }
    ]
  }
}
```

## Example Session

```
User: Hunter @PR 20318: sona-is/sona

Agent:
=== PART A: Checking GitHub Actions ===

1. Checking CI status for PR #20318...
2. Found 2 failing checks:
   - ❌ Backend CI / Code Quality (push) - Failed
   - ❌ Backend CI / Test (push) - Failed

3. Fetching failure logs...

4. Code Quality Issues:
   - warning: variable `old_status` is unused (payroll_management.ex:1148)
   - [Credo] Modules should have a @moduledoc tag (new_module.ex:1)
   
   [Fixes issues, creates commit]
   ✓ Committed: "fix: address CI code quality issues"

5. Test Failures:
   - test/backend/products/payroll/payroll_management_test.exs:2560 - "updates record status"
   
   Running test locally... ✓ Test PASSES locally
   
   ⚠️ **Flaky Test Detected**: The test "updates record status" in 
   `payroll_management_test.exs` fails on GitHub CI but passes locally. 
   This indicates a flaky test that may depend on timing, external services, 
   or test order.

=== PART B: CodeRabbit Comments ===

6. Reading comments from ~/.cursor/projects/.../pr-20318/comments.json
7. Found 4 CodeRabbit comment threads:
   - ✓ RESOLVED: index.ex (line 1326): N+1 query issue
   - ⚠ UNRESOLVED: payroll_management.ex (line 1148): Tenant isolation
   - ⚠ UNRESOLVED: payroll_management_test.exs (line 2560): Use Repo.update!
   - ⚠ UNRESOLVED: payroll_management_test.exs (line 2605): Pass org struct

8. Addressing unresolved comment 1/3: payroll_management.ex
   [Makes fix, creates commit]
   ✓ Committed: "fix: address CodeRabbit review - scope joins by organisation_id"

... and so on

=== PART C: github-actions Comments ===

9. Fetching github-actions inline and issue-level comments...
10. Found 2 github-actions comment threads:
    - ⚠ UNRESOLVED: payroll_management.ex (line 55): Credo - module missing @moduledoc
    - ⚠ UNRESOLVED: payroll_management.ex (line 210): Credo - prefer guard clauses

11. Addressing unresolved comment 1/2: payroll_management.ex
    [Makes fix, creates commit]
    ✓ Committed: "fix: address github-actions review - add @moduledoc and guard clauses"

=== SUMMARY ===
- CI Issues Fixed: 2 (code quality)
- Flaky Tests Identified: 1 (needs investigation)
- CodeRabbit Comments Addressed: 3
- CodeRabbit Comments Skipped: 1 (resolved)
- github-actions Comments Addressed: 2
- github-actions Comments Skipped: 0
```

---

## Part C: github-actions Bot Comments

### Step C1: Fetch github-actions Comments

Fetch from **three** endpoints — the bot posts to all of them:

#### 1. PR review summaries (review-level body, e.g. `#pullrequestreview-XXXXXXX`)

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --paginate
```

Filter entries where `user.login` is `"github-actions[bot]"`. The `body` field contains the full review summary text.

#### 2. Inline PR review comments (e.g. `#discussion_rXXXXXXX`)

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate
```

Filter where `user.login` is `"github-actions[bot]"`. These are the per-line inline comments tied to a specific file and diff hunk.

#### 3. Issue-level (PR thread) comments

```bash
gh api repos/{owner}/{repo}/issues/{pr_number}/comments --paginate
```

Filter the same way.

> **Note**: Always filter with the `[bot]` suffix — `"github-actions"` alone will match nothing.

### Step C2: Group and Prioritize

Organize comments by source and file. Fields vary by endpoint:

- **Review summaries** (`/reviews`): no `path`/`line` — contains a full `body` with categorized findings; parse it for actionable items
- **Inline comments** (`/pulls/comments`): `path`, `line`/`original_line`, `body`, `diff_hunk`
- **Issue comments** (`/issues/comments`): no `path`/`line` — treat like review summaries

Common sources of `github-actions[bot]` comments include:
- **Credo / mix credo**: Inline style and code-quality suggestions
- **Coverage reports**: File-level coverage drops
- **Custom lint bots**: Project-specific automated checks

### Step C3: Filter

1. **Skip already-addressed**: Look for "Addressed in commit", "Fixed in", or "Resolved" in the thread — no reply needed
2. **Skip outdated**: If the comment's `position` is `null` the line was changed — use `diff_hunk` context to find the new location; if still not actionable, skip and reply
3. **Skip informational**: Comments that are purely informational (e.g. summary stats) with no actionable suggestion — skip and note them in the summary (no reply needed for informational-only content)

Whenever you skip an **actionable-looking** comment (false positive, not applicable to this codebase/language, already addressed elsewhere), **post a reply explaining why** using the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {reason}"
```

Use the inline comment `id` field for `{comment_id}`. For review-summary findings (from `/reviews`), there is no per-finding comment ID to reply to — note them in the summary only.

### Step C4: Process Each Comment

For each actionable unresolved `github-actions` comment:

1. **Read the file** at the specified path
2. **Understand the suggestion** from the comment body
3. **Apply the fix** following the suggestion (same process as Part B Step B5)
4. **Create a commit**:
   ```
   fix: address github-actions review - {brief description}

   Addresses automated suggestion in {file_path}:{line}:
   {first line of the suggestion}
   ```
5. **Track the comment → commit mapping** so you can reply after pushing (see Part D)

### Step C5: Update Summary

Add to the final summary:

**github-actions Comments:**
- Total comments found
- Comments addressed (with commit hashes)
- Comments skipped (and why — informational, outdated, already fixed)

---

## Part D: Human Reviewer Comments

Address review comments left by the human reviewer. The default reviewer is **`ruimfernandes`**; if the user names a different reviewer in the prompt, use that login instead.

> Unlike bot comments, human comments are not always a code suggestion — they may be questions, requests for clarification, or discussion. Decide per comment whether it is **actionable** (apply a fix + commit) or **discussion-only** (reply with an answer, no commit).

### Step D1: Fetch Reviewer Comments

Fetch from the same three endpoints used for `github-actions` (the reviewer can post to all of them):

```bash
# Inline PR review comments (per-line, tied to a file + diff hunk)
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate

# PR review summaries (review-level body)
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --paginate

# Issue-level (PR thread) comments
gh api repos/{owner}/{repo}/issues/{pr_number}/comments --paginate
```

Filter where `user.login` is exactly `"ruimfernandes"` (or the reviewer the user specified).

> **Note**: Human logins have **no `[bot]` suffix** — match the login exactly. Do not apply the `[bot]` filtering rule from Parts B and C here.

### Step D2: Group and Prioritize

Organize by file and source, same as Part C:
- **Inline comments** (`/pulls/comments`): `path`, `line`/`original_line`, `body`, `diff_hunk`
- **Review summaries** (`/reviews`) and **issue comments** (`/issues/comments`): no `path`/`line` — parse the `body` for actionable items

### Step D3: Filter and Classify

For each unresolved reviewer comment, classify it:

1. **Skip resolved / already-addressed**: If the thread is resolved or a reply already says it was fixed — no reply needed
2. **Actionable** (a concrete change request or suggestion): apply the fix (Step D4)
3. **Discussion-only** (a question, opinion, or request for clarification with no clear single fix): do **not** guess at a code change — reply with an answer in Step E, or, if the right action is genuinely ambiguous, **ask the user** before proceeding (per the "Ask if unclear" rule)

### Step D4: Process Each Actionable Comment

1. **Read the file** at the specified path
2. **Understand the request** from the comment body
3. **Apply the fix** following the request (same process as Part B Step B5)
4. **Create a commit**:
   ```
   fix: address review comment - {brief description}

   Addresses {reviewer} comment in {file_path}:{line}:
   {first line of the comment}
   ```
5. **Track the comment → commit mapping** so you can reply after pushing (see Part E)

### Step D5: Update Summary

Add to the final summary:

**Reviewer Comments ({reviewer}):**
- Total comments found
- Comments addressed (with commit hashes)
- Comments answered without a code change (discussion-only)
- Comments skipped (and why — resolved, already fixed)

---

## Part E: Reply to Comments After Pushing

**This step is mandatory.** After all fixes have been committed for Parts A–D, push everything and post a reply to every comment Hunter touched — the ones that were addressed, the ones that were skipped because they don't make sense to apply, and discussion-only reviewer comments that warrant an answer.

### Step E1: Push All Commits

```bash
git push
```

Capture the SHAs of every commit Hunter created (Parts A, B, C, and D) so each comment can be replied to with its specific commit hash. Keep the comment-id → commit-sha mapping you tracked in Steps B5, C4, and D4.

For each captured SHA, also grab its commit name (subject line) and build its commit URL:

```bash
git log -1 --format=%s {commit_sha}
```

```
https://github.com/{owner}/{repo}/commit/{commit_sha}
```

### Step E2: Reply to Addressed Comments

For each CodeRabbit / github-actions / reviewer inline comment that Hunter addressed with a commit, post a reply naming the commit, with the hash linked to its commit URL — a later rebase can rewrite the SHA into a dangling reference, so the commit name keeps the reply meaningful even if the linked hash no longer resolves:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  --method POST \
  --field body="Change applied on commit {commit_name}([{commit_sha}](https://github.com/{owner}/{repo}/commit/{commit_sha}))"
```

Use the inline comment's `id` (e.g. `PRRC_xxx` or numeric ID returned by `gh api`) for `{comment_id}`. One reply per addressed comment — even if multiple comments map to the same commit, reply on each individually.

### Step E3: Reply to Skipped Comments

For each unresolved comment Hunter chose **not** to apply (false positive, out of scope, not applicable, already addressed elsewhere, informational-only that still warrants a response, etc.), post a reply with the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {explanation}"
```

The explanation should be specific — say *why* the change wasn't applied, not just "skipped". Examples:
- `Hunter (Rui's skill) feedback: false positive — this code path is only reached when {condition}, so the suggested guard is unnecessary.`
- `Hunter (Rui's skill) feedback: out of scope for this PR — the refactor would touch {N} unrelated callers; tracked separately.`
- `Hunter (Rui's skill) feedback: already addressed in commit {commit_name}([{sha}](https://github.com/{owner}/{repo}/commit/{sha})) via a different approach.`

### Step E4: Reply to Discussion-Only Reviewer Comments

For each human reviewer comment classified as discussion-only in Step D3 (a question or clarification with no code change), post a direct answer using the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {answer}"
```

If answering would require a decision Hunter shouldn't make on its own, surface it to the user instead of replying automatically.

### Step E5: Notes

- **Review-summary findings** (from `/pulls/{pr_number}/reviews`) have no per-finding comment ID — note them in the final summary instead of replying.
- **Resolved threads** are skipped silently — no reply needed.
- **Already-addressed comments** (where someone else's earlier reply or commit already mentions the fix) are skipped silently — no reply needed.
- Always use the format `commit name([{sha}](https://github.com/{owner}/{repo}/commit/{sha}))` — the full SHA link resolves regardless of future force-pushes or rebases, and the commit name keeps the reply readable even when the PR UI shows a different (rebased) short hash.

---

## Edge Cases

### CodeRabbit Comments
- **PR from fork**: May need different auth - warn user if access denied
- **Outdated comments**: If line numbers don't match current code, use the context to locate the right section
- **Resolved comments**: Skip comments that are already marked as resolved
- **gh alias conflicts**: Use full path to gh binary or `command gh` to bypass aliases
- **gh not installed**: Inform user and provide installation instructions

### github-actions Bot Comments
- **No comments found**: Skip Part C and note it in the summary
- **Wrong login filter**: The API returns `github-actions[bot]` and `coderabbitai[bot]` — filtering for `"github-actions"` or `"coderabbitai"` (without `[bot]`) returns zero results. Always use the full login with the `[bot]` suffix.
- **Missing the review endpoint**: Bot review summaries appear in `/pulls/{pr_number}/reviews`, NOT in `/pulls/{pr_number}/comments` or `/issues/{pr_number}/comments`. Always query all three endpoints.
- **Purely informational comments** (e.g. coverage summaries, deployment links): Skip — no actionable fix needed
- **Outdated inline comments** (`position: null`): Use `diff_hunk` to locate the equivalent line in the current file state
- **Duplicate suggestions**: If `github-actions[bot]` and CodeRabbit flag the same issue, the Part B fix counts — skip the duplicate in Part C

### Human Reviewer Comments
- **No `[bot]` suffix**: Match the human login exactly (e.g. `ruimfernandes`) — the `[bot]` filtering rule from Parts B/C does not apply here
- **Different reviewer**: If the user names another reviewer in the prompt, filter for that login instead of the `ruimfernandes` default
- **Not all comments are fixes**: Treat questions/clarifications as discussion-only — answer them (Step E4) rather than guessing at a code change
- **Ambiguous requests**: If the right fix isn't clear, ask the user before applying anything (per "Ask if unclear")
- **Duplicate of a bot comment**: If the reviewer echoes something a bot already flagged, the earlier Part B/C fix counts — skip the duplicate and reply noting it

### GitHub Actions / CI
- **All checks passing**: Skip Part A and proceed directly to Part B (CodeRabbit comments)
- **Pending checks**: Inform user that checks are still running, offer to wait or proceed with CodeRabbit comments
- **Flaky tests**: If a test passes locally but fails on CI, clearly inform the user this is a flaky test - do NOT create a fix commit
- **Environment-specific failures**: Some failures may be due to CI environment differences (e.g., database, external services) - inform the user
- **Log access issues**: If unable to fetch logs, suggest the user check GitHub Actions UI directly
- **Multiple failing jobs**: Address Code Quality first (usually simpler), then Test failures
