---
name: kroos
description: Ticket-to-PR flow on tiered models. Opus plans and reviews, Haiku scouts, Sonnet builds. Grills the ticket, writes a spec, implements, opens a PR, and hands it to Janitor.
argument-hint: "[(model)] <JIRA_URL or ticket key>"
disable-model-invocation: true
---

# Kroos

Kroos takes a Jira ticket to a reviewed PR. You are the expensive model. You read the game and pass the ball. Cheaper sub-agents do the running.

The call is `/kroos <JIRA_URL>`, or `/kroos (<model>) <JIRA_URL>` to pick the main model, for example `/kroos (fable) <JIRA_URL>`.

## Main model

The main model is the model this session runs on. A skill cannot switch it, so the user picks it with `/model` before calling Kroos.

- With no `(model)` argument, use the session's model. The default is Opus.
- With a `(model)` argument, check it against the model you are running on. Match on the family name (`opus`, `fable`, `sonnet`). If it names a version, the version must match too.
  - If it matches, go on.
  - If it does not match, or names a model that does not exist, stop before Stage 1. Say which model you are on, and tell the user to run `/model <model>` and then `/kroos` again.

The main model's family name (`opus`, `fable`, ...) is `<main>` below.

## Cost routing

Two cheaper sub-agents exist. Use them by default. Keep for yourself only the work that needs your judgement.

- `scout` (Haiku, low effort): searching, reading code, answering "where is X" or "how does Y work", running tests or commands and summarising the output. Ask for conclusions with file:line references.
- `worker` (Sonnet, medium effort): implementing a change once you have decided what it should be. It sees none of this conversation, so give it a complete brief (Stage 5).

Two other tiers are already set:

- Little runs its own sub-agent on Haiku. Leave it on Haiku.
- Janitor and Hunter always run on Opus 5.5 at medium effort, whatever the main model is (Stage 8).

You keep: reading the ticket, the grill, the spec, the build plan, every diff review, debugging that a cheaper tier already failed at, and the final report.

Do a small job yourself when handing it off costs more than doing it. Examples: a few lines in a file you have already read, a handful of git commands, one MCP call.

A scout summary is a lead, not proof. Before you decide anything that rests on a file, read the key lines yourself.

Run anything that calls `mix` one at a time. Workers and test-running scouts share this worktree's `_build` and test database. Scouts that only read can run in parallel.

## Hard rules

**Autonomy.** Kroos never asks for permission, feedback, or confirmation. The one exception is the grill checkpoint in Stage 3.1.

- Never use `AskUserQuestion`. Outside Stage 3.1, never end a turn with a question.
- When a sub-skill says "ask the user", decide yourself. Pick the best option and write down why.
- Committing, pushing, opening the PR, commenting on it, and replying to review threads are approved.

**Blockers.** If you hit a real blocker you cannot resolve, stop. Report the stage and the blocker. Examples: tracked uncommitted changes in the way, a rebase conflict you cannot resolve safely, missing credentials. Do not guess around it.

**Milestone commits.** Commit at each milestone: the grill session, the spec, each build step, each fix. Stage exact paths with `git add <paths>`. Follow the repo's commit style (`git log --oneline -20`). Never use `--no-verify`. Never amend. If a commit fails, fix the cause and make a new commit.

**Host mix.** Run `mix` on the host, from this worktree's `backend/` directory. Never through Docker.

**Chat scope.** Once Kroos is invoked, the rest of the chat is a Kroos flow. Treat follow-ups as Kroos input, for example answers to the grill. Keep this state: ticket key and URL, branch, docs folder, build plan path, current stage, PR number and URL, Hunter run count.

## Stage 1: Read the ticket

1. Get the ticket key from the URL (for example `CORE-1234`).
2. Fetch the ticket yourself with `mcp__atlassian__getJiraIssue` (load it with ToolSearch first). You need the full text to grill, and a sub-agent would hand you the same text plus its own overhead. Read the description, the acceptance criteria, the comments, and any linked issues that change the scope.
3. Read the project guidance: root `AGENTS.md` / `CLAUDE.md`, `backend/AGENTS.md`, `backend/CONTEXT-MAP.md` and each relevant `CONTEXT.md`, and the relevant ADRs.
4. Send code questions to scouts.
5. Query production data yourself if the ticket needs it (postgres MCP or `mb-query`). Scouts have no MCP tools. Data shapes the work. It does not block it.

