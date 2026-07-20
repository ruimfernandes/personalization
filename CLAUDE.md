Proceed autonomously. Only pause before:
- Irreversible operations (production data deletion, force push to main, live migrations)
- Security-sensitive changes outside the original goal (auth, secrets, cryptography)

Fix root causes of the task at hand. Never work around a problem — resolve it or flag it and stop. If you cannot verify something, say so explicitly before proceeding.

When a task involves meaningful trade-offs or non-obvious decisions, surface them briefly after completing the work.

## Checkpoint early, checkpoint often

The VM running this session can become extremely slow or unresponsive without warning. To keep progress from becoming inaccessible, commit and push at every **significant checkpoint**. A checkpoint is any of:

- A commit that completes a step of an implementation plan (a working, self-contained increment).
- Creating an implementation plan document.
- Creating a debug document.

At each checkpoint, do the following **without waiting to be asked** — reaching a checkpoint is standing authorization to commit, push, and open the draft PR:

1. Run the `little` skill's `Little create commit` to stage the relevant files and commit them.
2. Push the commit to GitHub (`git push`, using `-u origin HEAD` if the branch is not yet on the remote).
3. The **first** time a commit is pushed on this branch, immediately run `Little create PR` to open a **draft** PR (it pushes and creates the PR as a draft). On later checkpoints, a push is enough — do not open a second PR; the existing draft updates automatically.

### Rules and edge cases

- **Never checkpoint onto the default branch (`main`/`master`).** If the current branch is the default branch, create a feature branch first, then commit. A draft PR cannot be opened from the default branch.
- **Draft only.** The PR must be opened as a draft (`Little create PR` already does this). Do not mark it ready for review unless the user explicitly asks.
- Follow all `little` skill rules — no empty commits, no `--no-verify`, no amending. If a pre-commit hook fails, fix the issue and make a new commit.
- If a push is rejected, follow the `little` skill's `Push Troubleshooting` (usually a rebase onto the latest base) before giving up.
- These checkpoints are best-effort progress insurance, not a substitute for the normal end-of-task commit. Still finish the task cleanly.
