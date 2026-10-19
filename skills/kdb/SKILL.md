---
name: kdb
description: Generates step-by-step manual testing instructions for the current branch compared with `master`, focused on reproducing the old behavior on the platform and verifying the new behavior while logged in as a manager. When a Jira ticket is provided, always fetch it via the Atlassian MCP first. Has an `agent` mode (`/kdb agent <PSQL_WEB_URL> <DB_NAME>`) that writes the plan for a video recording, with before/after tests and pgAdmin SQL checks. Use when the user says `KdB`, asks how to test a branch manually, wants manager-facing repro steps, or asks for before/after verification against `master`.
---

# KdB

## Purpose

Use `KdB` to turn branch changes into a human test script for the platform.

The output must help the user manually validate behavior in the app, not by running unit tests or reading code only.

Default assumptions:

- Compare the current branch against `master`.
- The tester is logged in as a manager.
- Prefer platform actions and visible outcomes over implementation details.

## Modes

KdB has two modes. Pick the mode from the first word after `/kdb` (or `KdB`).

- **Default mode.** Anything that is not `agent`. Follow the rest of this file as written.
- **Agent mode.** The first word is `agent`. Read the [Agent Mode](#agent-mode) section first. It adds rules on top of the default mode.

## Hard Rules

- Do not return `run test`, `run unit test`, or similar test-suite instructions as the main result.
- Do not default to generic QA wording like `verify feature works`.
- Always produce concrete platform steps.
- Always explain how to reproduce the old behavior on `master` when that is possible from the diff and available context.
- Always explain how to verify the new behavior on the current branch.
- If the user provides a Jira ticket URL or key, always check it through the `user-Atlassian` MCP before using ticket details.
- If the Atlassian MCP is disabled, unavailable, or misconfigured, stop the flow immediately and tell the user to fix or enable it before continuing.
- Do not fall back to guessing Jira details from the URL, browser, or chat summary when a Jira ticket was provided.
- If required product context is missing, ask targeted follow-up questions before finalizing the steps.

## Inputs To Use

Before writing the testing guide, gather context from these sources in this order:

1. The current user request
2. Current chat history
3. Referenced Jira ticket, fetched through the Atlassian MCP when a ticket URL or key is provided
4. Current branch diff against `master`
5. Any implementation plan, PR notes, or review notes mentioned in the chat

If the user provides a Jira ticket, use the Atlassian MCP to fetch it before continuing.
First call `getAccessibleAtlassianResources` to obtain a `cloudId`, then call `getJiraIssue` with the Jira key or ID.
If no Jira ticket is provided, continue with the remaining context sources.
If the ticket is incomplete, infer the likely user-facing behavior from the branch diff and current conversation.

## Workflow

### 1. Resolve Jira context first when a ticket is provided

If the request includes a Jira URL or issue key:

- Confirm the `user-Atlassian` MCP is available.
- Use the Atlassian MCP, not a browser scrape or URL guess, to fetch the issue.
- Start with `getAccessibleAtlassianResources` to retrieve a `cloudId`.
- Then call `getJiraIssue` with `issueIdOrKey`.
- Use the Jira summary, description, acceptance criteria, and status as input for the manual test plan.

If the Atlassian MCP cannot be used, stop and reply with a short blocking message telling the user to fix or enable the Atlassian MCP before `KdB` can continue.

### 2. Understand the user-facing change

Inspect the current branch against `master` and identify:

- What behavior changed
- Who experiences the change
- Which screens, flows, or actions are involved
- What data/setup is needed
- What a manager must do to trigger the old and new behavior

Focus on user-observable behavior, not internal refactors unless they change visible outcomes.

### 3. Reconstruct the baseline on `master`

When possible, explain how the tester can see the old behavior on `master`.

This section should answer:

- Where should the manager navigate?
- What data or record state is required?
- What exact actions should they take?
- What wrong or buggy behavior should appear?

If the bug cannot be reproduced safely or deterministically on `master`, say that clearly and explain the closest observable baseline instead.

### 4. Verify the fix on the current branch

Translate the change into a clear validation path:

- Start from login as manager
- Navigate to the relevant area
- Perform the same or equivalent actions
- State the expected fixed behavior
- Mention any edge cases worth spot-checking manually

### 5. Include setup only when needed

Add prerequisites only if they materially help the tester:

- Required role or permissions
- Required record state
- Required employee/company/configuration setup
- Feature flags or environment conditions

Keep setup concise and actionable.

### 6. Make the instructions easy to follow

Prefer step-by-step instructions with explicit outcomes after important actions.

Good:

```markdown
1. Check out `master` and log in as a manager.
2. Open the employee profile for an employee with an approved leave request.
3. Navigate to `Time Off > Requests`.
4. Edit the request dates so they overlap with an existing request.
5. Save the form.
Expected on `master`: the platform accepts the change and creates the inconsistent state.
```

Bad:

```markdown
Verify leave request validation.
```

## Output Format

Always use this structure:

```markdown
## Manual Test Plan

### Goal
- Brief statement of what changed in user terms

### Preconditions
- Manager login
- Any specific setup needed

### Reproduce On `master`
1. ...
2. ...
Expected on `master`: ...

### Verify On Current Branch
1. ...
2. ...
Expected on current branch: ...

### Extra Checks
- Optional high-value edge case
- Optional regression check
```

## Agent Mode

Trigger: `/kdb agent <PSQL_WEB_URL> <DB_NAME>`. A Jira URL or key may follow.

In this mode the plan is written for a video recording. Someone, often the Nolan skill, will follow it step by step on camera.

### A1. Check the arguments first

Do this before anything else. Do not fetch Jira, read the diff, or ask questions until it passes.

Read the words after `agent`:

- `PSQL_WEB_URL` is the word that starts with `http://` or `https://`. Example: `http://127.0.0.1:54974/?key=7deb89f9-94c3-4a2f-9f73-5e57f0bbc1cd`.
- `DB_NAME` is the other word that is not a Jira URL or Jira key. Example: `sona_demo_ssp_sandbox`.

If either one is missing, reply with exactly this line and nothing else. Then stop.

```text
Can't move forward, need you to provide PSQL_WEB_URL and DB_NAME in order to write the plan
```

Never guess or invent a missing value. Never use a default.

### A2. Gather context

Same as the default mode: Jira first (when given), then the branch diff against `master`, then the chat.

Use `DB_NAME` as the database for the whole plan. Every SQL query in the plan runs against it.

### A3. Plan for the camera

- **Split setup from recording.** Put everything the viewer does not need to see under "Setup (off camera)". Only the steps that show the behaviour go on camera.
- **Use fixed, real data.** Name the org, site, manager, employees and dates. Give full UUIDs, never shortened ones. A recording can't stop to look for "an employee with an approved leave".
- **Same data for before and after.** The before run and the after run must use the same records. If the before run changes data, say how to reset it before the after run. Or use a separate, identical record for each run, and say which is which.
- **Make results visible.** Each expected result should be something the camera can see: a number, a label, a banner, a row. Say where on screen it appears.
- **Keep each test short.** One behaviour per test. Give it a plain name, like "Story A: went home sick part-way through a shift".

### A4. Tests with before and after

Write one section per test. Each test has:

- **Before, on `master`.** Steps and the expected result on `master`.
- **After, on the current branch.** The same steps and the expected result on the branch.

Skip the before only when it makes no sense. For example, the screen or flow doesn't exist on `master`. When you skip it, write `No before: <one-line reason>` in its place.

End the plan with a summary table. One row per test. Columns: test, expected on `master`, expected on branch.

### A5. SQL checks, only when they help

Add a SQL check when the screen alone can't prove the result. Good reasons:

- A step changes data that the screen doesn't fully show, such as a stored calculation or a status column.
- A later step depends on data being in an exact state.
- The video will quote a number, and the database is the proof.

Skip SQL checks when the screen already shows the result clearly.

Each SQL check must:

- Be a read-only `SELECT`. If the setup needs data changes, describe them in the setup section instead, and flag them clearly.
- Use real table and column names. Check them against the schema or migrations in the repo before writing the query.
- Filter by the full UUIDs or exact values from the "Fixed facts" table.
- Say when to run it, for example "after step 4".
- Say the expected result on `master` and on the branch.

Whenever the plan has at least one SQL check, include the "How to run a SQL check" section from the output format below. Use the user's real `PSQL_WEB_URL` and `DB_NAME`, not placeholders. Each SQL check then points back to it.

**Mark each SQL check On camera or Off camera.** You decide which, one check at a time. The recorder follows the label.

- **On camera** when the viewer needs to see the proof. For example: the fix lives in a stored value the screen doesn't show, or the narration will quote a number that only the database holds.
- **Off camera** when the check only confirms setup, or a state that a later step needs. The viewer doesn't need to see those.
- When in doubt, ask: would the video be less convincing without this result on screen? If yes, it's On camera.

An **On camera** check is filmed in pgAdmin at `PSQL_WEB_URL`, in the same browser that records the app. The viewer sees the query and the result rows. So:

- Write it as a numbered step inside the test, so it runs at the right moment. Don't put it after the steps as a loose note.
- Say what the camera should see in the **Data Output** panel: the number of rows and the exact values to point at.
- Keep the query short enough to read on screen. Select only the columns the check needs, and give them clear names with `AS`.
- Running the query with `psql` or the postgres MCP does not replace an On camera check.

An **Off camera** check can be run any way, including `psql` or the postgres MCP. It is still numbered in the test, so the recorder knows when to run it.

### A6. Agent Mode Output Format

````markdown
## Manual Test Plan (for video recording)

### Goal
- What changed, in user terms

### Fixed facts
| Thing | Value |
|---|---|
| App | http://localhost:4000 |
| Database | `<DB_NAME>` |
| pgAdmin | <PSQL_WEB_URL> |
| Organisation | <name> (`<full UUID>`) |
| Manager login | <who> |
| Employee | <name> (`<full UUID>`) |
| Dates | <exact dates> |

### How to run a SQL check
**On camera** checks are filmed in pgAdmin, in the same browser as the app:
1. Open <PSQL_WEB_URL>.
2. Left click **Servers**.
3. Right click **<DB_NAME>**.
4. Left click **Query Tool**.
5. Paste the query into the editor.
6. Press **F5**, or click the **Execute** (▶) button.
7. The result shows in the **Data Output** panel under the editor. Move the cursor to the values that matter and hold for 2–3 seconds.
8. Go back to the app page you were on.

**Off camera** checks can run any way, including `psql` or the postgres MCP.

### Setup (off camera)
1. ...

### Test 1: <plain name>

#### Before, on `master`
1. ...
2. ...
Expected on screen: ...
3. **On camera, SQL check 1.1.** Open pgAdmin and run:
   ```sql
   SELECT ...
   ```
   Expected in Data Output on `master`: <row count, and the exact values to point at>
4. Go back to the app page.
5. **Off camera, SQL check 1.2.** Run:
   ```sql
   SELECT ...
   ```
   Expected on `master`: ...

#### After, on current branch
1. ...
2. ...
Expected on screen: ...
3. **On camera, SQL check 1.1.** Open pgAdmin and run the same query.
   Expected in Data Output on branch: <row count, and the exact values to point at>
4. Go back to the app page.
5. **Off camera, SQL check 1.2.** Run the same query.
   Expected on branch: ...

### Test 2: <plain name>
#### Before, on `master`
No before: <one-line reason>

#### After, on current branch
...

### Summary
| Test | Expected on `master` | Expected on branch |
|---|---|---|
| 1. ... | ... | ... |

### Extra checks
- Optional edge case worth showing
````

Leave out "How to run a SQL check" and all SQL check blocks when the plan has no SQL checks. Leave out the On camera steps of "How to run a SQL check" when every check is Off camera.

## Writing Guidelines

- Use product language, not code jargon, when possible.
- Mention exact navigation paths when they can be inferred.
- Mention the type of record/data needed when exact identifiers are unknown.
- Prefer `open`, `click`, `select`, `save`, `refresh`, `approve`, `submit`, `edit`, `filter` verbs.
- Keep the goal short and concrete.
- Keep the number of steps tight; include enough detail to reproduce reliably.

## When To Ask Questions

Ask short follow-up questions if any of these are unclear:

- Which manager persona or organization to use
- Which area of the platform is affected
- What setup data is needed to trigger the bug
- Whether the user wants a pure repro flow, a fix-verification flow, or both

Do not ask follow-up questions that the Jira ticket should answer until after you have fetched the ticket through the Atlassian MCP.

If the user already asked for `KdB`, keep the questions minimal and only ask what blocks a useful manual test script.

## Examples

### Example Trigger

`KdB for this ticket: <url>`

### Example Agent Mode Trigger

`/kdb agent http://127.0.0.1:54974/?key=7deb89f9-94c3-4a2f-9f73-5e57f0bbc1cd sona_demo_ssp_sandbox`

### Example Agent Mode Blocking Response

For `/kdb agent` with no arguments, or with only one of the two:

`Can't move forward, need you to provide PSQL_WEB_URL and DB_NAME in order to write the plan`

### Example Blocking Response

`I can't continue the KdB flow yet because the Atlassian MCP is disabled or unavailable. Please fix or enable the \`user-Atlassian\` MCP, then ask me to continue.`

### Example Intent

Return a manual before/after guide such as:

- What to do on `master` to reproduce the bug
- What to do on the current branch to verify the fix
- What outcome the manager should observe in each case
