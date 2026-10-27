# CORE-2406 demo: SSP stops paying for a day the employee worked

PR: https://github.com/sona-is/sona/pull/32189
Ticket: https://get-sona.atlassian.net/browse/CORE-2406
Branch: `rf/core-2406-night-workers-ssp`

This plan is for recording a video. It has three parts:

1. What problem we are solving
2. Demo of the current behaviour on `master`
3. Demo of the same data on the branch, and what changed

## Fixed facts for this demo

| Thing | Value |
|---|---|
| App | http://localhost:4000 (the dev server runs from `~/Github/<worktree>/backend`) |
| Database | `<sandbox_db>` |
| Organisation | Example Care (`<org_id>`) |
| Site | Example Site (`<site_id>`) |
| Employee | Night Worker (`<employee_id>`), employee number `<employee_number>` |
| Contract type | Full Time - Hourly (no SSP default days, so the qualifying days are picked by hand) |
| Sickness type | Sick Leave |
| Week 1 | Mon 25 May – Sun 31 May 2026. **Locked right now.** Mon 25 May is a bank holiday, so the demo starts on Tuesday. |
| Week 2 | Mon 1 June – Sun 7 June 2026. Unlocked. |

All times below are London time (BST).

## The two stories

**Story A: went home sick part-way through a day shift (week 1)**

- Tue 26 May: day shift 09:00–17:00. The employee clocks in at 09:00, feels ill, and clocks out at 12:00.
- The manager records Sick Leave from Tue 26 to Fri 29 May.
- They worked on Tuesday, so Tuesday must not be an SSP day.

**Story B: went home sick during a night shift (week 2)**

- Mon 1 June: night shift 22:00 → Tue 06:00. The employee clocks in at 22:00 and goes home sick at 23:30.
- The manager records Sick Leave from Mon 1 to Fri 5 June.
- They worked on Monday, so Monday must not be an SSP day.
- Tuesday must stay an SSP day. The only work "on" Tuesday would be the end of Monday's night shift, and the night worker rule counts a night shift only on the day it starts.

In both stories the SSP working pattern is Mon–Fri.

## Expected numbers

| | Story A (26–29 May) | Story B (1–5 June) |
|---|---|---|
| `master` | **4** qualifying days: Tue, Wed, Thu, Fri | **5** qualifying days: Mon, Tue, Wed, Thu, Fri |
| Branch | **3** qualifying days: Wed, Thu, Fri | **4** qualifying days: Tue, Wed, Thu, Fri |

On `master`, the day the employee worked is still paid as SSP. On the branch, it isn't.

---

## Setup (off camera, before recording)

Do this once. None of it depends on which branch is checked out.

### S1. Unlock week 1

1. Log in as a manager for Example Care.
2. Open **Roster** and select the **Example Site** site.
3. Go to the week of **25 May 2026** and unlock it.
4. Leave week 2 (1 June) unlocked. It is unlocked already.

A sickness absence can't be added to a locked week. The clock-in script also refuses to write to a locked week.

### S2 + S3. Create the shifts and clock-ins with the script

The UI can't do this part:

- The roster refuses new shifts this far in the past ("Cannot amend a record this far in the past": the 56-day amendment window).
- A manager can't add a clock-in to a past shift.

So `setup_demo_data.exs` does it. Shifts go through the normal publish path, and clock-ins go through `TimeAndAttendance.clock_in/clock_out`. The pay record then shows real clock events, for example "Clock out 12:00 · 5 hours early".

Load `backend/.env` first. Without it, mix points at the default `sona_export` database, not the sandbox.

```bash
cd ~/Github/<worktree>/backend
set -a && source .env && set +a
mix run ../.agents/core-2406-demo/setup_demo_data.exs qualify    # gives Night Worker the "Support - Night" type of work
mix run ../.agents/core-2406-demo/setup_demo_data.exs shifts     # Tue 26 May 09:00–17:00, Mon 1 June 22:00–06:00
mix run ../.agents/core-2406-demo/setup_demo_data.exs clock_ins  # 09:00→12:00 and 22:00→23:30
```

Every step is safe to run again. `add_clock_ins.exs` is the older version, and it only writes the timestamps. The SSP logic reads those, but the pay record then says "did not clock in", so don't use it for a recording.

### S4. Check the setup

Run this query. You'll run it again later.

```bash
docker exec sona-postgres-1 psql -U postgres -d <sandbox_db> -c "
select to_char(s.start_datetime at time zone 'UTC' at time zone 'Europe/London', 'Dy DD Mon HH24:MI') as shift_start,
       s.absence_period_id is not null as taken_over_by_absence,
       to_char(a.clocked_in_at at time zone 'UTC' at time zone 'Europe/London', 'HH24:MI') as clocked_in,
       to_char(a.clocked_out_at at time zone 'UTC' at time zone 'Europe/London', 'HH24:MI') as clocked_out
from shifts s
left join attendances_shifts ats on ats.shift_id = s.id
left join attendances a on a.id = ats.attendance_id
where s.user_id = '<employee_id>' and s.deleted_at is null
order by s.start_datetime;"
```

