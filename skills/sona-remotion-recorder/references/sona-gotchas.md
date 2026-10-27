# Sona gotchas for demo recordings

Things that cost time in earlier recordings. Check the ones that apply before you start.

## Environment

- **Load `backend/.env` before any `mix run`.** Run `set -a && source .env && set +a` from `backend/`. Without it, mix points at the default `sona_export` database, not the sandbox the dev server uses. The dev server gets its env from its own terminal, so compare it with `ps eww -p <pid> | tr ' ' '\n' | grep ^DATABASE_`.
- **Run mix on the host, never in Docker.** Use the worktree's own `backend/`.
- **The dev server on :4000 runs from one worktree.** Check it with `lsof -a -p $(lsof -tiTCP:4000 -sTCP:LISTEN) -d cwd -Fn`. Switching branches in that worktree changes what the app serves. `scripts/switch_code.sh` checks this for you.
- **Use the PR merge base as "before", not the latest master.** Get it with `git merge-base HEAD master`, then `git checkout --detach <sha>`. A checkout that touches hundreds of files can make the in-process recompile fail on "cannot define module Backend.Gettext". After that, the user has to restart the dev server. `master` may also be checked out in another worktree, so always use `--detach`.
- **The postgres MCP shows `timestamp` columns shifted by the local offset.** In BST it shows an hour early. Check wall-clock times with `at time zone 'UTC' at time zone 'Europe/London'`, or trust the app.
- **Internal-admin login.** The user logs in at `/internal_admin/`, then impersonates a manager. The recording runs as that impersonated manager. The purple "User: … " impersonation banner shows in the recording, which is fine.

## Creating demo data

- **The roster UI refuses shifts older than the amendment window.** The message is "Cannot amend a record this far in the past". The window is `organisations.amendment_time_window_in_days`, default 56, counted back from today. Create older shifts with a script through `Backend.Rostering.PublishShifts.publish_shift/2`, the normal publish path. See `example-setup_demo_data.exs`.
- **A manager can't add a clock-in to a past shift.** The internal-admin "Simulate attendance" tool also crashes on a past shift that already has its empty "no clock-in" attendance. Delete that placeholder attendance, inside a Carbonite transaction, then call `TimeAndAttendance.clock_in/3` and `clock_out/3` with explicit datetimes and the site's coordinates. Writing `clocked_in_at` directly makes the pay record say "did not clock in", even though the database has the time.
- **"User is not qualified for this shift".** The worker needs the shift type's type of work in `user_types_of_work`. The issue check also wants it in `type_of_work_employment_periods`.
- **Carbonite-audited tables** (for example `type_of_work_employment_periods`, `attendances`) reject raw writes. Run `Carbonite.insert_transaction(Repo, %{meta: %{type: "..."}})` first, in the same `Repo.transaction`.
- **Only some shift types get clock-in data.** Pick one that other shifts at that site were clocked in to. On a type that doesn't need time and attendance, the absence takeover deletes the attendance.
- **Make setup scripts idempotent and selectable.** `script.exs <step> [story keys]` lets you add one story later without touching the others.

## Absences and SSP

- **Add absence:** click the worker's name on the roster, then **Add absence**. Pick the dates in the calendar pickers, then the absence type. Sickness types show the **SSP qualifying days** toggles, pre-selected from the rostered weekdays. **Continue** leads to **Reassign shift?** (choose **Do not reassign**), then **Save**, then a summary step, then **Save** again.
- **Edit absence:** the ≡ icon at the right end of the absence bar opens **Cancel Absence** / **Edit Absence**. **Save** is enabled even with no changes.
- **PIWs (qualifying days) are rebuilt only when an absence is saved.** Locking, clock-ins and unlocking don't rebuild them. So "same data, new code" means switching the code, then re-saving each absence.
- **Roster weeks lock in order.** A later week can't lock before an earlier one: "Please lock the week of … first". The dialog says "Approve N records and lock roster". Locking runs the SSP calculation, source `roster_lock`. Unlock in reverse order. Unlocking removes the calculations. The unlock dialog's "unapprove shifts" box can stay unticked.
- **SSP History:** Employees → search → profile → **SSP** tab. Hovering an **SSP Payments** amount shows a tooltip with each paid day and its amount. The summary tiles show SSP days used and total SSP received.
- **Average weekly earnings** come from the LEL. With no NI-able earnings, the contracted-data fallback is used (weekly hours × rate). Check `ssp_lels` before assuming payments will be £0.
- **A shift taken over by an absence** shows on the roster as "09:00–09:00 · 0h". That's existing display behaviour. Don't narrate it as part of the change.

## Verifying

- After every step that changes data, query the database and compare with the plan's expected values **before** you move on. For SSP that means `ssp_piws.qualifying_days` and `ssp_calculations.payment_segments[].daily_payments`. If the numbers don't match, stop recording and find out why.
