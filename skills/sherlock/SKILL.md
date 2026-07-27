---
name: sherlock
description: Spec-hardening orchestrator that drafts planning artifacts (proposal, design, tasks), commits them as a baseline, grills the user on those artifacts via grill-me, folds the resolved decisions back into the artifacts with surgical edits, and commits again so the interview's impact shows as a clean diff. Use when the user invokes Sherlock, asks to harden/grill a change before implementing, or continues a Sherlock workflow in the same chat with stage-advancing follow-ups.
---

# Sherlock

Synchronous **spec-hardening** orchestrator. It turns rough intent into a set of planning artifacts, then stress-tests those artifacts through a relentless interview and folds the results back in — producing a **grilled, committed, apply-ready** change.

This skill **plans and hardens only**. It never implements the change. Implementation is a separate, later step run against the hardened artifacts.

## Trigger Phrases

Apply this skill when prompts include phrases like:

- "Sherlock"
- "Harden this spec / change"
- "Draft a plan then grill me on it"
- "Grill the spec before I build it"

Also apply this skill to follow-up turns in the same chat after Sherlock has been invoked, even if the user does not repeat the name.

## Hard Rule: Chat-Scoped Activation

Once the user explicitly invokes Sherlock in a chat, treat the rest of that chat as an active Sherlock workflow until:

- The user explicitly exits or cancels the flow.
- The user clearly switches to a different named workflow or unrelated task.
- The conversation ends.

While active, interpret follow-ups through the current stage. Persist this state across turns:

- Problem statement / change description
- Change name and artifact directory
- Baseline commit hash (Stage 2)
- Interview state (not started / in progress / done)
- Decisions log (Stage 4)
- Final commit hash (Stage 5)
- Current branch and whether a branch was created

## Hard Rule: Strict Sequence

Run this pipeline in order, with no reordering. Do not start a stage until the prior one is explicitly complete.

1. **Plan** — draft apply-ready planning artifacts
2. **Baseline commit** — commit the artifacts (branch-safety rules apply)
3. **Grill** — run `grill-me` on the artifacts (gated on `"Go to step 3"`, ends on `"Interview done"`)
4. **Reconcile** — fold resolved decisions back into the artifacts (Option A: surgical edits)
5. **Final commit** — commit the updated artifacts

The two commits are intentional: the diff between the **baseline commit (2)** and the **final commit (5)** is the visible record of exactly what the interview changed. Keep both.

## Hard Rule: Branch Safety (applies before EVERY commit)

Before any commit in this skill (Stages 2 and 5):

1. Detect the current branch.
2. **If the current branch is `master` or `main`: DO NOT COMMIT.**
   - Ask the user for a branch name and wait.
   - Once provided, create the branch from the current `master`/`main` HEAD, check it out, then commit.
3. **If the current branch is anything else:** commit on the current branch.

After Stage 2 creates/uses a feature branch, Stage 5 will see a feature branch and commit directly.

All commits are built with the **Little** skill (`Little create commit`). Never push or open a PR — this skill stops at local commits.

---

## Stage 1: Plan (draft apply-ready artifacts)

Goal: produce the planning artifacts needed for implementation (`proposal.md`, `design.md`, `tasks.md`, and a `spec.md` when the change warrants formal requirements), but **do not implement**.

1. Derive a change name:
   - If the user gave one, use it; otherwise derive a kebab-case name from their description.
2. Gather context: read the user's request and any referenced files, and explore the codebase to ground the plan in what actually exists rather than assumptions.
3. Choose an artifact directory for the change (e.g. `changes/<change-name>/`, or a location the user prefers) and write each artifact there:
   - `proposal.md` — problem statement, goals, scope (in/out).
   - `design.md` — architecture and design decisions.
   - `tasks.md` — ordered, concrete task breakdown.
   - `spec.md` — requirements, when the change needs a formal spec beyond the proposal.
4. Confirm apply-readiness: every artifact above is written and internally consistent (goals in `proposal.md` are reflected in `tasks.md`, design decisions in `design.md` don't contradict the proposal, etc.).
5. **Stop here.** Do not implement. Report the change name, artifact directory, and the artifacts created.

> If a thinking/exploration pass is wanted before drafting, do that exploration first — but the artifact-producing step is this stage.

## Stage 2: Baseline Commit

1. Apply the **Branch Safety** rule above.
2. Stage the artifact files under the change's artifact directory.
   - Verify the artifacts live inside the git repo. If the artifact directory resolves outside the working tree, the commit cannot capture them — stop and tell the user.
3. Build and execute the commit via `Little create commit`. Use a message that marks this as the pre-grill baseline (e.g. `chore(spec): baseline <change-name> artifacts before hardening`).
4. Record the commit hash as the **baseline**.
5. Announce: baseline committed. Then **wait** — do not start grilling until the user says **`"Go to step 3"`**.

## Stage 3: Grill

Gate: only begin when the user has said **`"Go to step 3"`**.

1. Read the current artifacts (`proposal.md`, `design.md`, `tasks.md`, specs) so the interview attacks the actual written decisions, not abstractions.
2. Run the **grill-me** skill against those artifacts:
   - One question at a time, walking the decision tree, resolving dependencies between decisions in order.
   - For each question, provide a recommended answer.
   - Anything answerable from the codebase: explore the codebase instead of asking.
   - Focus on the assumptions Stage 1 made for momentum — scope, design choices, requirements, and task breakdown that were decided without the user.
3. **Terminate the interview only when the user says `"Interview done"`.** Do not auto-end.

## Stage 4: Reconcile (Option A — surgical edits)

When the user has said `"Interview done"`:

1. **Emit a decisions log.** Produce a numbered list of every decision the interview resolved or changed. For each, classify its type and route it to the correct artifact:

   | Decision type | Target artifact |
   |---|---|
   | Scope changed (more/less than proposed) | `proposal.md` |
   | Design / architecture decision | `design.md` |
   | Requirement added or changed | `spec.md` |
   | New work identified | `tasks.md` |
   | Assumption invalidated | the artifact that relied on it |

2. **Checkpoint.** Show the user the decisions log with its proposed routing **before editing any file**, so a misrouted decision is caught first. Proceed when the user approves.
3. **Make surgical edits.** Edit only the lines each decision touches — do not rewrite whole artifacts (that is what keeps the Stage 2→5 diff clean).
4. Re-read the edited artifacts to confirm the change is still internally consistent and apply-ready after edits.

## Stage 5: Final Commit

1. Apply the **Branch Safety** rule (the feature branch from Stage 2 should already be active, so this commits directly).
2. Stage the edited artifacts.
3. Build and execute the commit via `Little create commit`, with a message describing the hardening (e.g. `refactor(spec): fold grill-me decisions into <change-name>`).
4. Record the final commit hash.
5. Report: baseline hash, final hash, and `git diff <baseline>..<final> -- <artifact directory>` as the clean record of what the interview changed. State that the change is **apply-ready** and that implementation is a separate next step.

## Guardrails

- **Never implement.** No application code. Stop at hardened artifacts.
- **Never push or open a PR.** Local commits only.
- **Respect branch safety** on every commit — never commit on `master`/`main`.
- **Keep both commits** — the diff between them is the deliverable's audit trail.
- **Surgical edits only** in Stage 4 — whole-file rewrites would defeat the clean diff.
- **Honor the gates** — wait for `"Go to step 3"` to grill, and for `"Interview done"` to reconcile.
- **Verify artifact location** is inside the git repo before committing.