Expected: 2 rows. `Tue 26 May 09:00` clocked in 09:00, out 12:00. `Mon 01 Jun 22:00` clocked in 22:00, out 23:30. `taken_over_by_absence` is `f` on both.

### S5. Check out the PR's merge base (not the latest `master`)

```bash
cd ~/Github/<worktree>
git checkout --detach 0f34a5ec811
```

Use the merge base, not the latest `master`. Newer `master` touches hundreds of files, and the dev server's in-process recompile can get stuck on "cannot define module Backend.Gettext". If that happens, restart the dev server.

Wait for the dev server to recompile, then refresh the browser. The untracked `.agents/` folder stays in place.

---

## Part 1: What problem we are solving (on camera, about 1 minute)

Show the PR or the ticket, and say something like:

> UK sick pay rules say that if someone works even one minute on a day, that day is not a sick day. So Statutory Sick Pay isn't paid for it.
>
> In Sona, when someone clocks in, works part of a shift and then goes home sick, the manager records a sickness absence. The absence takes over the shift. The bug is that the SSP calculation ignores every shift that an absence has taken over, even when the employee clocked in to it. So the day they worked becomes an SSP qualifying day, and we pay SSP for a day they worked.
>
> Night workers have an extra rule. A night shift counts as worked only on the day it starts. So the day after a night shift can still be a sick day.

Then show the setup on the roster:

1. Open **Roster → Example Site**, week of **25 May 2026**.
2. Open the Tue 26 May shift's **"..."** menu → **View pay record** (or **Edit pay record**). Point at the **Attendance** section: **Clock in 09:00**, **Clock out 12:00**. Close it.
3. Go to the week of **1 June 2026**. Do the same for the Mon 1 June night shift: **Clock in 22:00**, **Clock out 23:30**.

Say:

> Both shifts have real clock-in data. The employee worked on Tuesday the 26th, and on Monday the 1st before midnight.

---

## Part 2: Demo on `master`

Make sure `master` is checked out (step S5).

### 2.1 Record the Story A absence

1. On the Example Site roster, week of 25 May, add an absence for **Night Worker**.
2. Type: **Sick Leave**. From **Tue 26 May 2026** to **Fri 29 May 2026**.
3. In the **SSP qualifying days** step, turn on **Mon, Tue, Wed, Thu, Fri**. Turn off Sat and Sun. Only Tuesday is pre-selected, because that's the only rostered day that week. Say that the pattern is Mon–Fri. On the next step, set **Reassign shift?** to **Do not reassign**, then Save, then Save again on the summary step.
4. **Save**.

Expected: the absence appears on the roster over Tue–Fri, and the Tuesday shift now shows as absence.

### 2.2 Record the Story B absence

1. Go to the week of 1 June.
2. Add an absence for **Night Worker**: **Sick Leave**, **Mon 1 June 2026** to **Fri 5 June 2026**.
3. **SSP qualifying days**: **Mon–Fri** on, Sat and Sun off.
4. **Save**.

### 2.3 Check the takeover (terminal)

Run the S4 query again.

Expected: `taken_over_by_absence` is now `t` on both rows, and the clock-in times are still there. This proves the bug's starting condition: an absence shift with a real clock-in.

If `taken_over_by_absence` is `f`, or the clock-in is gone, stop. The demo would show no difference. Check the shift type (step S2).

### 2.4 Show the SSP result

1. Open the HR people list (user management), search for **Night Worker**, and open the profile.
2. Open the **SSP History** tab. The URL ends with `/hr/user_management/<employee id>/ssp_history`.
3. Point at the **Qualifying Days** column:
   - 26 May – 29 May: **4**
   - 1 June – 5 June: **5**
4. Optional: expand the row and open **Details** on each period to show the same count in the side panel.

The SSP History page shows a count, not the dates. To show the dates, run:

```bash
docker exec sona-postgres-1 psql -U postgres -d <sandbox_db> -c "
select start_date, end_date, qualifying_days
from ssp_piws
where user_id = '<employee_id>' and deleted_at is null and archived_at is null
order by start_date;"
```

Expected on `master`:

```
 start_date | end_date   | qualifying_days
 2026-05-26 | 2026-05-29 | {2026-05-26,2026-05-27,2026-05-28,2026-05-29}
 2026-06-01 | 2026-06-05 | {2026-06-01,2026-06-02,2026-06-03,2026-06-04,2026-06-05}
```

Say:

> On master, Tuesday 26 May and Monday 1 June are qualifying days. The employee clocked in on both days, so we would pay SSP for days they worked.

---

## Part 3: Demo on the branch

