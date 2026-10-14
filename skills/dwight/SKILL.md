---
name: dwight
description: Autonomous ticket-to-PR orchestrator. Takes a Jira ticket, reads it and the codebase, writes a plan, records doubts in claude-decisions.md (committed and pushed), implements with commits, opens a non-draft PR via Little, then hands the PR to Janitor (Sona code reviewer request, Matt Pocock /code-review comment, and Hunter 4 times, 10 minutes apart). Use when the user says "Dwight" or "/dwight" followed by a Jira URL or ticket id, or continues a Dwight flow in the same chat (for example answering a decision or saying it is ready to implement).
argument-hint: "<JIRA_URL> [present me the doubts]"
model: claude-opus-5-5[1m]
---

# Dwight

Dwight takes a ticket from start to a reviewed PR on its own.

The usual call is `/dwight <JIRA_URL>`. That runs in **autonomous mode**.

## Hard rule: autonomy

Dwight does not ask the user for permission, feedback, or confirmation. This holds for every stage and every sub-skill Dwight calls.

- Never use `AskUserQuestion`. Never end a turn with a question to the user.
- When a sub-skill (Little, Hunter, code-review, ...) says "ask the user", Dwight decides itself. It picks the option it thinks is best and writes down why.
- Dwight is explicitly allowed to commit, push, open the PR, comment on the PR, and reply to review threads. Treat that as the user's standing approval.
- The **only** exception is interactive mode's decision step (see below).

If Dwight hits a real blocker it cannot resolve (tracked uncommitted changes in the way, a rebase conflict it cannot resolve safely, missing credentials), it stops. It reports the blocker and the stage. It does not guess around it.

## Hard rule: Opus 5.5 everywhere

Dwight runs on Opus 5.5. The `model` field in this file's frontmatter sets that for the main session.

Every sub-agent Dwight starts runs on Opus 5.5 too. This covers sub-agents started by the skills Dwight calls.

- Every `Agent` tool call passes `model: "opus"`. That includes `Explore`, `general-purpose`, and any other type.
- When a sub-skill says to use a different model, ignore that and use `opus`. For example, Little says to spawn its sub-agent on `haiku`. Under Dwight it uses `opus`.
- Tell each sub-agent to pass `model: "opus"` to any sub-agent it starts. The `code-review` skill starts two of its own.

## Mode selection

Pick the mode from the user's message:

- **Autonomous mode (default).** Anything that does not ask Dwight to show the doubts. Dwight makes every decision itself.
- **Interactive mode.** The user asks to be part of the decisions. Examples: "present me the doubts", "show me the doubts", "I want to decide", "ask me the decisions". In this mode the decisions belong to the user. Dwight must not pick an option for them.

When unsure, use autonomous mode.

## Hard rule: chat-scoped activation

Once Dwight is invoked, the rest of the chat is a Dwight flow. Follow-ups like an answer to a decision, "go with B", "ready", or "implement" are Dwight inputs. Do not make the user repeat `/dwight`.

Keep this state across turns: ticket key and URL, mode, branch, plan file path, decisions file status, current stage, PR number and URL, Janitor progress (Hunter run count).

## Stage 1: Read the ticket and the codebase

1. Get the ticket key from the URL (for example `CORE-1234`).
2. Fetch the ticket with the Atlassian MCP (`mcp__atlassian__getJiraIssue`; load it with ToolSearch first). Read the description, the acceptance criteria, the comments, and linked issues that change the scope.
3. Read the project guidance: root `AGENTS.md` / `CLAUDE.md`, `backend/AGENTS.md`, any `CONTEXT.md`, and relevant ADRs.
4. Explore the code the ticket touches. Use `Explore` sub-agents (with `model: "opus"`) for broad searches. Find the real files, functions, tests, and data shapes involved.
5. If the ticket needs production data to understand, query it (postgres MCP or `mb-query`). Data shapes the work. It does not block it.

## Stage 2: Set up the branch

1. If the current branch name already contains the lowercased ticket key, reuse it.
2. Otherwise:
   - `git fetch origin master`
   - If there are tracked uncommitted changes, stop and report. Do not stash or discard them.
   - `git checkout -b rf/<ticket-key-lowercase>-<brief-description> origin/master`. The description is kebab-case, at most 6 words.

## Stage 3: Write the plan

Write the plan to `<scratchpad>/dwight-<TICKET-KEY>-plan.md`. Use the session scratchpad directory when one is listed; otherwise use `/tmp`. The plan is not committed.

The plan has:

- **Objective**: one or two sentences. Link the ticket.
- **Scope**: what is in and what is out.
- **Current behaviour**: a concrete example of the problem today (real code or real data).
- **Target behaviour**: the same example after the change.
- **Steps**: ordered steps. Each step lists the files it touches, the tests it adds or changes, and the commit it ends with.
- **Validation**: the commands to run (from `backend/AGENTS.md` and the frontend equivalent).
- **Risks**: data, migrations, rollout, feature flags.
- **Decisions**: a pointer to `claude-decisions.md`, if there are any.

## Stage 4: Decisions

A doubt is anything the ticket and the code do not settle, where a reasonable engineer could go either way and the choice changes behaviour, data, the API, the UI, or the scope.

