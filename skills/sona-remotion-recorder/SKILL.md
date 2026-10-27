---
name: sona-remotion-recorder
description: Records a before/after demo video of a branch on the real local app, with a voice-over, from a manual test plan. Drives a real browser, records the screen, runs the plan on master (PR merge base) then on the branch, and edits the clips with Remotion into a branded mp4 with narration. Run only when the user invokes /sona-remotion-recorder.
disable-model-invocation: true
---

# Sona Remotion Recorder

Turns a manual test plan into a narrated demo video of the **real app**: the problem, then the old behaviour on master, then the new behaviour on the branch, then a summary with real numbers.

## Input

**A test plan is required.** It can be a path to a markdown file, pasted text, or a plan written earlier in the chat (for example by the KdB skill). If there's no plan, ask for one and suggest writing one first, with KdB if it's installed. Don't invent the steps.

From the plan, take:

- the stories (scenarios), their data, and the expected result of each on master and on the branch
- the org, site, user, and dates to use
- anything that must happen at the end (locking, payments, exports)

## Output

- `<workspace>/video/out/demo.mp4`: 1080p, 30 fps, a voice-over on every scene
- `<workspace>` is `<worktree>/.agents/<ticket>-demo/`. It is untracked, so it survives branch switches. Never commit it.

## Hard rules

1. **Real app screens.** Record the local app. Use animated cards only for the title, problem, switch and summary. Don't mock product screens unless the user asks for it.
2. **Always a voice-over.** Every scene, cards included, gets a narration line (see *Voice-over*).
3. **Before, then after, on the same data.** "Before" is the PR's merge base (`git merge-base HEAD master`), not the latest master. Only the PR's code should differ between the two runs.
4. **Log in the right way** (see *Login*). By default, log in by yourself as the local account `recorder@local.test`, with no window and no wait for the user. Never ask anyone for their internal-admin password.
5. **Verify with the database after every step that changes data,** against the plan's expected values, before you move on. If a number is off, stop and find out why. Don't record over a wrong state.
6. **Say what's scripted.** If data was created with a script because the UI can't do it, the narration says so, once, in plain words.
7. **Before you start, tell the user what you'll change** on their sandbox: rows you'll create, weeks you'll unlock or lock, branch switches. Ask before anything that can't be undone, and before restarting their dev server. The test plan itself counts as permission for the data changes it describes.
8. **Follow the user's rules:** mix on the host (never Docker), plain language, British English. The exception is a bos VM: there the backend is the `sona-backend` container, and it is the only Elixir.

Read `references/sona-gotchas.md` before planning. It lists the traps that cost time before: past-shift creation, clock-ins, `.env`, recompiles, locks, SSP.

## Tools in this skill

`$SKILL_DIR` below is this skill's base directory (the folder that holds this `SKILL.md`).

`$SKILL_DIR/scripts/` (copy them into `<workspace>/recorder/`, then run `npm install playwright && npx playwright install chromium` there):

| Script | What it does |
|---|---|
| `ensure-recorder-admin.sh [backend_dir]` | Makes sure the local internal admin `recorder@local.test` exists, with a random password kept only in `~/.config/sona-recorder/admin.env` (owner-only). With no argument it finds the dev server on port 4000: on a laptop, mix runs on the host in the server's worktree, against the server's database; on a bos VM, it runs in the `sona-backend` container. Safe to re-run; a data import drops the account and the next run makes it again. |
| `login-headless.mjs <org_id>` | The default login. Logs in as that account with no window, opens `/internal_admin/orgs/<org_id>/users`, ticks "Order by most roles", opens the first user and clicks "Impersonate user". Saves the cookies of a *verified* session to `auth.json` (+ `auth.ok`). On failure, saves `shots/login-<step>.png`. `HEADED=1` shows the browser. |
| `login.mjs [org_id]` | Fallback only. A visible browser at `/internal_admin/` where the user logs in and impersonates by hand. Saves `auth.json` (+ `auth.ok`) the same way, then closes the window itself. |
| `browser.sh start\|stop` | Long-lived headless Chrome on CDP `:9333`. Every step connects to it, so page state survives between steps. |
| `x.mjs <shot> '<js>' [scope]` | Runs a step in that browser, then saves `shots/<shot>.png` and lists the visible controls. Helpers: `h.go(path, {waitGone})`, `h.roster(org, date)`, `h.click(locator \| {x,y})`, `h.move(x,y)`, `h.pause(ms)`, `h.mark(label)`. It draws a visible cursor with a click ripple and moves it smoothly. |
| `rec.mjs <run>` | Background CDP screencast of that browser into `frames/<run>/`, with timestamps. Writes its PID to `.rec-<run>.pid`. Stop it with SIGTERM to that PID. |
| `switch_code.sh <ref>` | Checks that the dev server runs from this worktree, checks out the ref (`--detach` for commits), triggers the recompile, and reports compile errors. |
| `build_clips.py <workspace>` | Cuts frames into clips using `recorder/segments.json` and the markers. Caps idle gaps. Writes `video/public/clips/*.mp4` and `durations.json`. |
| `tts.py <workspace> [voice] [rate]` | `video/narration.json` → `video/public/voice/*.wav` + `durations.json`, with ElevenLabs when a key is found (`$ELEVENLABS_API_KEY`, or `bos-cred elevenlabs` on a bos VM), else macOS `say` (default voice Daniel, en_GB; `say` at 172 wpm). `TTS_ENGINE=say` or `=elevenlabs` forces one. Only regenerates changed lines. |