## Stage 2: Set up the branch

Do this yourself. It is a few git commands.

1. If the current branch name contains the lowercased ticket key, reuse it.
2. Otherwise:
   - `git fetch origin master`
   - If there are tracked uncommitted changes, stop and report. Do not stash or discard them.
   - `git checkout -b rf/<ticket-key-lowercase>-<brief-description> origin/master`. The description is kebab-case, at most 6 words.

The docs folder for this ticket is `docs/kroos/<TICKET-KEY>/`.

## Stage 3: Grill

Invoke `mattpocock-skills:grilling`, then `mattpocock-skills:domain-modeling`. Together they are `grill-with-docs`, which cannot be invoked from another skill.

Apply these changes to them:

- **Domain docs.** This repo is multi-context (`backend/docs/agents/domain.md`). Where domain-modeling says `GLOSSARY.md`, use the matching `CONTEXT.md` from `backend/CONTEXT-MAP.md`. ADRs go where that doc says.
- **Facts.** Send fact-finding to scouts.
- **Answer first.** Build the whole design tree. For each question, check whether the ticket, the code, the docs, or the data settle it. Mark each question **obvious** (settled, name the source) or **open**.

### 3.1 Checkpoint

If every question is obvious, skip the checkpoint. Say so in one line, with the reason, and go to 3.2.

Otherwise, show every question in one message, then end the turn and wait.

- List the obvious ones briefly: question, answer, source. The user can overrule them.
- Show each open one in full:

```
❓ **Q1 - <title>**

**The problem today:** <a concrete example: real code, real data, or a real scenario>

**Option A: <name>.** <what it means>. After: <the same example with A applied>.

**Option B: <name>.** <what it means>. After: <the same example with B applied>.

**Data or schema change:** <yes/no, and what>

➡️ **Recommended:** <A or B>, because <reason>.
```

Word each question so that "yes" accepts your recommendation. Use short sentences and everyday words.

When the user answers, check whether the answers open new questions. If they do, ask one more round in the same format. When no open questions are left, go on to 3.2 without waiting for a go signal.

### 3.2 Record the grill session

Write `docs/kroos/<TICKET-KEY>/grill-session.md`. It contains:

- the ticket link
- each question, with its options and the recommended answer
- the final answer
- who decided: `Kroos (obvious from <source>)` or `Rui`

Commit it, together with any `CONTEXT.md` or ADR changes from domain-modeling. Use a message like `docs: record grill session for <TICKET-KEY>`.

## Stage 4: Spec

`to-spec` cannot be invoked from another skill. Read its file instead: Glob `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/engineering/to-spec/SKILL.md`. Follow its process and template, with these changes:

- The grill session is the conversation it synthesises.
- Write the spec to `docs/kroos/<TICKET-KEY>/spec.md`. Do not publish it to the issue tracker. Do not apply a triage label.
- Pick the test seams yourself. Record them under Testing Decisions. Do not check them with the user.

Commit it with a message like `docs: add spec for <TICKET-KEY>`. Then run `git push -u origin HEAD`.

## Stage 5: Build plan

By design, the spec has no file paths. Write a build plan to `<scratchpad>/kroos-<TICKET-KEY>-build.md`. Use the session scratchpad directory when one is listed; otherwise use `/tmp`. The build plan is not committed.

Use scouts to find the real files. Then write ordered steps. Each step is one worker brief and ends in one commit. Each brief has:

- **Goal:** what this step achieves, in one or two sentences.
- **Spec:** the path to `spec.md`, and the user stories and decisions this step covers.
- **Files:** the files to change, and one or two files to copy the style from.
- **Constraints:** the fixed list below, plus anything specific to this step.
- **Verify:** the exact commands to run, for example `cd backend && mix test test/backend/ssp/piw_test.exs`.
- **Commit:** the exact paths to stage and the commit message.

Every brief includes these fixed constraints, word for word. The worker sees none of this chat and may not see your memory.

```
- Run mix on the host, from this worktree's backend/ directory. Never through Docker. Do not unset or override DATABASE_TEST_NAME or TEST_HTTP_PORT.
- Make the commit this brief names once verification passes. Stage the exact paths with `git add <paths>`. Never `git add -A` or `git add .`. Never `--no-verify`. Never amend. If a commit fails, fix the cause and make a new commit.
- Do not push.
- Do not expand scope. If the brief is wrong or unclear, do the part you are sure of and report the rest.
```