### 3.1 Switch to the branch

```bash
cd ~/Github/<worktree>
git checkout rf/core-2406-night-workers-ssp
```

Wait for the recompile, then refresh the browser.

Say:

> Same data, same absences. The only change is the code. SSP qualifying days are worked out when an absence is saved, so I'll re-save both absences.

### 3.2 Re-save both absences

1. On the Example Site roster, week of 25 May, open the **26–29 May Sick Leave** absence.
2. Don't change the dates or the SSP qualifying days (still Mon–Fri). Click **Save**. If Save is disabled when nothing has changed, add a note such as "re-saved on branch", then save.
3. Do the same for the **1–5 June** absence.

### 3.3 Show the new SSP result

1. Refresh the Night Worker's **SSP History** tab.
2. Point at **Qualifying Days**:
   - 26 May – 29 May: **3** (was 4)
   - 1 June – 5 June: **4** (was 5)
3. Run the `ssp_piws` query again. Expected:

```
 start_date | end_date   | qualifying_days
 2026-05-26 | 2026-05-29 | {2026-05-27,2026-05-28,2026-05-29}
 2026-06-01 | 2026-06-05 | {2026-06-02,2026-06-03,2026-06-04,2026-06-05}
```

### 3.4 Explain the differences

Say:

> **Story A:** Tuesday 26 May is gone. The employee clocked in that day before going home sick, so it's a worked day, not a sick day. Wednesday to Friday stay, because they didn't clock in on those days.
>
> **Story B:** Monday 1 June is gone, because they clocked in to Monday's night shift. **Tuesday is still a qualifying day,** even though the night shift ran until 06:00 on Tuesday. A night shift counts only for the day it starts. That's the night worker rule, so night workers aren't disadvantaged.
>
> **What didn't change:** an approved absence shift with no clock-in still counts as a sick day. Locking the roster approves absence shifts too, so approval alone can't mean "worked". Only a real clock-in does.

---

## Story C and locking (added for the second recording)

**Story C: a night shift worked past midnight (week of 8 June)**

- Mon 8 June: night shift 22:00 → Tue 06:00. Clocked in 22:00, went home sick at **02:00 on Tuesday**.
- Set it up with `mix run ../.agents/core-2406-demo/setup_demo_data.exs shifts c`, then `clock_ins c`.
- Sick Leave from Mon 8 to Fri 12 June, SSP days Mon–Fri, **Do not reassign**.
- Expected on `master`: **5** qualifying days (Mon–Fri).
- Expected on the branch: **4** (Tue–Fri). Tue 9 stays a sick day even though they worked 00:00–02:00 on it, because the night shift started on Monday (reg 2(2)).

**Locking and payments (branch, at the end)**

1. Lock the weeks in order: 25 May, then 1 June, then 8 June. A later week can't be locked before an earlier one ("Please lock the week of 25 May 2026 first").
2. Each lock asks to "Approve N records and lock roster". Confirm it. Locking runs the SSP calculation.
3. Open **Employees → Night Worker → SSP** and hover over each **SSP Payments** amount. The tooltip lists the paid days.

Expected on the branch:

| Absence | Qualifying days | SSP paid | Paid days (tooltip) |
|---|---|---|---|
| 26–29 May | 3 | £73.95 | 27, 28, 29 May |
| 1–5 June | 4 | £98.60 | 2, 3, 4, 5 June |
| 8–12 June | 4 | £98.60 | 9, 10, 11, 12 June |

The total is £271.15 over 11 SSP days: £24.65 a day, which is £123.25 a week over a 5-day pattern. Average weekly earnings come from the contracted-data fallback (40h × £30).

To run the demo again, unlock the weeks in reverse order (8 June, 1 June, 25 May). Unlocking removes the SSP calculations.

## Extra checks (optional, after the main recording)

- **Night shift, Tuesday outside the pattern.** Edit the 1–5 June absence. Set the SSP qualifying days to **Mon, Wed, Fri** and save. Expected on the branch: **2** qualifying days (Wed 3, Fri 5). Monday is worked, and Tuesday isn't in the pattern.
  - The ticket's old QA plan expected 3 here, because it added Tuesday even outside the pattern.
  - The PR deliberately doesn't do that. SSP is only paid on the agreed pattern days (reg 5).
  - Say this clearly if you record it. It's the one place the branch differs from the ticket's QA plan on purpose.
- **No clock-in, no change.** Days where the employee never clocked in (Wed–Fri in Story A) are qualifying days on both `master` and the branch. The steps above already show this.

## Clean-up

- Re-lock the week of 25 May 2026 if you want it back as it was.
- Leave the branch checked out, or switch back to whatever the dev server normally runs.
- No data reset is needed between Part 2 and Part 3. If you want to replay the whole demo from scratch, delete the two Sick Leave absences and the Night Worker's SSP data, then start again from step S4.
