#!/bin/bash
# Double-click launcher — starts the dashboard and opens it in the browser.
# T011. Runs `next dev --webpack` directly (not disowned/backgrounded away
# from this script) so the server process stays a child of whatever app
# launched this script (Finder/Terminal) — Full Disk Access is granted per
# process ancestry, and an earlier orphaned server process silently lost
# its FDA grant by being detached this way (see tasks.md's T011 note).

cd "$(dirname "$0")/web" || { echo "Could not find web/ next to this script."; exit 1; }

echo "Starting Mac Storage Cleanup Dashboard..."

npx next dev --webpack &
SERVER_PID=$!

# Wait for the server to actually answer before opening the browser —
# opening too early just shows a connection error.
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:3000"; then
    break
  fi
  sleep 0.5
done

open "http://localhost:3000"

echo "Dashboard running at http://localhost:3000 — close this window to stop it."
wait "$SERVER_PID"