Resolve everything the code, the docs, or the data can answer first. Only real doubts go in the file.

### 4.1 Write `claude-decisions.md`

If there are no doubts, skip the file. Say so in the plan.

Otherwise create `claude-decisions.md` at the repo root. Use plain language: short sentences, everyday words, one idea per sentence.

```markdown
# Decisions: <TICKET-KEY>

Ticket: <JIRA_URL>
Mode: autonomous | interactive

## D1: <short title>

**Status:** Decided by Dwight | Decided by Rui | Open

**The problem today:** <a concrete example: real code, real data, or a real scenario>

**Option A: <name>.** <what it means>. After: <the same example with A applied>.

**Option B: <name>.** <what it means>. After: <the same example with B applied>.

**Data or schema change:** <yes/no, and what>

**Recommendation:** <A or B>, because <reason>.

**Choice:** <A | B | pending>
```

Commit it on its own (`git add claude-decisions.md`, message like `docs: record implementation decisions for <TICKET-KEY>`). Then `git push -u origin HEAD`.

### 4.2 Autonomous mode

Dwight picks the option it thinks is best for every decision. Set the status to `Decided by Dwight` and fill in the choice. Commit and push as above. Then go straight to Stage 5. Do not stop to show the decisions.

### 4.3 Interactive mode

The user decides. Dwight never picks for them.

1. Write the file with every decision set to `Open` and `Choice: pending`. Commit and push.
2. Show a short summary of the plan.
3. Present **one decision at a time**. For each one show:
   - The concrete example of the problem today (real code or data).
   - What that same example looks like after each option.
   - Whether it needs a data or schema change.
   - Dwight's recommendation and why.
4. Wait for the user's answer. It is fine to discuss back and forth. Dwight can push back, explain, or offer a new option.
5. After each answer, update the file: set the status to `Decided by Rui` and fill in the choice. If an answer changes the plan, update the plan too. New doubts that come up go into the file as new decisions.
6. When every decision is answered, say so. Then wait.
7. **Do not implement** until the user clearly says everything is ready (for example "ready to implement", "go", "implement it"). Answering the last decision is not that signal.
8. On the go signal, commit and push the final `claude-decisions.md`. Then start Stage 5. From here on, the autonomy rule applies again.

If there are no doubts in interactive mode, say so, show the plan summary, and still wait for the go signal.

## Stage 5: Implement

Follow the plan step by step.

- Follow the repo's conventions. `backend/AGENTS.md` is authoritative for the backend.
- Run `mix` on the host, from this worktree's own `backend/` directory. Never through Docker.
- Add or update tests with each behaviour change.
- After each step, run the relevant tests. Then commit:
  - Stage the exact files you changed with `git add <paths>`. Never `git add -A` or `git add .` (worktrees often have unrelated untracked files).
  - Follow the repo's recent commit style (`git log --oneline -20`).
  - One cohesive commit per step. Never `--no-verify`. Never amend a failed commit; fix and make a new one.
- If the plan turns out wrong, adapt. Record the change in the plan. If it touches a decision, update `claude-decisions.md` and commit it.

Before the PR, run the full checks for what changed: `mix format`, `mix credo --strict`, and the tests for every touched area (plus the frontend lint, typecheck, and tests if frontend code changed). Fix failures and commit the fixes.

## Stage 6: Open the PR

### 6.1 Create the PR with Little

Invoke the `little` skill with args like:

```
create PR — base master, ticket <JIRA_URL>. Create it as a NON-draft PR (run `gh pr create` without `--draft`). Pushing and creating the PR is approved. Spawn the sub-agent with `model: "opus"`, not `haiku`.
```

Then check it: `gh pr view --json number,url,isDraft`. If `isDraft` is true, run `gh pr ready <number>`. Save the number and URL.

## Stage 7: Review and clean up with Janitor

Invoke the `janitor` skill. Janitor requests the Sona code reviewer, posts the `## Matt Pocock review` comment, and runs Hunter. Pass args like:

```
<PR_URL> --hunter-runs=4
Spec context: ticket <JIRA_URL>. Full ticket text: <the ticket text fetched in Stage 1>. Decisions file: <path to claude-decisions.md, or "none">. The decisions file records choices made on purpose.
Rules: every sub-agent uses `model: "opus"`, including the two that `code-review` starts. Pushing, commenting, and replying on the PR is approved.
```

Janitor runs inside this Dwight flow, so Dwight's autonomy and Opus rules still apply to it.

When Janitor finishes, keep its results: the Matt Pocock review comment link and what each Hunter run did. Stage 8 uses them.

## Stage 8: Final report

Keep it short:

- PR URL.
- Decisions: how many, who decided, and a link to `claude-decisions.md` on the branch (or "no decisions needed").
- Commits made during implementation.
- Each Hunter run: what it fixed, what it skipped, and the CI status at the end.
- Anything left open that a human should look at.

## Failure rules

- If a stage fails and cannot be fixed, stop. Report the stage, the error, and the next action.
- Never skip a stage silently.
- Never say a stage ran when it did not.

## Status updates

Between stages, give one short line: the stage just finished and the stage starting.
