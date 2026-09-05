import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluate,
  hasRecoverableAncestor,
  isInsideTrash,
  isInsidePackage,
  classifyActivity,
  formatBytes,
  daysSince,
  STALE_DAYS,
} from "../lib/recoverability.mjs";
import { isSensitive } from "../lib/sensitive-paths.mjs";

/**
 * Deterministic reclaim rules — pure per-entry evaluation, no fs access,
 * so it's cheap to call once per entry INLINE during scan.mjs's existing
 * walk (same pattern as categoryTotals). Re-reading the scan's ~200k
 * per-directory listing files after the fact (a separate pass) would
 * take many minutes at real scale — not viable as a standalone post-hoc
 * script the way quickstart.md originally described it. scan.mjs calls
 * evaluateEntry() inline and writes the bounded result into meta.json's
 * `cleanupFlags`; this file's own CLI entry point (below) just reads and
 * prints that already-computed data.
 *
 * REWRITTEN 2026-09-03. The three rules that used to live here as
 * hand-written special cases — `stale-node-modules`,
 * `xcode-derived-data` and `regenerable-cache` — are gone. They each
 * emitted `confidence: "safe"`, a single word that conflated *nothing is
 * lost* with *nothing that matters is lost*, and the `regenerable-cache`
 * rule flagged all of ~/.cache and all of ~/.npm as ONE item each with
 * no age gate at all: accepting it deleted 5.6 GB of HuggingFace models
 * untouched since July. All three are now expressed by the tier tables
 * in lib/recoverability.mjs, which report how a thing comes back, when
 * it was last touched, and what restoring it costs, and which resolve to
 * one of three dispositions instead of a binary.
 *
 * What remains here are the rules that are genuinely about CONTEXT
 * rather than about what a folder is — an installer is only junk because
 * of where it sits, a large file is only suspicious in combination with
 * its age. Those can't be table lookups, so they stay as real rules.
 *
 * Trash contents are deliberately NOT flagged as an actionable delete
 * item: our delete action always moves things to Trash (constitution
 * Principle I) — calling that on something already IN Trash doesn't
 * empty it, and actually emptying Trash means permanent deletion, which
 * is banned everywhere in this codebase. Trash size still shows up in
 * the "reclaimable" category total; it's just not a clickable flag here.
 *
 * See docs/superpowers/specs/2026-09-03-recoverability-and-never-suggest-design.md
 */

export const DEFAULT_STALE_DAYS = STALE_DAYS;
export const LARGE_FILE_BYTES = 100 * 1_000_000; // 100MB
export const DUPLICATE_CANDIDATE_MIN_BYTES = 50 * 1_000_000; // 50MB — see scan.mjs's duplicate pass

const MAX_SUGGESTED = 50;
const MAX_REVIEW = 30;

/**
 * Evaluates ONE StorageEntry. Returns a flag or null. Does not handle
 * duplicate-file — that needs cross-entry state (matching sizes) and is
 * computed separately in scan.mjs after the walk completes.
 *
 * Order matters: the tier tables get first refusal, because a
 * `node_modules` should be reported as a rebuildable dependency tree and
 * not as "a large file untouched for 200 days". The context rules below
 * only see what the tables didn't claim.
 */
export function evaluateEntry(entry, { now = new Date(), staleDays = STALE_DAYS, isProtectedFn } = {}) {
  // Space inside an already-recoverable container is counted by the flag
  // on the container itself — see hasRecoverableAncestor's doc comment.
  if (hasRecoverableAncestor(entry.path)) return null;

  // .Trash contents are never flagged — see isInsideTrash()'s note. The
  // real bug this fixes: ~/.Trash/huggingface and ~/.Trash/uv, already
  // moved to Trash the day before, showed up as freshly SUGGESTED.
  if (isInsideTrash(entry.path)) return null;

  const verdict = evaluate(entry, { now, isProtectedFn });

  if (verdict.disposition === "suggested" || verdict.disposition === "review") {
    return {
      path: entry.path,
      ruleId: verdict.recoverability === "irreplaceable" ? "unused-large-folder" : "regenerable",
      disposition: verdict.disposition,
      recoverability: verdict.recoverability,
      activity: verdict.activity,
      reason: verdict.cost,
      restoreCommand: verdict.restoreCommand,
      lastTouchedAt: verdict.lastTouchedAt,
    };
  }

  // ---- Context rules: not about WHAT the thing is, but WHERE it sits ----

  if (isSensitive(entry.path)) return null;

  const age = daysSince(entry.modifiedAt, now);
  const parentName = path.basename(path.dirname(entry.path));

  if (
    parentName === "Downloads" &&
    (entry.path.endsWith(".dmg") || entry.path.endsWith(".pkg")) &&
    age > staleDays
  ) {
    return {
      path: entry.path,
      ruleId: "old-downloads-installer",
      disposition: "review",
      recoverability: "redownload",
      activity: classifyActivity(entry.modifiedAt, now),
      reason: `Installer sitting in Downloads for ${Math.floor(age)} days, not the app itself — usually safe once the app is installed, and re-downloadable from the vendor.`,
      restoreCommand: null,
      lastTouchedAt: entry.modifiedAt,
    };
  }

  // isInsidePackage: a 600MB binary inside Docker.app or site-packages is
  // not a forgotten file, it is a load-bearing part of something
  // installed — and its mtime is a build date, not evidence of disuse.
  // See isInsidePackage()'s note for the real flags this suppressed.
  if (
    entry.kind === "file" &&
    entry.allocatedBytes > LARGE_FILE_BYTES &&
    age > staleDays &&
    !isInsidePackage(entry.path)
  ) {
    return {
      path: entry.path,
      ruleId: "stale-large-file",
      disposition: "review",
      recoverability: "irreplaceable",
      activity: classifyActivity(entry.modifiedAt, now),
      reason: `Large file (${formatBytes(entry.allocatedBytes)}) untouched for ${Math.floor(age)} days. Cannot be regenerated — only you know if it still matters.`,
      restoreCommand: null,
      lastTouchedAt: entry.modifiedAt,
    };
  }

  return null;
}

