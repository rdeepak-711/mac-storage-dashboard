#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestEntry, DATA_DIR } from "../lib/run-index.mjs";

/**
 * T022 — opt-in scheduled check (FR-006b). Runs a real full scan (which
 * already computes cleanupFlags inline — see reclaim-rules.mjs's header
 * for why that's not a separate pass), compares total reclaimable bytes
 * against the last time this ran, and sends a real macOS notification
 * only if newly-reclaimable space crossed a threshold since then. Never
 * invoked automatically by anything else in this codebase — only by the
 * launchd job scanner/install-schedule.sh installs, which itself must be
 * run explicitly by the user (constitution Principle VI: opt-in only).
 */

const STATE_FILE = path.join(DATA_DIR, "scheduled-check-state.json");
const DEFAULT_THRESHOLD_BYTES = 1_000_000_000; // 1GB — override via SCHEDULED_CHECK_THRESHOLD_BYTES

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { lastReclaimableBytes: 0, checkedAt: null };
    throw err;
  }
}

async function main() {
  // fileURLToPath, not raw `.pathname` — found via the same real launchd
  // trigger as the process.execPath fix above: this Drive-mounted path
  // contains a space ("My Drive"), which `import.meta.url` percent-
  // encodes ("My%20Drive"); `.pathname` returns that raw encoded string,
  // not a real filesystem path, so the child scan.mjs path resolved to a
  // literal, nonexistent "%20"-containing path. fileURLToPath decodes it
  // correctly.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const scanScript = path.join(scriptDir, "scan.mjs");
  // `process.execPath` (the absolute path of the Node binary actually
  // running this script), not the bare string "node" — found via a real
  // launchd trigger: launchd jobs run with a minimal environment with no
  // inherited shell PATH, so a bare "node" fails with ENOENT even though
  // it works fine run manually from a terminal.
  execFileSync(process.execPath, [scanScript], { stdio: "inherit" });

  const latest = await latestEntry("scan");
  if (!latest) {
    console.error("scheduled-check: scan produced no result, skipping notification check");
    process.exitCode = 1;
    return;
  }
  const meta = JSON.parse(await readFile(path.join(DATA_DIR, latest.file), "utf8"));
  const reclaimableBytes = (meta.cleanupFlags ?? []).reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);

  const state = await readState();
  const delta = reclaimableBytes - (state.lastReclaimableBytes ?? 0);
  const threshold = Number(process.env.SCHEDULED_CHECK_THRESHOLD_BYTES ?? DEFAULT_THRESHOLD_BYTES);

  if (delta >= threshold) {
    const totalGb = (reclaimableBytes / 1_000_000_000).toFixed(2);
    const deltaGb = (delta / 1_000_000_000).toFixed(2);
    const message = `New reclaimable space: +${deltaGb} GB (total ${totalGb} GB)`;
    execFileSync("osascript", [
      "-e",
      `display notification "${message}" with title "Mac Storage Cleanup" sound name "Glass"`,
    ]);
    console.log(`scheduled-check: notified — ${message}`);
  } else {
    console.log(
      `scheduled-check: no notification — delta ${(delta / 1_000_000_000).toFixed(2)} GB below the ${(
        threshold / 1_000_000_000
      ).toFixed(2)} GB threshold`,
    );
  }

  await writeFile(
    STATE_FILE,
    JSON.stringify({ lastReclaimableBytes: reclaimableBytes, checkedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

await main();
