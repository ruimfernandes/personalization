---
name: lisa-simpson
description: Keeps a PR and its Jira ticket in sync with what the branch actually does. Reads the current changes and the decisions made in the PR, refreshes the PR description via Little, then checks the linked Jira ticket. If the ticket description is outdated, archives it verbatim in a "## Old description" comment and rewrites the description. Use when the user runs /lisa-simpson, says "Lisa" or "Lisa Simpson", or asks to sync the PR description and Jira ticket with the branch.
argument-hint: "[PR URL or number] [JIRA URL or key]"
---

# Lisa Simpson

Lisa makes sure the written record matches the code.

The PR description and the Jira description are both specs. Review skills read them. If they are stale, reviews check the wrong thing.

The usual call is `/lisa-simpson`. It works on the current branch. The user may pass a PR URL/number or a Jira URL/key to override what Lisa detects.

## Standing approval

Calling `/lisa-simpson` is the user's approval to:

- update the PR description with `gh pr edit`;
- post the archive comment on the Jira ticket;
- rewrite the Jira ticket description.

Lisa does not commit, push, or change code.

If the description is already up to date, Lisa changes nothing. It says so and stops.

## Step 1: Gather the changes and the decisions

1. Find the PR for the current branch: `gh pr view --json number,url,title,body,baseRefName,headRefName`.
   - If there is no PR, stop. Tell the user. Suggest `Little create PR`.
2. Read the full branch delta against the PR base:
   - `git fetch origin <base>`
   - `git log origin/<base>..HEAD --oneline`
   - `git diff origin/<base>...HEAD --stat`, then the diff of the files that matter.
3. Collect the decisions made in the PR. Look in:
   - `claude-decisions.md` at the repo root, if it exists (Dwight writes it);
   - PR conversation comments: `gh pr view <n> --comments`;
   - review threads and replies: `gh api repos/{owner}/{repo}/pulls/<n>/comments`;
   - commit messages and bodies on the branch (`fix: address ... review` commits often record a decision).
4. Write a short internal summary for yourself:
   - what the branch does now, in behaviour terms;
   - each decision, with the function or file it lives in;
   - what is out of scope.

This summary is the source of truth for steps 2 and 3.

## Step 2: Make sure the PR description is up to date

1. Compare the current PR body with the summary from step 1.
   - It is outdated if it misses a behaviour change, misses a decision, describes something the branch no longer does, or has an empty template section that the code now answers.
2. If it is up to date, say so and go to step 3.
3. If it is outdated, run the `little` skill in **PR description** mode (Skill tool, `skill: "little"`, `args: "PR description"`). Pass Little the repo path, branch, base branch, and the decision summary from step 1, so the draft covers the decisions and not only the diff.
4. Keep anything in the current body that Little must not lose:
   - a Loom or screenshot URL;
   - manual QA notes the user wrote by hand.
5. Apply the result: write the body to a file in the scratchpad, then `gh pr edit <n> --body-file <file>`.
6. Re-read the body with `gh pr view <n> --json body` to confirm it saved.

## Step 3: Check the Jira ticket description

1. Find the ticket key, in this order:
   - the argument the user passed;
   - the PR title prefix (for example `CORE-5591: ...`);
   - the ticket link in the PR body;
   - the branch name (`rf/core-5591-...` → `CORE-5591`).
   If none is found, stop and report. Do not guess a key.
2. Load the Atlassian tools with ToolSearch: `select:mcp__atlassian__getJiraIssue,mcp__atlassian__addCommentToJiraIssue,mcp__atlassian__editJiraIssue,mcp__atlassian__getAccessibleAtlassianResources`.
3. Get the `cloudId` with `getAccessibleAtlassianResources`. The Sona site is `get-sona.atlassian.net`.
4. Fetch the ticket twice:
   - `responseContentFormat: "markdown"` — to read and compare;
   - `responseContentFormat: "adf"` — the exact original, kept for the archive in step 4.
5. Compare the Jira description with the summary from step 1.
   - It is outdated if a locked decision is missing or contradicted, if it asks for behaviour the branch does differently, or if the acceptance criteria, out-of-scope list, or required tests no longer match.
   - Wording or formatting differences alone do not make it outdated.
6. If it is up to date, say so and stop.

## Step 4: Archive the old description, then rewrite it

Do these in order. Never rewrite the description before the archive comment has posted.

1. **Archive.** Post a new comment with `addCommentToJiraIssue`, `contentFormat: "adf"`.
   - The comment is an ADF doc. Its first node is a level-2 heading with the text `Old description`.
   - After the heading, append the original description's ADF `content` nodes, unchanged.
   - Do not summarise, reformat, or convert the old description. Copy it verbatim.
   - If the original description is empty, skip the archive and say so.
2. **Confirm.** Check the comment call succeeded and note its ID. If it failed, stop. Do not touch the description.
3. **Rewrite.** Update the description with `editJiraIssue`, `fields: { "description": ... }`, `contentFormat: "markdown"`.
   - First line: `_Description updated on <YYYY-MM-DD> to match the PR. The previous version is in the "Old description" comment._`
   - Then write it as a reviewable spec:
     - **Summary** — the problem and the fix, in a few short sentences.
     - **Impact** — who sees what change.
     - **Acceptance criteria** — one item per decision, naming the real function or module.
     - **Out of scope**
     - **Required tests**
     - **References** — the PR link, and links already in the old description.
   - Keep anything from the old description that is still true: links, customer context, screenshots.
   - Use plain language. Short sentences. One idea per sentence.
4. Re-fetch the ticket (markdown) to confirm the new description saved.

## Output

End with a short report:

- **PR description:** updated / already up to date — with the PR URL.
- **Jira description:** updated / already up to date — with the ticket URL.
- **Archive comment:** posted (comment ID) / not needed.
- **What changed:** a few bullets, in plain words, listing what the descriptions now say that they did not before.
