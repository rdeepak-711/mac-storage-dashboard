#!/bin/bash
# Removes the scheduled check installed by install-schedule.sh.
set -euo pipefail

PLIST_LABEL="com.macstoragedashboard.scheduledcheck"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "Uninstalled: $PLIST_PATH"
else
  echo "Nothing installed at $PLIST_PATH"
fi