Then copy in every rule from your memory and the CLAUDE.md files that applies to the files this step touches. Examples: explicit test fixtures with no factory magic, no custom macros, no new column without an anonymiser strategy, the SSP terminology.

## Stage 6: Build

For each step, in order:

1. Spawn one `worker` with the step's brief. Never run two at once.
2. Read its report. Then read its commit yourself: `git show --stat HEAD`, then `git show HEAD`. Check it against the brief and the spec.
3. If it is right, move to the next step.
4. If it is wrong, or there is no commit, spawn a new worker with a fix brief. The fix brief says what was wrong and quotes the relevant lines. If the second attempt is still wrong, fix it yourself and commit.
5. If the worker says the brief was wrong, fix the build plan. If that changes a spec decision, update `spec.md` and commit it.

After the last step, have one scout run the full checks for what changed:

- `mix format --check-formatted`
- `mix credo --strict`
- the tests for every touched area
- the frontend lint, typecheck, and tests, if frontend code changed

Send each failure to a worker as a fix brief, and review its commit as in step 2. When everything passes, run `git push`.

## Stage 7: Open the PR

Invoke the `little` skill with args like:

```
create PR — base master, ticket <JIRA_URL>. Create it as a NON-draft PR (run `gh pr create` without `--draft`). Pushing and creating the PR is approved. Link docs/kroos/<TICKET-KEY>/spec.md and grill-session.md in the description.
```

Then check it: `gh pr view --json number,url,isDraft`. If `isDraft` is true, run `gh pr ready <number>`. Save the number and the URL.

## Stage 8: Review with Janitor

Janitor and Hunter always run on Opus 5.5 at medium effort. A skill invoked here would run on the main model, so never invoke `janitor` or `hunter` in this session. Run each one inside a `general-purpose` sub-agent started with `model: "opus"` and `effort: "medium"`. Run these sub-agents in the foreground, one at a time.

Every one of these sub-agents gets these rules:

```
Run unattended. Never ask anyone anything; decide yourself and write down why. Pushing, committing, commenting, and replying on the PR is approved. Pass model "opus" and effort "medium" to every sub-agent you start, and tell each one to do the same. Return a short report: what you did, links to any comments you posted, the commits you made, and the CI status at the end.
```

### 8.1 Janitor with the first Hunter run

Start one sub-agent. Tell it to invoke the `janitor` skill with these args:

```
<PR_URL> --hunter-runs=1 --model=opus --effort=medium
Spec context: ticket <JIRA_URL>. Full ticket text: <the ticket text from Stage 1>. Spec: docs/kroos/<TICKET-KEY>/spec.md. Grill session: docs/kroos/<TICKET-KEY>/grill-session.md. The grill session records choices made on purpose.
```

This does the Sona code reviewer request, the Matt Pocock review, and Hunter run 1. Check that its report has a link to the `## Matt Pocock review` comment. If it does not, stop and report.

### 8.2 Hunter runs 2 to 4

Repeat until Hunter has run 4 times in total:

1. Wait 10 minutes. Run `sleep 600` with Bash `run_in_background: true` (timeout 700000). End the turn with a one-line status. When the sleep finishes you are re-invoked. If background sleep is not available, use the `Monitor` tool with a 600-second wait.
2. Start one sub-agent. Tell it to invoke the `hunter` skill with the PR URL as the args.

Keep each sub-agent's report for Stage 9.

## Stage 9: Final report

Write it yourself. You already hold everything. A sub-agent would need all of it pasted in. Keep it short:

- The PR URL.
- Decisions: how many, how many Kroos settled as obvious, how many Rui decided, and a link to `grill-session.md` on the branch.
- The commits: `git log --oneline origin/master..HEAD`.
- Each Hunter run: what it fixed, what it skipped, and the CI status at the end.
- Tiering: which build steps needed a fix brief, and which you took over yourself.
- Anything left open that a human should look at.

## Failure rules

- If a stage fails and cannot be fixed, stop. Report the stage, the error, and the next action.
- Never skip a stage silently.
- Never say a stage ran when it did not.

## Status updates

Between stages, give one short line: the stage just finished and the stage starting.
