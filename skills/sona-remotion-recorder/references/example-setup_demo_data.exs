# Sets up the shifts and clock-ins for the CORE-2406 demo (PR #32189).
#
# The roster UI won't create shifts this far in the past ("Cannot amend a
# record this far in the past": 56-day amendment window), and a manager can't
# add a clock-in to a past shift. So this script does both, the way the app
# does: shifts go through the normal publish path, clock-ins go through
# TimeAndAttendance.clock_in/clock_out.
#
# Run from backend/ with backend/.env loaded (otherwise mix points at the
# default `sona_export` database, not the sandbox). Run the steps a few
# seconds apart so the new-shift jobs settle before the clock-ins are written:
#
#     set -a && source .env && set +a
#     mix run ../.agents/core-2406-demo/setup_demo_data.exs qualify
#     mix run ../.agents/core-2406-demo/setup_demo_data.exs shifts
#     mix run ../.agents/core-2406-demo/setup_demo_data.exs clock_ins
#
# Add a story key to set up only some stories, e.g. `shifts c` then `clock_ins c`.
#
# Both steps are safe to run again. The roster weeks must be unlocked.

import Ecto.Query

alias Backend.ActionedBy
alias Backend.Accounts.User
alias Backend.Repo
alias Backend.Rostering.PublishShifts
alias Backend.Shifts.Shift
alias Backend.TimeAndAttendance.Attendance
alias Backend.TimeAndAttendance
alias Backend.TimeAndAttendance.AttendanceShift

# Fill in the ids from your sandbox before running.
organisation_id = "<org_id>"
org_unit_id = "<site_id>"
user_id = "<employee_id>"
# The manager the recording impersonates.
manager_id = "<manager_id>"
timezone = "Europe/London"

day_shift_type = "<day_shift_type_id>"
night_shift_type = "<night_shift_type_id>"

# All times are London wall-clock time.
demo = [
  %{
    key: "a",
    label: "Tue 26 May day shift",
    starts: ~N[2026-05-26 09:00:00],
    ends: ~N[2026-05-26 17:00:00],
    shift_type_id: day_shift_type,
    description: "Day Shift - support",
    clocked_in: ~N[2026-05-26 09:00:00],
    clocked_out: ~N[2026-05-26 12:00:00]
  },
  %{
    key: "b",
    label: "Mon 1 June night shift",
    starts: ~N[2026-06-01 22:00:00],
    ends: ~N[2026-06-02 06:00:00],
    shift_type_id: night_shift_type,
    description: "Night Shift - support",
    clocked_in: ~N[2026-06-01 22:00:00],
    clocked_out: ~N[2026-06-01 23:30:00]
  },
  %{
    key: "c",
    label: "Mon 8 June night shift",
    starts: ~N[2026-06-08 22:00:00],
    ends: ~N[2026-06-09 06:00:00],
    shift_type_id: night_shift_type,
    description: "Night Shift - support",
    clocked_in: ~N[2026-06-08 22:00:00],
    # Worked past midnight: went home sick at 02:00 on Tuesday.
    clocked_out: ~N[2026-06-09 02:00:00]
  }
]

# An optional last argument picks stories by key, e.g. `shifts c`. Without it,
# every story is set up.
demo =
  case System.argv() do
    [_step, keys] -> Enum.filter(demo, &String.contains?(keys, &1.key))
    _ -> demo
  end

to_utc = fn naive ->
  naive |> DateTime.from_naive!(timezone) |> DateTime.shift_zone!("Etc/UTC")
end

find_shifts = fn starts ->
  Shift
  |> where([s], s.user_id == ^user_id and s.start_datetime == ^to_utc.(starts))
  |> where([s], is_nil(s.deleted_at) and is_nil(s.cancelled_at) and is_nil(s.draft_of_shift_id))
  |> Repo.all()
end