`$SKILL_DIR/template/video/` is the Remotion project: Sona brand theme, UI primitives, `demo.tsx` (the scene list, clip scenes with the MASTER · BEFORE / BRANCH · AFTER tag, and title, points, switch and summary cards). Copy it to `<workspace>/video/`, then `npm install remotion @remotion/cli @remotion/google-fonts react@19 react-dom@19 && npm install -D typescript @types/react@19`. For brand details, load the `anthropic-skills:sona-new-brand` skill.

`references/`: `sona-gotchas.md`, `example-test-plan.md` (the CORE-2406 plan), `example-setup_demo_data.exs` (past shifts and real clock-ins through app functions).

## Workflow

### 1. Read the plan and check the ground

- List the stories, and the expected before/after numbers for each.
- Find the dev server's worktree (`lsof … -d cwd`) and database (`backend/.env`, the dev server's env). Make sure the worktree has no tracked changes.
- Query the database for the plan's user, org, site and dates. Look for existing data, lock state, and anything the plan assumes.
- Tell the user, in a short list: what you'll create or change (including the local `recorder@local.test` admin, if it doesn't exist yet), and which refs you'll switch between.

### 2. Login (once per task)

You log in by yourself. Don't wait for the user, and don't open a login window.

1. Copy the scripts, then run `bash ensure-recorder-admin.sh` from the recorder directory. It takes up to a minute, because it loads the app's code once to reach the database.
2. Run `node login-headless.mjs <org_id>`. It impersonates the user with the most roles in that org. Say in one line who it impersonated. If the plan needs a particular manager and this user can't do the plan's steps, tell the user.
3. Check the session headlessly: open an org page with `x.mjs` and confirm it isn't the login page.
4. **Keep `auth.json` for the whole task, including follow-up requests** (more stories, re-renders). Deleting it forces another login. Delete it only at the very end, when the user says the video is final, or when you hand back and say that you're keeping it.

If a step fails, read the error line and `shots/login-<step>.png`, fix the cause, and run it again. Only if it still fails and the user is at their screen, offer the fallback: `node login.mjs <org_id>` in the background. That opens a window where they log in and impersonate by hand. Wait for `auth.ok` with a Monitor until-loop, not a sleep.

Never put the recorder password in chat, Slack, a report, a commit or a log. It only works on this machine's local database.

Why the session checks are built this way, from what went wrong with the manual login:

- Saving when the URL left `/users/log_in` fired on an intermediate redirect (`/users/internal_admin`), before the user was logged in.
- Matching the org id anywhere in the URL fired on `/internal_admin/orgs/<id>/users`, before impersonating.
- Watching one tab crashed when impersonation opened or closed a tab.
- A persistent Chrome profile doesn't keep the session, because session cookies are dropped on restart.
- Saving with `context.storageState()` every few seconds made the window flicker and steal focus. It opens a hidden tab for each visited origin that no open tab is on.

Both login scripts avoid all five. They watch every tab, and only save when a tab is on `/orgs/<id>/…` and a request with those cookies isn't redirected to a login page. They save only the app's cookies (all `x.mjs` needs), once.

### 3. Explore before recording

