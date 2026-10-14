---
name: janitor
description: PR clean-up orchestrator. Takes a GitHub PR URL, requests the Sona code reviewer, has a sub-agent run Matt Pocock's /code-review against master and post it as a "## Matt Pocock review" PR comment, then runs Hunter 3 times (or as many as the caller asks), 10 minutes apart. Use when the user says "Janitor" or "/janitor" followed by a PR URL, or when another skill (such as Dwight) hands a PR over for review.
argument-hint: "<PR_URL> [--hunter-runs=N] [caller context]"
---

# Janitor

Janitor takes an open PR and gets it reviewed and cleaned up on its own.

The usual call is `/janitor <PR_URL>`.

## Arguments

- `<PR_URL>`: the PR to work on. Required, unless the current branch has a PR.
- `--hunter-runs=N`: how many Hunter runs to do. Optional. The default is 3.
- Caller context: optional free text after the PR URL. Another skill uses it to pass extra spec context (for example a Jira ticket and a decisions file) and extra rules (for example the model every sub-agent must use). Follow these rules, and pass them on to every sub-agent Janitor starts.

## Hard rule: autonomy

Janitor runs unattended. It does not ask the user for permission, feedback, or confirmation.

- Never use `AskUserQuestion`. Never end a turn with a question to the user.
- When a sub-skill (Hunter, code-review, ...) says "ask the user", Janitor decides itself. It picks the option it thinks is best and writes down why in the thread reply.
- Janitor is explicitly allowed to comment on the PR, commit, push, and reply to review threads. Treat that as the user's standing approval.

If Janitor hits a real blocker it cannot resolve (tracked uncommitted changes in the way, missing credentials, a PR that is closed or merged), it stops. It reports the blocker and the step. It does not guess around it.

## Hard rule: chat-scoped activation

Once Janitor is invoked, the rest of the chat is a Janitor flow. Keep this state across turns: PR number and URL, repo, branch, and Hunter run count.

## Step 1: Resolve the PR

1. Get the PR from the args. Accept a full URL (`https://github.com/<owner>/<repo>/pull/<number>`) or a bare number.
   - If no PR is given, use the PR for the current branch: `gh pr view --json number,url`. If there is none, stop and report.
2. Read it: `gh pr view <PR_URL> --json number,url,state,headRefName,baseRefName`.
   - If `state` is not `OPEN`, stop and report.
3. Make sure the local checkout is on the PR's branch. The review and Hunter both work on local files.
   - If `git branch --show-current` already equals `headRefName`, run `git pull --ff-only`.
   - Otherwise, if there are tracked uncommitted changes, stop and report. Do not stash or discard them.
   - Otherwise run `gh pr checkout <number>`.

## Step 2: Request the Sona code reviewer

```bash
gh pr comment <PR_URL> --body "/sona-code-reviewer --model=claude-opus-5-5 --effort=medium"
```

## Step 3: Matt Pocock review

Spawn one `general-purpose` sub-agent. Give it:

- The repo path, the branch, and the PR URL.
- The instruction to invoke the `code-review` skill with the fixed point `master`.
- The spec: the PR title and body (`gh pr view <PR_URL> --json title,body`), plus any linked Jira ticket the body mentions. Tell it to fetch the ticket with the Atlassian MCP if it can. If the caller passed spec context, include all of it too.
- Any rules the caller passed (for example the model to use). The `code-review` skill starts two sub-agents of its own, so tell it to pass those rules on.
- The rules:
  - It must not ask anyone anything.
  - It must not edit code, commit, or push.
  - Once the review is done, it writes the full report to `<scratchpad>/janitor-pr-<number>-matt-pocock.md`. The file's first line is exactly `## Matt Pocock review`, then a blank line, then the report.
  - It posts that file as a PR comment: `gh pr comment <PR_URL> --body-file <scratchpad>/janitor-pr-<number>-matt-pocock.md`.
  - It returns the comment URL that `gh pr comment` prints.

Use the session scratchpad directory when one is listed; otherwise use `/tmp`.

Wait for the sub-agent to finish before Step 4. Hunter must see the `## Matt Pocock review` comment on its first run.

Check the result: the sub-agent returned a comment URL. If it did not, stop and report. Do not start Hunter without the review comment.

## Step 4: Hunter loop

Run Hunter **N times** in total, 10 minutes apart. N is `--hunter-runs`, or 3 when it is not given.

1. Invoke the `hunter` skill with the PR URL as the args. Hunter fixes CI failures, CodeRabbit comments, github-actions comments, and the `## Matt Pocock review` comment, then pushes and replies. Apply the autonomy rule to it.
2. Record the result of the run: threads addressed, commits, CI status.
3. If fewer than N runs are done, wait 10 minutes: run `sleep 600` with Bash `run_in_background: true` (timeout 700000). End the turn with a one-line status. When the sleep finishes you are re-invoked; start the next run. If background sleep is not available, use the `Monitor` tool with a 600-second wait instead.
4. Stop after run N. Do not run one more, even if new comments arrive.

## Step 5: Final report

Keep it short:

- PR URL.
- Link to the `## Matt Pocock review` comment.
- Each Hunter run: what it fixed, what it skipped, and the CI status at the end.
- Anything left open that a human should look at.

## Failure rules

- If a step fails and cannot be fixed, stop. Report the step, the error, and the next action.
- Never skip a step silently.
- Never say a step ran when it did not.

## Status updates

Between steps, give one short line: the step just finished and the step starting.
