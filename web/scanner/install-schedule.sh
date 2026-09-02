#!/bin/bash
# T022 — installs an OPT-IN launchd job that runs scheduled-check.mjs on a
# schedule (default weekly). Never run automatically by anything else in
# this codebase — must be invoked explicitly (constitution Principle VI).
#
# Usage: ./install-schedule.sh [interval-seconds]   (default: 604800 = 7 days)
# Uninstall: ./uninstall-schedule.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INTERVAL_SECONDS="${1:-604800}"
PLIST_LABEL="com.macstoragedashboard.scheduledcheck"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN="$(command -v node)"
DATA_DIR="$WEB_DIR/data"

mkdir -p "$HOME/Library/LaunchAgents" "$DATA_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT_DIR}/scheduled-check.mjs</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${WEB_DIR}</string>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/scheduled-check.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/scheduled-check.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Installed and loaded: $PLIST_PATH"
echo "Runs every ${INTERVAL_SECONDS}s (~$((INTERVAL_SECONDS / 86400)) days)."
echo "Logs: $DATA_DIR/scheduled-check.log"
echo "To trigger once manually right now: launchctl start ${PLIST_LABEL}"
echo "To uninstall: $SCRIPT_DIR/uninstall-schedule.sh"
