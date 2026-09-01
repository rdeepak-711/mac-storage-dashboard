import path from "node:path";

/**
 * Deterministic reclaim rules — pure per-entry evaluation, no fs access,
 * so it's cheap to call once per entry INLINE during scan.mjs's existing
 * walk (same pattern as categoryTotals). Re-reading the scan's ~200k
 * per-directory listing files after the fact (a separate pass) would
 * take many minutes at real scale — not viable as a standalone post-hoc
 * script the way quickstart.md originally described it. scan.mjs now
 * calls evaluateEntry() inline and writes the bounded result into
 * meta.json's `cleanupFlags`; this file's own CLI entry point (below)
 * just reads and prints that already-computed data.
 *
 * Trash contents are deliberately NOT flagged as an actionable delete
 * item: our delete action always moves things to Trash (constitution
 * Principle I) — calling that on something already IN Trash doesn't
 * empty it, and actually emptying Trash means permanent deletion, which
 * is banned everywhere in this codebase. Trash size still shows up in
 * the "reclaimable" category total; it's just not a clickable flag here.
 */

export const DEFAULT_STALE_DAYS = 90;
export const LARGE_FILE_BYTES = 100 * 1_000_000; // 100MB
export const DUPLICATE_CANDIDATE_MIN_BYTES = 50 * 1_000_000; // 50MB — see scan.mjs's duplicate pass
const MAX_FLAGS = 50;

function daysSince(isoDate, now) {
  return (now.getTime() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Evaluates ONE StorageEntry against the deterministic rules. Returns a
 * CleanupFlag (data-model.md) or null. Does not handle duplicate-file —
 * that needs cross-entry state (matching sizes) and is computed
 * separately in scan.mjs after the walk completes.
 */
export function evaluateEntry(entry, { now = new Date(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  const basename = path.basename(entry.path);
  const age = daysSince(entry.modifiedAt, now);

  if (basename === "node_modules" && age > staleDays) {
    return {
      path: entry.path,
      ruleId: "stale-node-modules",
      reason: `Build dependencies untouched for ${Math.floor(age)} days — safe to remove, reinstalled automatically by npm/yarn/pnpm when needed`,
      confidence: "safe",
    };
  }

  if (basename === "DerivedData") {
    return {
      path: entry.path,
      ruleId: "xcode-derived-data",
      reason: "Xcode build cache — always safe to remove, regenerated automatically on next build",
      confidence: "safe",
    };
  }

  const parentName = path.basename(path.dirname(entry.path));
  if (
    parentName === "Downloads" &&
    (entry.path.endsWith(".dmg") || entry.path.endsWith(".pkg")) &&
    age > staleDays
  ) {
    return {
      path: entry.path,
      ruleId: "old-downloads-installer",
      reason: `Installer sitting in Downloads for ${Math.floor(age)} days, not the app itself — usually safe once the app is installed`,
      confidence: "caution",
    };
  }

  if (
    entry.kind === "file" &&
    entry.allocatedBytes > LARGE_FILE_BYTES &&
    age > staleDays &&
    entry.category !== "reclaimable"
  ) {
    return {
      path: entry.path,
      ruleId: "stale-large-file",
      reason: `Large file (${(entry.allocatedBytes / 1_000_000_000).toFixed(2)} GB) untouched for ${Math.floor(age)} days`,
      confidence: "caution",
    };
  }

  return null;
}

/**
 * Keeps only the largest MAX_FLAGS flags (by the entry's allocatedBytes,
 * passed alongside) — bounds meta.json size and keeps the Cleanup view
 * to a scannable list instead of every stale node_modules on the disk.
 */
export function boundFlags(flagsWithSize) {
  return flagsWithSize
    .sort((a, b) => b.allocatedBytes - a.allocatedBytes)
    .slice(0, MAX_FLAGS)
    .map((flagWithSize) => ({
      path: flagWithSize.path,
      ruleId: flagWithSize.ruleId,
      reason: flagWithSize.reason,
      confidence: flagWithSize.confidence,
      ...(flagWithSize.duplicateOf ? { duplicateOf: flagWithSize.duplicateOf } : {}),
    }));
}

// CLI entry point — reads an already-computed scan's cleanupFlags and
// prints them. Does NOT re-walk the disk (see file header for why).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const scanFlagIndex = args.indexOf("--scan");
  const metaPath = scanFlagIndex >= 0 ? args[scanFlagIndex + 1] : null;
  if (!metaPath) {
    console.error("Usage: node scanner/reclaim-rules.mjs --scan <path-to-meta.json>");
    process.exitCode = 1;
  } else {
    const { readFile } = await import("node:fs/promises");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const flags = meta.cleanupFlags ?? [];
    console.log(`${flags.length} flagged item(s):`);
    for (const flag of flags) {
      console.log(`  [${flag.confidence}] ${flag.ruleId} — ${flag.path}`);
      console.log(`    ${flag.reason}`);
    }
  }
}
