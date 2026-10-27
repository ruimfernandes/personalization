#!/usr/bin/env bash
# Make sure the local internal admin recorder@local.test exists, for login-headless.mjs.
# Usage: ensure-recorder-admin.sh [backend_dir]
#
# Where it runs, first match wins:
#   1. backend_dir, when given: mix on the host, in that dir.
#   2. The host dev server on $PORT (default 4000), found by its working dir: mix on the host
#      there, with the server's own DATABASE_* settings. This is the laptop case.
#   3. The sona-backend container. This is the bos VM case.
#
# Nobody's real password is used: a random one is made here, kept only in $ADMIN_ENV
# (owner-only), and set on the account in the local database. Production has no such account.
# Safe to re-run: a fresh data import drops the account, and the next run makes it again.
set -euo pipefail

ADMIN_ENV="${ADMIN_ENV:-$HOME/.config/sona-recorder/admin.env}"
CONTAINER="${CONTAINER:-sona-backend}"
BACKEND_DIR="${1:-}"
SERVER_PID=""

if [ -z "$BACKEND_DIR" ]; then
  SERVER_PID=$(lsof -nP -iTCP:"${PORT:-4000}" -sTCP:LISTEN -t 2> /dev/null | head -1 || true)
  cwd=$([ -n "$SERVER_PID" ] && lsof -a -p "$SERVER_PID" -d cwd -Fn 2> /dev/null | sed -n 's/^n//p' || true)
  if [ -n "$cwd" ] && [ -f "$cwd/mix.exs" ]; then BACKEND_DIR=$cwd; else SERVER_PID=""; fi
fi

if [ -z "$BACKEND_DIR" ] && ! docker inspect "$CONTAINER" > /dev/null 2>&1; then
  echo "No dev server on port ${PORT:-4000} and no $CONTAINER container. Start the app, or pass the backend dir." >&2
  exit 2
fi

if [ ! -s "$ADMIN_ENV" ]; then
  mkdir -p "$(dirname "$ADMIN_ENV")"
  # "Rec_" gives the upper case, lower case and punctuation Sona's password rules ask for.
  (umask 077; printf 'RECORDER_EMAIL=recorder@local.test\nRECORDER_PASSWORD=Rec_%s\n' "$(openssl rand -hex 16)" > "$ADMIN_ENV")
fi
chmod 600 "$ADMIN_ENV"
set -a; . "$ADMIN_ENV"; set +a

# --no-start: only the Repo runs, so this doesn't start a second web server next to the dev one.
CODE='
  {:ok, _} = Application.ensure_all_started([:postgrex, :ecto_sql])
  {:ok, _} = Backend.Repo.start_link(pool_size: 1)
  alias Backend.InternalAdminAccounts
  email = System.fetch_env!("RECORDER_EMAIL")
  password = System.fetch_env!("RECORDER_PASSWORD")

  result =
    case InternalAdminAccounts.get_internal_admin_account_by_email(email) do
      nil ->
        InternalAdminAccounts.register_internal_admin_account(%{email: email, password: password})

      account ->
        if InternalAdminAccounts.get_internal_admin_account_by_email_and_password(email, password),
          do: {:ok, :unchanged},
          else: InternalAdminAccounts.reset_internal_admin_account_password(account, %{password: password})
    end

  db = Backend.Repo.config()[:database]

  case result do
    {:ok, :unchanged} -> IO.puts("recorder admin #{email} in #{db}: ready")
    {:ok, _} -> IO.puts("recorder admin #{email} in #{db}: created or password set")
    {:error, %Ecto.Changeset{} = cs} -> raise "recorder admin: #{inspect(cs.errors)}"
    other -> raise "recorder admin: #{inspect(other)}"
  end
'

if [ -n "$BACKEND_DIR" ]; then
  cd "$BACKEND_DIR"
  # Use the dev server's database: its own environment when it's running, else backend/.env.
  server_env() {
    if [ -n "$SERVER_PID" ] && [ -r "/proc/$SERVER_PID/environ" ]; then tr '\0' '\n' < "/proc/$SERVER_PID/environ"
    elif [ -n "$SERVER_PID" ]; then ps -E -p "$SERVER_PID" -o command= | tr ' ' '\n'
    elif [ -f .env ]; then cat .env
    fi
  }
  while IFS= read -r line; do export "$line"; done < <(server_env | grep -E '^DATABASE_(NAME|HOST|PORT|USERNAME|PASSWORD)=' || true)
  mix run --no-start -e "$CODE"
else
  # The password reaches the container as an env var, never on a command line.
  docker exec -e RECORDER_EMAIL -e RECORDER_PASSWORD "$CONTAINER" mix run --no-start -e "$CODE"
fi
