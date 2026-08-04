---
name: db-changer
description: Switch the local PostgreSQL database used by both the postgres MCP server (.mcp.json at the repo/worktree root) and docker-compose.override.yml. Use when the user starts a prompt with `/db-changer` followed by a DB_NAME, or asks to point the local environment at a different database.
model: haiku
---

# DB Changer

## Purpose

Switch the local Postgres database name in two places at once:

1. `.mcp.json` at the current repo/worktree root — the connection string passed to `@modelcontextprotocol/server-postgres`.
2. `docker-compose.override.yml` at the current repo/worktree root — the `DATABASE_NAME:` value.

This keeps the MCP postgres tools and the Dockerized app pointing at the same database.

## Trigger

The user invokes this skill by typing:

```
/db-changer <DB_NAME>
```

`DB_NAME` is a single token, e.g. `sona_sandbox_ssp`. If `DB_NAME` is missing, ask the user for it before doing anything else.

## Inputs

- `DB_NAME` — the target Postgres database name (required, single argument)
- Working directory — assumed to be the current repo/worktree root. Resolve the repo root with `git rev-parse --show-toplevel` if there is any ambiguity.

## Workflow

### Step 1 — Validate `DB_NAME`

- Must be non-empty.
- Must match a typical Postgres identifier: `^[A-Za-z_][A-Za-z0-9_]*$`. Reject anything else and stop.

### Step 2 — Handle `.mcp.json`

Path: `<repo_root>/.mcp.json`

- **If it does NOT exist**: create it with this exact content (substituting `<DB_NAME>`), assuming default local credentials `postgres:postgres@localhost:5432`:

  ```json
  {
    "mcpServers": {
      "postgres": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-postgres",
          "postgresql://postgres:postgres@localhost:5432/<DB_NAME>"
        ]
      }
    }
  }
  ```

- **If it exists**: read it, find the `mcpServers.postgres.args` array, locate the entry that starts with `postgresql://`, and replace the database segment (the path after the last `/`) with `<DB_NAME>`. Preserve every other field exactly (user, password, host, port, query string, other servers).

  - If `mcpServers.postgres` is missing entirely, add it using the template above.
  - If the connection string is configured via `env.DATABASE_URL` instead of `args`, update that string in place (same path-segment replacement).
  - Never invent credentials; only swap the database-name segment of an existing URL.

### Step 3 — Handle `docker-compose.override.yml`

Path: `<repo_root>/docker-compose.override.yml`

- **If it does NOT exist**: stop and return an error to the user. Do not create it.

  Error message format:

  ```
  Error: docker-compose.override.yml not found at <absolute path>. Create it first, then re-run /db-changer.
  ```

- **If it exists**: replace the `DATABASE_NAME:` value with `<DB_NAME>`.
  - Match the existing line (it looks like `      DATABASE_NAME: <something>`), preserve leading whitespace and the `DATABASE_NAME:` key, swap only the value.
  - If there are multiple `DATABASE_NAME:` occurrences, update all of them and report how many were changed.
  - If the file exists but has no `DATABASE_NAME:` line at all, stop with an error explaining that nothing was changed.

### Step 4 — Report

After both files are handled, print a concise summary:

```
DB changed to <DB_NAME>:
- .mcp.json:                  <created | updated | unchanged>
- docker-compose.override.yml: <updated | unchanged>

Restart Claude Code (or run /mcp) to reconnect the postgres MCP server.
Restart your docker-compose stack to pick up the new DATABASE_NAME.
```

## Hard Rules

- Do not touch any file outside `<repo_root>/.mcp.json` and `<repo_root>/docker-compose.override.yml`.
- Do not modify credentials, hosts, ports, or other servers/env values — only the database-name segment / `DATABASE_NAME:` value.
- Do not create `docker-compose.override.yml` if it is missing — that's an error.
- Do not run `docker compose` commands or restart anything. Just edit the files and tell the user what to do next.
- Do not commit the changes. Both files are typically gitignored, but even if they weren't, leave staging to the user.
- If `DB_NAME` looks suspicious (contains a slash, space, quote, or shell metacharacter), refuse and ask the user to re-issue with a valid identifier.

## Example

User:

```
/db-changer sona_sandbox_ssp
```

Result:

- `.mcp.json` updated so the postgres MCP connection string ends in `/sona_sandbox_ssp`.
- `docker-compose.override.yml` updated so `DATABASE_NAME: sona_sandbox_ssp`.
- Summary printed with next-step reminders (restart MCP, restart docker-compose).
