#!/bin/bash
# Long-lived headless Chrome that every driver/recorder run connects to over
# CDP on :9333, so page state (and the in-memory session) survives between
# steps. Usage: browser.sh start | stop   (run from the recorder directory)
set -euo pipefail
PROFILE="$PWD/.chrome-profile"
case "${1:-}" in
  start)
    CHROME=$(node -e "import('playwright').then(p => console.log(p.chromium.executablePath()))")
    mkdir -p "$PROFILE"
    # exec keeps this shell's PID, so .chrome.pid is Chrome's PID.
    echo $$ > .chrome.pid
    exec "$CHROME" --headless=new --remote-debugging-port=9333 --user-data-dir="$PROFILE" --window-size=1920,1080 about:blank
    ;;
  stop)
    # Stop only the Chrome this script started: the PID must still be a process
    # on this recorder's profile, not whatever else holds port 9333 now.
    PID=$(cat .chrome.pid 2>/dev/null || true)
    if [ -n "$PID" ] && ps -p "$PID" -o command= | grep -qF -- "--user-data-dir=$PROFILE"; then
      kill "$PID"
      for _ in $(seq 50); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$PID" 2>/dev/null; then
        echo "Chrome ($PID) did not stop; kept $PROFILE"
        exit 1
      fi
    fi
    rm -rf "$PROFILE" .chrome.pid
    ;;
  *) echo "usage: browser.sh start|stop"; exit 1 ;;
esac