- Start `browser.sh start` in the background. Then drive the UI one small step at a time with `x.mjs`, and **read every screenshot** before the next step.
- Learn the exact controls: ids, `phx-click` values, dialog buttons, date pickers, coordinates of icons with no text. Note every extra step (confirm dialogs, "Reassign shift?", summary pages).
- Walk forms up to their last step **without saving** when saving would create the real "before" data. Close with Cancel/Discard.
- Create data that the UI can't create (past shifts, clock-ins) with an idempotent script. Use app functions, not raw timestamps, so the screens look real. Check the result on screen: the pay record, the roster card.
- **Rehearse irreversible or order-dependent steps off-camera, then revert them.** For example: lock a week, check the calculation and the tooltip, then unlock. The recording then goes right the first time.

### 4. Record "before"

1. `switch_code.sh $(git merge-base HEAD master)`. If it reports a compile error, ask the user to restart the dev server, then re-check.
2. Start `node rec.mjs before` in the background.
3. Perform each story with `x.mjs` and the `h.*` helpers. Put `h.mark('<Story>_<part>_start')` and `_end` around every piece you'll want as a clip. Use deliberate `h.pause()`s where the narration will explain something: 1.5–3 s on key numbers. Move the cursor to what matters (a clock-out time, a count, a tooltip).
4. Check the database after every step that changes data, before the next step (rule 5). The recording keeps running, and `build_clips.py` caps the idle gap.
5. Stop the recorder by its own PID, so another demo's recorder keeps running:

   ```bash
   PID=$(cat .rec-before.pid) && ps -p "$PID" -o command= | grep -q "rec.mjs before" && kill -TERM "$PID"
   ```

### 5. Record "after"

1. `switch_code.sh <branch>`.
2. Start `node rec.mjs after`. Apply the new code to the same data the way the plan says, for example by re-saving each record with no changes. Then show the results, and do the plan's end steps (locks, payments, exports) in the order the app requires.
3. Check the database after every step that changes data, before the next step, the same way as in the "before" run.
4. Stop the recorder the same way, with `.rec-after.pid` and `rec.mjs after`.

If the user adds a story later: set up only that story, switch to the merge base, record it, and re-save the earlier stories off-camera so the "before" screens show "before" values again. Then switch back and record the "after" part again.

### 6. Cut clips

- Write `recorder/segments.json`, one entry per scene. Start from `$SKILL_DIR/template/recorder/segments.json`. Idle cap: `1.2` for forms, `2.0`–`3.6` for screens the narration talks over.
- **Split clips where the narration must line up with something on screen:** a table appearing, each tooltip, each week locked. Use marker offsets taken from the recorded script's pauses.
- Run `build_clips.py`, then extract a frame from the start of each clip with the bundled ffmpeg and look at it. Is it the right screen? Is anything covered? Is the timing right?

### 7. Voice-over

- Write `video/narration.json`: one key per scene, in plain British English, short sentences.
- Write for the ear: acronyms with dots ("S.S.P."), ticket numbers and money the way they're said ("CORE twenty-four oh six", "twenty four pounds sixty five"), dates as spoken ("Tuesday the ninth").
- Say what's on screen, what it means, and why it's right or wrong. Name the real numbers.
- Run `tts.py`. Scene length = max(narration + 1.3 s, clip ÷ 3.5). A clip speeds up to 3.5× at most. If a clip is still long, add a sentence rather than leave silence.

### 8. Compose, check, render

- Edit `video/src/demo.tsx`: the `ITEMS` order, card texts, the summary rows (real numbers only), `TICKET`, `PR`, refs, and `FOOTER_LABEL` in `theme.ts`.
- `npx tsc -p .`, then render stills of a few frames (`npx remotion still src/index.ts Demo out/stills/f<N>.png --frame=<N>`) and look at them: tag placement, overlaps, wrapping headers.
- Render: `npx remotion render src/index.ts Demo out/demo.mp4`. Check the duration and that there's an audio stream (`npx remotion ffprobe out/demo.mp4`).

### 9. Hand back and clean up

- Switch the worktree back to the branch it was on, and confirm the dev server recompiled.
- `browser.sh stop`. Keep `auth.json` if more changes are likely, and say so. Otherwise delete it.
- Report to the user: the video path and length, the scene list, the before/after numbers, every change left on the sandbox (created rows, lock state, and how to undo them), anything you noticed that looks like an existing bug, and how to re-render (`narration.json` → `tts.py` → render).
- Offer to update the test plan with anything the recording taught you (extra steps, scripted setup).
