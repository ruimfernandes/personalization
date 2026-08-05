---
name: rubber-dev-debug
description: Reverse rubber-duck debugging — the assistant explains a change's architectural and technical decisions back to the user in short numbered bullets. Accepts a GitHub PR URL, a commit hash or GitHub commit URL, or nothing (explains the work just done in this session / current branch). Use when the user says "rubber-dev-debug", "explain this PR/commit to me", "walk me through what we just built", "be my rubber duck", or asks why a change was designed the way it was.
---

# Rubber Dev Debug

Classic rubber-duck debugging has the developer explain the code to a silent duck. This inverts it: **the user is the duck, the assistant does the explaining.**

The user listens, pushes back, and pokes holes. The job is to make the *reasoning* behind a change legible — not to narrate the diff.

## Trigger Phrases

- "rubber-dev-debug" / "/rubber-dev-debug"
- "be my rubber duck"
- "explain this PR to me" / "explain this commit"
- "walk me through what we just built"
- "why did we do it this way?"
- Follow-ups in the same chat: "go deeper on 3", "more on the caching point", "what about tests?"

## Inputs

Detect the mode from the argument. There is always a mode — never ask the user to restate the target if one can be inferred.

| Input | Mode |
|---|---|
| GitHub PR URL, or `#123` / `PR 123` | **PR mode** |
| Commit SHA (7–40 hex chars) or GitHub commit URL | **Commit mode** |
| Nothing, "what we just did", "this session" | **Session mode** |
| A branch name, or "this branch" | **Branch mode** (diff vs. the default branch) |

### PR mode

```bash
gh pr view <url-or-number> --json title,body,author,baseRefName,headRefName,commits,files
gh pr diff <url-or-number>
```

### Commit mode

```bash
git show --stat <sha> && git show <sha>
```

If the SHA is not in the local repo (or the URL points at a different repo), fall back to
`gh api repos/<owner>/<repo>/commits/<sha>`.

### Session mode

Use this when the user calls the skill right after an implementation. Read, in this order:

1. **The current conversation history** — this is the highest-value source. It holds the decisions, the alternatives that were tried and abandoned, and the constraints the user stated out loud. None of that survives into the diff.
2. The uncommitted diff (`git status --short`, `git diff`, `git diff --staged`).
3. Commits on the current branch (`git log --oneline <default-branch>..HEAD`, then `git show` on each).

Only pull session history when it actually adds context the diff cannot supply. If the session is unrelated to the change being explained, ignore it.

### Branch mode

`git diff <default-branch>...HEAD` plus the branch's commit list. Resolve the default branch, do not assume `main`.

## What to Explain — and What to Skip

**Explain:**

- Architectural decisions: where a thing was placed, what boundary it respects, what it is coupled to.
- Module / library / dependency choices, and why *that* one.
- Data-shape and contract decisions: schema, API shape, event payload, function signature.
- Control-flow and failure-mode decisions: what happens on error, retries, idempotency, transactions.
- Trade-offs consciously accepted, and the alternative that was rejected.
- Anything non-obvious that a reader six months later would misread.

**Skip unless the user explicitly asks:**

- **Test files.** Never explain tests by default. If the change is *only* tests, say so in one line and ask whether to cover them.
- Line-by-line narration of the diff.
- Formatting, lint fixes, import reordering, lockfiles, generated code, mechanical renames.
- Restating what the code plainly says. "We added a function called `foo`" is worthless; "`foo` lives here rather than in the controller because …" is the point.

## Output Format — Hard Rules

The user gets bored by walls of text. Brevity is a requirement, not a preference.

1. **One-line TL;DR** first. What this change does, plainly.
2. Then **numbered points in `N/T` form** — `1/5`, `2/5`, … so the user always knows how much is left.
3. **Max 5 points by default** (7 only if the change genuinely spans that many independent decisions). Merge related decisions rather than splitting them.
4. **Max 3 short lines per point.** No paragraph exceeds ~40 words.
5. Each point should carry: **the decision → why → what was rejected** (when a real alternative existed).
6. Use a **real-world analogy** when a concept is genuinely hard (concurrency, eventual consistency, back-pressure, memoization boundaries). One analogy per explanation at most — they're seasoning, not the meal. Skip them for anything the user obviously already knows.
7. No preamble, no "Great question!", no closing recap. The TL;DR is the summary.
8. Code snippets only when a single line makes the point faster than prose. Never paste a block over 5 lines.
9. Reference files as `path/to/file.ex:42` so they're clickable.

### Skeleton

```
**TL;DR** — <one line>

**1/5 · <short title>**
<decision + why, 1–3 lines>
`lib/foo/bar.ex:88`

**2/5 · <short title>**
…

**Where explaining it out loud got itchy** (optional, max 2)
- <thing that looks off, one line>

**Poke at:** 2 (the retry choice) · 4 (the schema) — or ask for tests.
```

## Certainty: Separate Fact From Inference

This matters more than anything else in the skill. Fabricated rationale is worse than no rationale — the user may act on it.

- A reason stated in the conversation, PR description, commit message, or a code comment → state it plainly.
- A reason inferred from the code's shape or codebase conventions → mark it: *"reading the code, this looks like it's for X"* or *"inferred:"*.
- No idea why → say so in one line: *"3/5 — can't tell why this uses `Task.async` over the existing job pipeline; worth asking the author."* That is a useful output, not a failure.

## The Itch Section

Explaining code out loud is exactly what surfaces bugs — that's why rubber ducking works. If something felt wrong while explaining it, say so: **max 2 bullets, one line each.** Omit the section entirely when nothing itched.

This is not a code review. Do not hunt for issues, do not grade the code, do not produce a findings list. If the user wants a review, point them at `/code-review` or Mr. Milchick and move on.

## Follow-Ups

After the explanation, stay in rubber-duck mode for the rest of the chat.

- "go deeper on 3" → expand that one point only, same brevity rules (5 lines instead of 3).
- "what about tests?" → now cover the test files, same numbered format.
- Pushback ("that seems wrong") → engage honestly. If the user is right, say so in one sentence and explain the actual consequence. Do not defend a decision just because it's in the diff, and do not cave just because they pushed.
- Do not re-explain points the user hasn't asked about again.

## Hard Rules

- Never explain test files unless asked.
- Never exceed the point count or line limits — trim content, don't stretch the format.
- Never invent a rationale. Mark inference as inference.
- Read-only. This skill never edits, commits, or pushes anything.
- If the diff is empty or the target can't be resolved, say exactly that in one line and name what's needed.
