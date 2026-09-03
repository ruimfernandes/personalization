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

## Comment Threads: One Reply Per Thread

Parts B, C, and D are organised by **author**, but GitHub organises inline comments by **thread**. These two groupings do not line up: a `coderabbitai[bot]` comment and a `github-actions[bot]` comment are frequently two comments in the *same* thread, and a human reviewer can reply inside a bot's thread. Treating each author as a separate population and replying per author puts **two Hunter replies on one thread**.

**The rule: one Hunter reply per thread, never one per comment.**

### Step T1: Build the thread-grouped comment set once

Every inline comment from `/pulls/{pr_number}/comments` carries:

- `id` — this comment
- `in_reply_to_id` — present **only** when this comment is a reply inside an existing thread; it holds the **root comment's `id`**

So the thread key is:

```
thread_root_id = comment.in_reply_to_id or comment.id
```

Fetch inline comments **once** for the whole run and group them:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate \
  --jq 'group_by(.in_reply_to_id // .id)
        | map({thread_root_id: (.[0].in_reply_to_id // .[0].id),
               path: .[0].path,
               line: (.[0].line // .[0].original_line),
               comments: map({id, login: .user.login, body})})'
```

Steps B2, C1, and D1 then **filter this one grouped set** by author instead of re-fetching a flat per-author list. The same thread will often appear in Part B *and* Part C — that overlap is exactly what this section exists to catch.

### Step T2: Consequences for the rest of the workflow

1. **Address a thread as a whole, once.** Read every comment in a thread before changing any code — a later reply may narrow, contradict, or already answer the root. Fixing the CodeRabbit root in Part B and then separately "fixing" the `github-actions[bot]` reply in Part C is the same work done twice.
2. **Reply to the thread root.** Pass `thread_root_id` as the comment id in every `/replies` call — not the `id` of a reply nested inside the thread.
3. **One consolidated reply per thread.** If a thread's findings were partly applied and partly skipped, write a single reply covering both outcomes rather than an E2 reply *and* an E3 reply on the same thread.
4. **Never post a second Hunter reply to a thread.** Before posting, scan the thread's comments for one authored by the current user (`gh api user --jq .login`) whose body starts with `Change applied on commit` or `Hunter (Rui's skill) feedback:`. If one exists, **edit it** instead of adding another:
   ```bash
   gh api repos/{owner}/{repo}/pulls/comments/{existing_reply_id} \
     --method PATCH \
     --field body="{consolidated body}"
   ```
   (Editing a single review comment uses the no-PR-number form of the path; only `/replies` needs the PR number.)
5. **Count threads, not comments, in the summary.** Report "3 threads addressed (5 comments)" rather than double-counting one thread under two authors.

Review summaries (`/pulls/{pr_number}/reviews`) and issue-level comments (`/issues/{pr_number}/comments`) are not threaded this way and are unaffected by this section.

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

> **Filter threads, not comments**: work from the thread-grouped set built in **Step T1** and select every thread that *contains* a `coderabbitai[bot]` comment. A thread selected here may also contain `github-actions[bot]` or reviewer comments — handle all of them now, as one unit, and mark the thread done so Parts C and D skip it.

> **Note**: The GitHub API returns bot accounts with a `[bot]` suffix (e.g. `coderabbitai[bot]`, `github-actions[bot]`). Always match with the suffix or use a contains/startswith check — filtering for just `"coderabbitai"` will miss all comments.

### Step B3: Group Comments by Thread, Then by File

Group by `thread_root_id` first (**Step T1**), then organise those threads by file path. Each comment contains:
- `path`: The file being commented on
- `body`: The comment/suggestion content
- `line` or `original_line`: Line number
- `id`: This comment's id
- `in_reply_to_id`: The root comment id when this comment is a reply within a thread — absent on thread roots
- `isResolved`: Whether the comment thread is resolved (skip if true)
- `diff_hunk`: Code context (from gh CLI)

A thread's `path`/`line` come from its **root**; replies inside it carry the same location. Never treat a reply as a standalone comment with its own fix and its own reply.

### Step B4: Filter and Prioritize

1. **Skip resolved comments**: Check `isResolved: true` and skip those — no reply needed (already closed)
2. **Skip already-addressed**: Look for "Addressed in commit" or similar in comment body — no reply needed
3. **Handle "Also applies to"**: Some comments mention multiple line ranges - address all of them
4. **Prioritize by severity**: Address Major issues before Minor ones

When skipping an unresolved comment for any other reason (false positive, out of scope, not applicable), **post a reply explaining why** using the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{thread_root_id}/replies \
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

=== COMMENT THREADS: grouping inline comments ===

6. Fetching /pulls/20318/comments once, grouping by (in_reply_to_id // id)...
   Found 6 inline comments across 4 threads:
   - thread 111 index.ex:1326                  [coderabbitai] (resolved)
   - thread 222 payroll_management.ex:1148     [coderabbitai, github-actions]  ← 2 comments, 1 thread
   - thread 333 payroll_management_test.exs:2560 [coderabbitai]
   - thread 444 payroll_management.ex:210      [github-actions]

   Note thread 222: a github-actions Credo reply sits inside a CodeRabbit
   thread. It is ONE thread and gets ONE reply — handled in Part B, skipped
   in Part C.

=== PART B: CodeRabbit Comments ===

7. Threads containing a coderabbitai[bot] comment: 111, 222, 333
   - ✓ RESOLVED: thread 111 index.ex (line 1326): N+1 query issue — skip silently
   - ⚠ UNRESOLVED: thread 222 payroll_management.ex (line 1148): Tenant isolation
     ↳ reply in-thread [github-actions]: Credo - prefer guard clauses
   - ⚠ UNRESOLVED: thread 333 payroll_management_test.exs (line 2560): Use Repo.update!

8. Addressing thread 222 (both comments read before changing anything):
   [Makes fix, creates commit]
   ✓ Committed: "fix: address CodeRabbit review - scope joins by organisation_id"
   → thread 222 marked handled; Part C will skip it

... and so on

=== PART C: github-actions Comments ===

9. Threads containing a github-actions[bot] comment: 222, 444
    - ⏭ SKIP thread 222 — already handled in Part B (its github-actions
      comment has in_reply_to_id: 222, so it is not a new thread)
    - ⚠ UNRESOLVED: thread 444 payroll_management.ex (line 210): Credo - guard clauses

10. Also fetching /pulls/20318/reviews and /issues/20318/comments
    (not threaded — unaffected by grouping):
    - ℹ INFORMATIONAL: coverage summary — note in summary, no reply

11. Addressing thread 444: payroll_management.ex
    [Makes fix, creates commit]
    ✓ Committed: "fix: address github-actions review - prefer guard clauses"

=== PART E: Replies (one per thread) ===

12. Collapsing comment → commit map onto threads:
    - thread 222 → a1b2c3d  (covers BOTH its comments — one reply, not two)
    - thread 333 → e4f5a6b
    - thread 444 → c7d8e9f
    3 replies for 5 unresolved comments — expected and correct.

13. POST repos/sona-is/sona/pulls/20318/comments/222/replies
    (note the PR number: pulls/comments/222/replies would 404)

=== SUMMARY ===
- CI Issues Fixed: 2 (code quality)
- Flaky Tests Identified: 1 (needs investigation)
- Threads Addressed: 3 (5 comments)
- Threads Skipped: 1 (thread 111, resolved)
- Duplicate Threads Collapsed: 1 (thread 222, CodeRabbit + github-actions)
- Replies Posted: 3 (one per thread)
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

> **Check `in_reply_to_id` first**: `github-actions[bot]` inline comments are very often **replies inside CodeRabbit threads**, not a separate population. For each one, resolve its `thread_root_id` (**Step T1**) and check whether that thread was already handled in Part B. If it was, do **not** process it again and do **not** reply again — fold anything new it raises into the Part B thread's single consolidated reply.

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
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{thread_root_id}/replies \
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

> **Check `in_reply_to_id` too**: a reviewer comment is often a reply inside a bot thread. Resolve its `thread_root_id` (**Step T1**); if that thread was already handled in Part B or C, fold the reviewer's point into that thread's single consolidated reply instead of opening a second one.

### Step D2: Group and Prioritize

Organize by file and source, same as Part C:
- **Inline comments** (`/pulls/comments`): `path`, `line`/`original_line`, `body`, `diff_hunk`
- **Review summaries** (`/reviews`) and **issue comments** (`/issues/comments`): no `path`/`line` — parse the `body` for actionable items

### Step D3: Filter and Classify

For each unresolved reviewer comment, classify it:

1. **Skip resolved / already-addressed**: If the thread is resolved or a reply already says it was fixed — no reply needed
2. **Actionable** (a concrete change request or suggestion): apply the fix (Step D4)
3. **Discussion-only** (a question, opinion, or request for clarification with no clear single fix): do **not** guess at a code change — reply with an answer in Step E, or, if the right action is genuinely ambiguous, **ask the user** before proceeding (per the "Ask if unclear" rule)

### Step D3a: Detect "Matt Pocock" Format Comments

Independently of the actionable/discussion-only classification above, check whether the comment matches the **"Matt Pocock" format**: authored by `ruimfernandes` (or the reviewer login the user specified) **and** its body text begins with the literal header `## Matt Pocock`.

If it matches, tag it for the extra handling in **Step E3a** — regardless of whether it ends up actioned (Step D4), or resolved via discussion (Step E4).

A "Matt Pocock" comment is a **review, not a single request**: one comment body typically carries many independent findings, each with its own outcome. Do not collapse them into one verdict. Enumerate the findings first, then track them individually.

**Enumerate the findings.** Walk the body and list every *actionable* finding — a bulleted judgement call, a lettered/numbered finding, a bold-headed paragraph making a claim about the code. Then exclude the lines that only report an absence of work:

- `**(a) Missing/partial requirements:** None …`
- `**No hard violations found.**`
- `### Strengths`, summary/roll-up paragraphs, scope notes

Those are **not findings** and must never be marked — a ✅ on a "nothing missing" line falsely implies work happened there. The count you put in the header (Step E3a) is the count of *actionable* findings only, so getting this exclusion right is what makes the header honest.

**Track, per matched comment:**
- Its `comment_id` and source endpoint (inline `/pulls/comments`, issue `/issues/comments`, or review-summary `/pulls/{pr_number}/reviews`)
- The **ordered list of actionable findings**, each with a stable handle taken from the body itself (`S1`, `(b)`, or a short quoted phrase from its first line) so the marker can be anchored to the right line in Step E3a

**Track, per finding:**
- **Outcome**: `applied` (a fix was committed) or `deferred` (skipped, discussion-only, or otherwise not applied)
- If **applied**: the commit SHA(s), and — critically — whether the fix covers the *whole* finding or only part of it (see the overclaim rule in Step E3a)
- If **deferred**: the specific reason, in the same terms the accompanying reply uses

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
- "Matt Pocock" format comments detected — for each, the per-finding tally (`{X} of {N} applied`) and which findings were deferred, with reasons

---

## Part E: Reply to Comments After Pushing

**This step is mandatory.** After all fixes have been committed for Parts A–D, push everything and post **one reply per comment thread** Hunter touched — covering the findings that were addressed, the ones that were skipped because they don't make sense to apply, and discussion-only reviewer comments that warrant an answer.

> Replies are posted **per thread**, not per comment (**Step T2**). A thread that produced both an applied fix and a skipped finding gets a single reply describing both — not one E2 reply plus one E3 reply.

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

### Step E1a: Collapse the Comment → Commit Map onto Threads

Before posting anything, rewrite the comment-id → commit-sha mapping into a **thread-id → outcomes** mapping:

1. Replace each comment id with its `thread_root_id` (**Step T1**).
2. Merge entries that collapse onto the same `thread_root_id` — a CodeRabbit root and a `github-actions[bot]` reply inside it become **one** entry with a combined outcome list.
3. For each remaining thread, check whether Hunter has already replied in it (**Step T2**, rule 4). If so, PATCH that existing reply rather than posting a new one.

Post exactly one reply per entry in this collapsed map. If the map has fewer entries than the number of comments Hunter touched, that is expected and correct.

### Step E2: Reply to Addressed Threads

For each thread in the collapsed map (**Step E1a**) that Hunter addressed with a commit, post a reply naming the commit, with the hash linked to its commit URL — a later rebase can rewrite the SHA into a dangling reference, so the commit name keeps the reply meaningful even if the linked hash no longer resolves:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{thread_root_id}/replies \
  --method POST \
  --field body="Change applied on commit {commit_name}([{commit_sha}](https://github.com/{owner}/{repo}/commit/{commit_sha}))"
```

Use the thread's `thread_root_id` (the numeric inline-comment id returned by `gh api`) in the path. Note the path shape: the `/replies` sub-resource **requires the PR number** — `pulls/comments/{id}/replies` without it returns `404 Not Found`.

One reply per **thread**. Multiple addressed threads that map to the same commit each get their own reply; multiple comments inside one thread share a single reply.

### Step E3: Reply to Skipped Threads

For each thread Hunter chose **not** to apply (false positive, out of scope, not applicable, already addressed elsewhere, informational-only that still warrants a response, etc.), post a reply with the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{thread_root_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {explanation}"
```

The explanation should be specific — say *why* the change wasn't applied, not just "skipped". Examples:
- `Hunter (Rui's skill) feedback: false positive — this code path is only reached when {condition}, so the suggested guard is unnecessary.`
- `Hunter (Rui's skill) feedback: out of scope for this PR — the refactor would touch {N} unrelated callers; tracked separately.`
- `Hunter (Rui's skill) feedback: already addressed in commit {commit_name}([{sha}](https://github.com/{owner}/{repo}/commit/{sha})) via a different approach.`

### Step E3a: Update "Matt Pocock" Format Comments

For every comment tagged in **Step D3a**, do this **in addition to** the normal reply (Step E2 if applied, Step E3/E4 if deferred/discussion-only) — never instead of it.

The goal is that someone re-reading the review months later sees each finding's outcome **next to that finding**, not aggregated at the top. A single header verdict cannot describe a seven-finding review, and forcing one produces a marker that is either vague or wrong.

1. **Fetch the current comment body** (e.g. via `gh api repos/{owner}/{repo}/pulls/comments/{comment_id}`, or the issue/review equivalent) so the edit preserves every word except the lines you are marking. Write it to a file and edit that file — never retype the body.

2. **Mark each actionable finding** enumerated in Step D3a, in place:

   a. **Prefix the finding's own line** with its marker, immediately after any list bullet:
   ```
   - ✅ Judgement call — *Data Clumps*: `policy_requires_sick_note` and `timezone` travel …
   - ❌ Judgement call — *Duplicated Code*: `local_date/2` and `local_end_date/2` are …
   ```
   For a bold-headed paragraph finding rather than a bullet, prefix the heading:
   ```
   ✅ **(b) Scope creep — reverses a documented design decision:** design.md states …
   ```

   b. **Add an outcome note directly beneath it** — a nested bullet under a bullet finding, a blockquote under a paragraph finding — carrying the evidence:
   ```
     - ✅ **Applied** in `{commit_name}`([{sha}](https://github.com/{owner}/{repo}/commit/{sha})). {What was done, in one or two sentences.}
     - ❌ **Deferred (not applied).** {Why — specific and technical, not "out of scope".}
   ```

   c. **Leave every non-finding line untouched** — the exclusions listed in Step D3a. No marker on "None", "No hard violations found", Strengths, or summary paragraphs.

3. **Do not let a ✅ overclaim.** A ✅ means *this finding was addressed*, not *the underlying problem is gone*. When the fix closes only part of what the finding raised, the ✅ stays but the note must state the limit plainly in the same breath:
   ```
     - ✅ **Applied** in `{commit}`([{sha}](…)) — but read precisely: **the coverage gap is closed, the regression is not fixed.** {What remains and why it was accepted.}
   ```
   A bare ✅ that reads as "fixed" when the defect was merely *pinned by a test* or *documented as accepted* is a false report. Prefer a longer, honest note over a clean but misleading mark.

4. **Append a roll-up marker to the `## Matt Pocock` header line**, pointing at the inline markers rather than trying to replace them:
   - All applied: `## Matt Pocock … ✅ (all {N} findings applied)`
   - All deferred: `## Matt Pocock … ❌ (all {N} findings deferred — see inline notes)`
   - **Mixed** (the common case): `## Matt Pocock … ✅ ({X} of {N} findings applied — {handles} deferred; per-finding markers inline below)`

   `{N}` is the count of **actionable** findings from Step D3a — never the review's own summary count, which often includes no-op lines. Recount from your own enumeration and, if it disagrees with the review's stated total, trust yours and say so in the reply.

5. **Verify every SHA before it goes into a marker** — with `git cat-file -e`, not `git rev-parse --verify`:
   ```bash
   git cat-file -e {full_sha} 2>/dev/null && echo "EXISTS" || echo "MISSING"
   ```
   `git rev-parse --verify` returns success for **any** well-formed 40-hex string, so it silently passes fabricated hashes. Never reconstruct a full SHA from a short one by hand — read it from `git log --format=%H`.

6. **PATCH the comment** using the endpoint matching its source:

```bash
# Inline PR review comment
gh api repos/{owner}/{repo}/pulls/comments/{comment_id} \
  --method PATCH \
  --field body="$(cat {marked_body_file})"

# Issue-level (PR thread) comment
gh api repos/{owner}/{repo}/issues/comments/{comment_id} \
  --method PATCH \
  --field body="$(cat {marked_body_file})"

# PR review summary body
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews/{review_id} \
  --method PUT \
  --field body="$(cat {marked_body_file})"
```

Pass the edited body from a file (`--field body="$(cat {file})"`), not an inline string — command-substitution output is not re-parsed, so backticks and quotes in the review survive intact.

Each deferred finding's note must match the reason given in the accompanying reply (Step E3's explanation or Step E4's answer) — keep them consistent. After PATCHing, re-read the comment and confirm every enumerated finding carries exactly one marker and no non-finding line acquired one.

### Step E4: Reply to Discussion-Only Reviewer Comments

For each human reviewer comment classified as discussion-only in Step D3 (a question or clarification with no code change), post a direct answer on its **thread root** using the Hunter feedback prefix:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{thread_root_id}/replies \
  --method POST \
  --field body="Hunter (Rui's skill) feedback: {answer}"
```

If answering would require a decision Hunter shouldn't make on its own, surface it to the user instead of replying automatically.

### Step E5: Notes

- **Review-summary findings** (from `/pulls/{pr_number}/reviews`) have no per-finding comment ID — note them in the final summary instead of replying. Exception: a **"Matt Pocock" format** review-summary body (Step D3a) is addressable as a whole via its `review_id`, so it still gets the Step E3a edit even though it has no reply thread.
- **One reply per thread, always.** Two Hunter replies on one thread is a defect, not a thoroughness signal. If it happens, delete the duplicate (`gh api repos/{owner}/{repo}/pulls/comments/{id} --method DELETE`) and consolidate into the surviving reply.
- **`/replies` needs the PR number.** `repos/{owner}/{repo}/pulls/comments/{id}/replies` 404s. The correct path is `repos/{owner}/{repo}/pulls/{pr_number}/comments/{id}/replies`. The GET/PATCH/DELETE endpoints for a single review comment are the opposite — they take **no** PR number.
- **Resolved threads** are skipped silently — no reply needed.
- **Already-addressed comments** (where someone else's earlier reply or commit already mentions the fix) are skipped silently — no reply needed.
- Always use the format `commit name([{sha}](https://github.com/{owner}/{repo}/commit/{sha}))` — the full SHA link resolves regardless of future force-pushes or rebases, and the commit name keeps the reply readable even when the PR UI shows a different (rebased) short hash.
- **"Matt Pocock" format comments** (Step D3a) always get both the normal reply/answer *and* the Step E3a marker edit — the edit never replaces the reply. Note the division of labour: the **edit** records each finding's outcome inline, where the finding is; the **reply** carries the narrative and the commit list. Once the inline markers are in place the reply can be short — a pointer plus the commits — rather than restating every finding.

---

## Edge Cases

### CodeRabbit Comments
- **PR from fork**: May need different auth - warn user if access denied
- **Outdated comments**: If line numbers don't match current code, use the context to locate the right section
- **Resolved comments**: Skip comments that are already marked as resolved
- **gh alias conflicts**: Use full path to gh binary or `command gh` to bypass aliases
- **gh not installed**: Inform user and provide installation instructions

### Comment Threads
- **A `/replies` POST returns 404**: The PR number is missing from the path. Use `repos/{owner}/{repo}/pulls/{pr_number}/comments/{id}/replies` — the flat `pulls/comments/{id}/replies` form does not exist for replies, even though it is valid for GET/PATCH/DELETE of a single comment
- **The same thread shows up in two Parts**: Normal. Bot and reviewer comments coexist in one thread. Resolve `in_reply_to_id` → `thread_root_id`, handle the thread once in whichever Part reaches it first, and skip it in the others
- **Two Hunter replies landed on one thread**: Delete the later one (`gh api repos/{owner}/{repo}/pulls/comments/{id} --method DELETE`) and consolidate its content into the first. Prevent it by collapsing the comment map onto threads before posting (Step E1a)
- **A reply's `path`/`line` looks wrong or missing**: Replies inherit their location from the thread root — read `path`/`line` from the root, not the reply

### github-actions Bot Comments
- **No comments found**: Skip Part C and note it in the summary
- **Wrong login filter**: The API returns `github-actions[bot]` and `coderabbitai[bot]` — filtering for `"github-actions"` or `"coderabbitai"` (without `[bot]`) returns zero results. Always use the full login with the `[bot]` suffix.
- **Missing the review endpoint**: Bot review summaries appear in `/pulls/{pr_number}/reviews`, NOT in `/pulls/{pr_number}/comments` or `/issues/{pr_number}/comments`. Always query all three endpoints.
- **Purely informational comments** (e.g. coverage summaries, deployment links): Skip — no actionable fix needed
- **Outdated inline comments** (`position: null`): Use `diff_hunk` to locate the equivalent line in the current file state
- **Duplicate suggestions**: If `github-actions[bot]` and CodeRabbit flag the same issue, the Part B fix counts — skip the duplicate in Part C, and if they share a thread, skip the reply too (the Part B reply already covers it)
- **Replies inside CodeRabbit threads**: `github-actions[bot]` comments with a non-null `in_reply_to_id` are part of an existing thread. They are not a separate comment population and must not receive their own reply

### Human Reviewer Comments
- **No `[bot]` suffix**: Match the human login exactly (e.g. `ruimfernandes`) — the `[bot]` filtering rule from Parts B/C does not apply here
- **Different reviewer**: If the user names another reviewer in the prompt, filter for that login instead of the `ruimfernandes` default
- **Not all comments are fixes**: Treat questions/clarifications as discussion-only — answer them (Step E4) rather than guessing at a code change
- **Ambiguous requests**: If the right fix isn't clear, ask the user before applying anything (per "Ask if unclear")
- **Duplicate of a bot comment**: If the reviewer echoes something a bot already flagged, the earlier Part B/C fix counts — skip the duplicate and reply noting it. If the echo is a *reply inside* the bot's thread, add the note to that thread's single reply instead of posting a new one
- **"Matt Pocock" format comments**: A comment from `ruimfernandes` (or the specified reviewer) whose body begins with the literal header `## Matt Pocock` gets the extra Step D3a/E3a treatment — a ✅/❌ marker and outcome note on **each actionable finding**, plus a roll-up marker on the header line — on top of the normal reply, whatever the outcomes were
- **Multiple findings in one "Matt Pocock" comment**: This is the normal case, not an edge case — one review body routinely carries several findings with different outcomes. Mark each finding individually per Step E3a; never collapse them into a single verdict. If the body also contains several repeated `## Matt Pocock` section headers (e.g. a checklist), give each section its own roll-up marker covering the findings beneath it
- **A "Matt Pocock" finding whose fix is partial**: Mark it ✅ but state the limit in the outcome note (Step E3a's overclaim rule). Pinning a defect with a characterisation test, or recording it as an accepted trade-off, is *addressing the finding* — it is not *fixing the defect*, and the note must not let the two read the same

### GitHub Actions / CI
- **All checks passing**: Skip Part A and proceed directly to Part B (CodeRabbit comments)
- **Pending checks**: Inform user that checks are still running, offer to wait or proceed with CodeRabbit comments
- **Flaky tests**: If a test passes locally but fails on CI, clearly inform the user this is a flaky test - do NOT create a fix commit
- **Environment-specific failures**: Some failures may be due to CI environment differences (e.g., database, external services) - inform the user
- **Log access issues**: If unable to fetch logs, suggest the user check GitHub Actions UI directly
- **Multiple failing jobs**: Address Code Quality first (usually simpler), then Test failures
