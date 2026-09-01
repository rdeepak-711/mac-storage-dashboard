#!/usr/bin/env node
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import trash from "trash";
import { appendIndexEntry, DELETES_DIR } from "../lib/run-index.mjs";
import { readProtectedPaths, isProtected } from "../lib/protected-paths.mjs";

/**
 * Deletes (moves to Trash) a set of real paths. This is the one place in
 * the codebase where files actually leave the disk — everything here
 * exists to make Constitution Principle I (Safety-First Deletion) true in
 * code, not just in the doc:
 *
 *  1. Protected Paths (FR-010a) are checked FIRST, unconditionally, before
 *     anything else — a match here refuses the item the same hard way a
 *     boundary violation does, regardless of confidence/ruleId/AI origin.
 *  2. The $HOME boundary (FR-010) is checked next. In practice this is
 *     $HOME-only, not "$HOME plus known-safe caches": every deterministic
 *     rule in reclaim-rules.mjs (stale node_modules, DerivedData, Downloads
 *     installers, stale large files, duplicate files) only ever flags
 *     paths already under $HOME — nothing in this codebase can produce a
 *     flagged path outside it today, so there is no real "safe cache
 *     outside $HOME" case yet to special-case (YAGNI, constitution
 *     Principle VI). If that ever changes, extend isWithinBoundary(), not
 *     the callers.
 *  3. Each path is re-verified to still exist right before it's moved
 *     (FR-012) — a vanished file is reported in `skipped`, never silently
 *     dropped and never failing the whole batch.
 *  4. Deletion always goes through the `trash` package (Finder's own
 *     move-to-Trash) — `fs.rm`/`fs.unlink` must never appear here.
 *  5. Every successful deletion is written to a `data/deletes/<ts>.json`
 *     log and a matching `data/index.json` row BEFORE this function
 *     returns (FR-011) — the audit trail exists even if the caller (the
 *     API route, or a person's terminal) never checks the response.
 */

function isWithinBoundary(absPath, homeDir) {
  const resolvedHome = path.resolve(homeDir);
  return absPath === resolvedHome || absPath.startsWith(resolvedHome + path.sep);
}

/**
 * requestedPaths: string[] — real absolute (or resolvable) filesystem
 * paths, matching contracts/api.md's POST /api/delete request body.
 *
 * Returns { deleted: {path, sizeBytes}[], skipped: {path, reason}[] } —
 * every requested path lands in exactly one of the two, independently of
 * how any other requested path resolved (per-item refusal, not
 * per-request — contracts/api.md's 403 note).
 */
export async function deletePaths(requestedPaths, { homeDir = process.env.HOME, protectedPathsFile } = {}) {
  if (!homeDir) throw new Error("HOME environment variable is not set");
  const protectedEntries = await readProtectedPaths(protectedPathsFile);

  const deleted = [];
  const skipped = [];

  for (const rawPath of requestedPaths) {
    const absPath = path.resolve(rawPath);

    if (isProtected(absPath, protectedEntries)) {
      skipped.push({ path: absPath, reason: "protected path — never delete" });
      continue;
    }

    if (!isWithinBoundary(absPath, homeDir)) {
      skipped.push({ path: absPath, reason: "outside allowed boundary" });
      continue;
    }

    let stat;
    try {
      stat = await lstat(absPath);
    } catch {
      skipped.push({ path: absPath, reason: "no longer exists" });
      continue;
    }

    const sizeBytes = stat.blocks * 512; // allocatedBytes — matches the scanner's convention

    try {
      await trash(absPath);
    } catch (err) {
      skipped.push({
        path: absPath,
        reason: `move to Trash failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    deleted.push({ path: absPath, sizeBytes });
  }

  if (deleted.length > 0) {
    const deletedAt = new Date().toISOString();
    const logEntries = deleted.map((d) => ({
      path: d.path,
      sizeBytes: d.sizeBytes,
      deletedAt,
      // The current API contract (contracts/api.md) passes a flat list of
      // paths, not the CleanupFlag/AISuggestion each came from — so there
      // is no ruleId to attribute here yet. null is the documented,
      // honest value for "manually selected without either" (data-model.md).
      ruleId: null,
    }));
    const logFileName = `${deletedAt.replace(/[:.]/g, "-")}.json`;
    await mkdir(DELETES_DIR, { recursive: true });
    await writeFile(
      path.join(DELETES_DIR, logFileName),
      JSON.stringify(logEntries, null, 2) + "\n",
      "utf8",
    );
    await appendIndexEntry({
      date: deletedAt,
      type: "delete",
      file: `deletes/${logFileName}`,
      totalBytes: null,
      deletedBytes: deleted.reduce((sum, d) => sum + d.sizeBytes, 0),
    });
  }

  return { deleted, skipped };
}

// CLI entry point — for T018's manual verification against disposable test
// files ONLY. Requires --yes so a bare `node scanner/delete.mjs <path>`
// (e.g. run by habit, or with tab-completion picking the wrong path)
// previews instead of acting.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const paths = args.filter((a) => a !== "--yes");

  if (paths.length === 0) {
    console.error("Usage: node scanner/delete.mjs <path> [<path> ...] --yes");
    console.error("Without --yes, prints what would happen without deleting anything.");
    process.exitCode = 1;
  } else if (!confirmed) {
    console.log("DRY PREVIEW (pass --yes to actually move these to Trash):");
    for (const p of paths) console.log(`  ${path.resolve(p)}`);
  } else {
    const result = await deletePaths(paths);
    console.log(`Deleted ${result.deleted.length}:`);
    for (const d of result.deleted) console.log(`  ${d.path} (${d.sizeBytes} bytes)`);
    console.log(`Skipped ${result.skipped.length}:`);
    for (const s of result.skipped) console.log(`  ${s.path} — ${s.reason}`);
  }
}