/**
 * Drops any flag that sits INSIDE another flag, keeping the outermost.
 *
 * Two flags where one contains the other are not two findings — they are
 * the same bytes counted twice, and the pre-delete confirmation
 * (Principle I: show the real total before anything moves) would then
 * show a number larger than the space actually freed. Deleting the
 * parent takes the child with it regardless, so the parent is the honest
 * unit and the child is noise.
 *
 * Added 2026-09-03 as a structural backstop, not a patch: the specific
 * nesting bugs found on the first real run (unbounded review depth,
 * over-generic `dist`) were each fixed at their source, but "no flag may
 * contain another" is an invariant the whole model depends on, and it
 * should hold even when some future rule gets it wrong.
 *
 * "Outermost wins" is only correct WITHIN a disposition. A `review`
 * container holding `suggested` children must yield to the children: on
 * the real disk ~/.npm is a 12 GB review item whose contents are
 * _cacache (7.6 GB) and _npx (3.6 GB), both provably re-downloadable.
 * Keeping the parent would replace two things Deepak can act on with one
 * he can only squint at — the opposite of the point. So a review flag
 * that contains any suggested flag is dropped first, and only then does
 * outermost-wins run over what's left.
 */
function dropNestedFlags(flagsWithSize) {
  const suggested = flagsWithSize.filter((f) => f.disposition === "suggested");
  const survivors = flagsWithSize.filter((flag) => {
    if (flag.disposition !== "review") return true;
    return !suggested.some((s) => s.path.startsWith(flag.path + path.sep));
  });

  // Sorting by path makes any container sort immediately before
  // everything it contains, so one linear pass settles the rest.
  const sorted = survivors.sort((a, b) => a.path.localeCompare(b.path));
  const kept = [];
  let lastKeptPath = null;
  for (const flag of sorted) {
    if (lastKeptPath !== null && flag.path.startsWith(lastKeptPath + path.sep)) continue;
    kept.push(flag);
    lastKeptPath = flag.path;
  }
  return kept;
}

/**
 * Keeps the largest flags of each disposition — bounds meta.json size
 * and keeps the Cleanup view to a scannable list instead of every stale
 * node_modules on the disk.
 *
 * Bounded PER DISPOSITION, not globally (changed 2026-09-03): a single
 * shared cap sorted by size would let 50 suggested items crowd out every
 * review item, which is the exact failure the review tier exists to
 * prevent — the whole point is that the ~19 GB of unprovable, abandoned
 * tooling stays visible.
 *
 * sizeBytes is kept on the returned flag (not just used for sorting then
 * discarded) — the pre-delete confirmation (FR-008) must show the total
 * size before anything is removed, and this is the one place that size
 * was already known and about to be thrown away.
 */
export function boundFlags(flagsWithSize) {
  // Last line of defence, and the ONLY place every flag from every rule
  // must pass through before reaching meta.json. evaluateEntry() already
  // refuses sensitive paths, but the duplicate-file rule builds its
  // flags directly in scan.mjs after the walk and bypassed it entirely —
  // found 2026-09-03, on the real disk, by verify-recoverability.mjs.
  // Fixing only that one rule would leave the next rule free to make the
  // same mistake, so the guarantee belongs here, at the choke point,
  // where it holds regardless of who produced the flag.
  const safe = flagsWithSize.filter((f) => !isSensitive(f.path) && !isInsideTrash(f.path));
  const deduped = dropNestedFlags(safe);

  const take = (disposition, limit) =>
    deduped
      .filter((f) => f.disposition === disposition)
      .sort((a, b) => b.allocatedBytes - a.allocatedBytes)
      .slice(0, limit);

  return [...take("suggested", MAX_SUGGESTED), ...take("review", MAX_REVIEW)].map((flag) => ({
    path: flag.path,
    ruleId: flag.ruleId,
    disposition: flag.disposition,
    recoverability: flag.recoverability,
    activity: flag.activity,
    reason: flag.reason,
    restoreCommand: flag.restoreCommand ?? null,
    lastTouchedAt: flag.lastTouchedAt ?? null,
    sizeBytes: flag.allocatedBytes,
    ...(flag.duplicateOf ? { duplicateOf: flag.duplicateOf } : {}),
  }));
}

// CLI entry point — reads an already-computed scan's cleanupFlags and
// prints them. Does NOT re-walk the disk (see file header for why).
// fileURLToPath + path.resolve, not a raw string compare — a bare
// `import.meta.url === \`file://${process.argv[1]}\`` silently never
// matches on a path containing a space (this project lives under a
// Google Drive-mounted "My Drive" folder): import.meta.url percent-
// encodes the space, process.argv[1] doesn't. Found real 2026-09-02 via
// scheduled-check.mjs's identical bug.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
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
    for (const disposition of ["suggested", "review"]) {
      const group = flags.filter((f) => f.disposition === disposition);
      const total = group.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
      console.log(`\n${disposition.toUpperCase()} — ${group.length} item(s), ${formatBytes(total)}`);
      for (const flag of group) {
        console.log(`  ${formatBytes(flag.sizeBytes).padStart(8)}  ${flag.activity.padEnd(7)} ${flag.path}`);
        console.log(`            ${flag.reason}`);
      }
    }
  }
}