case System.argv() |> Enum.take(1) do
  ["qualify"] ->
    # Night Worker was created with only "Support - Day". Give them the
    # night type of work too, in the same two places the day one lives, so the
    # night shift passes "User is not qualified for this shift".
    night_type_of_work = "<night_type_of_work_id>"
    uid = Ecto.UUID.dump!(user_id)
    tow = Ecto.UUID.dump!(night_type_of_work)
    now = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)

    %{rows: [[employment_period_id]]} =
      Repo.query!(
        """
        select ep.id from employment_periods ep
        join organisation_users ou on ou.id = ep.organisation_user_id
        where ou.user_id = $1 and ep.deleted_at is null
        """,
        [uid]
      )

    %{num_rows: user_rows} =
      Repo.query!(
        "select 1 from user_types_of_work where user_id = $1 and type_of_work_id = $2",
        [uid, tow]
      )

    if user_rows == 0 do
      Repo.query!(
        """
        insert into user_types_of_work
          (id, type_of_work_id, user_id, organisation_id, inserted_at, updated_at,
           show_under_roster_grouping, selectable_for_auto_scheduling)
        values ($1, $2, $3, $4, $5, $5, true, false)
        """,
        [Ecto.UUID.bingenerate(), tow, uid, Ecto.UUID.dump!(organisation_id), now]
      )
    end

    %{num_rows: ep_rows} =
      Repo.query!(
        "select 1 from type_of_work_employment_periods where employment_period_id = $1 and type_of_work_id = $2",
        [employment_period_id, tow]
      )

    if ep_rows == 0 do
      # This table is audited by Carbonite, so the insert needs a Carbonite
      # transaction first, in the same database transaction.
      {:ok, _} =
        Repo.transaction(fn ->
          {:ok, _} = Carbonite.insert_transaction(Repo, %{meta: %{type: "core_2406_demo_setup"}})

          Repo.query!(
            """
            insert into type_of_work_employment_periods
              (id, employment_period_id, type_of_work_id, organisation_id, inserted_at, updated_at)
            values ($1, $2, $3, $4, $5, $5)
            """,
            [
              Ecto.UUID.bingenerate(),
              employment_period_id,
              tow,
              Ecto.UUID.dump!(organisation_id),
              now
            ]
          )
        end)
    end

    IO.puts("Night Worker qualified for Support - Night")

  ["shifts"] ->
    actioned_by = ActionedBy.user_action(Repo.get!(User, manager_id))

    Enum.each(demo, fn spec ->
      case find_shifts.(spec.starts) do
        [shift] ->
          IO.puts("#{spec.label}: already exists (#{shift.id})")

        [] ->
          {:ok, shift} =
            PublishShifts.publish_shift(
              %{
                organisation_id: organisation_id,
                org_unit_id: org_unit_id,
                user_id: user_id,
                shift_type_id: spec.shift_type_id,
                category: :open_shift,
                description: spec.description,
                start_datetime: to_utc.(spec.starts),
                end_datetime: to_utc.(spec.ends),
                start_timezone: timezone,
                end_timezone: timezone
              },
              actioned_by
            )

          IO.puts("#{spec.label}: created (#{shift.id})")

        _ ->
          raise "#{spec.label}: more than one shift at #{spec.starts}. Delete the extra one."
      end
    end)

  ["clock_ins"] ->
    # Clock in and out through the same functions the mobile app and the
    # internal-admin attendance simulator use, so the pay record shows real
    # clock events. `clock_in` skips a shift that already has an attendance,
    # and every past shift gets an empty "no clock-in" one from the new-shift
    # jobs, so that placeholder is removed first. A shift that already has a
    # real clock-in is skipped.
    worker = Repo.get!(User, user_id)
    # The site's {longitude, latitude}, so the clock-ins are inside the geofence.
    # Copy them from the site's location in the database.
    coordinates = {0.0, 0.0}

    Enum.each(demo, fn spec ->
      shift =
        case find_shifts.(spec.starts) do
          [shift] -> shift
          [] -> raise "#{spec.label}: no shift yet. Run the `shifts` step first."
          _ -> raise "#{spec.label}: more than one shift. Delete the extra one."
        end

      attendances =
        Attendance
        |> join(:inner, [a], as in AttendanceShift, on: as.attendance_id == a.id)
        |> where([_a, as], as.shift_id == ^shift.id)
        |> Repo.all()

      # A run that already clocked in is kept as it is. Only an attendance with
      # no clock-in is the empty placeholder, and only that one is deleted.
      case Enum.filter(attendances, & &1.clocked_in_at) do
        [%{clocked_out_at: %DateTime{}} | _] ->
          IO.puts("#{spec.label}: already clocked in and out")

        [_ | _] ->
          raise "#{spec.label}: clocked in but not out. Check the attendance by hand."

        [] ->
          {:ok, _} =
            Repo.transaction(fn ->
              {:ok, _} =
                Carbonite.insert_transaction(Repo, %{meta: %{type: "core_2406_demo_setup"}})

              Enum.each(attendances, &Repo.delete!/1)
            end)

          {:ok, attendance} =
            TimeAndAttendance.clock_in(
              %{worker: worker, shift_id: shift.id, coordinates: coordinates, discrepancies: []},
              ActionedBy.batman(),
              to_utc.(spec.clocked_in)
            )

          {:ok, _} =
            TimeAndAttendance.clock_out(
              %{
                worker: worker,
                shift_id: shift.id,
                attendance_id: attendance.id,
                coordinates: coordinates,
                discrepancies: []
              },
              ActionedBy.batman(),
              to_utc.(spec.clocked_out)
            )

          IO.puts(
            "#{spec.label}: clocked in #{spec.clocked_in}, out #{spec.clocked_out} (London)"
          )
      end
    end)

  _ ->
    IO.puts("Usage: mix run setup_demo_data.exs shifts | clock_ins")
end
