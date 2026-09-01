#!/usr/bin/env node
import { readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { statfsSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { categorize } from "./categorize.mjs";
import { evaluateEntry, boundFlags, DUPLICATE_CANDIDATE_MIN_BYTES } from "./reclaim-rules.mjs";
import { appendIndexEntry, pruneOldScans, listingFilename, SCANS_DIR } from "../lib/run-index.mjs";

/**
 * Recursive filesystem walker.
 *
 * ARCHITECTURE NOTE (2026-08-31): the first version of this file built one
 * giant in-memory tree for the whole scan, then JSON.stringify'd it as one
 * document. Against a real ~250GB home directory that crashed twice: first
 * "RangeError: Invalid string length" (one JSON string too big for V8),
 * then — after switching to a streaming writer — "JavaScript heap out of
 * memory" (the in-memory object tree itself, ~4GB+, too big to hold at
 * once). Both are symptoms of the same root problem: a full-disk file tree
 * has far more nodes than should ever be held, serialized, or transmitted
 * as a single blob (this would also have broken the API response and the
 * browser's JSON.parse later).
 *
 * The fix: walk() never returns or retains a directory's full children.
 * Each directory's immediate children are written to their OWN small
 * listing file (data/scans/<timestamp>/<hash-of-path>.json) as soon as
 * they're computed, and only a lightweight summary (no `children` field)
 * bubbles up to the parent. Memory use is bounded by one directory level
 * at a time, not by total file count — a scan of 10 files or 2 million
 * files uses roughly the same peak memory.
 *
 * Per-file decisions are unchanged from the original design (research.md):
 * lstat (not stat) so symlinks are sized as themselves and never followed;
 * (dev,ino) tracked to de-dup hard links; allocatedBytes vs sizeBytes
 * flags iCloud/Drive-placeholder files; unreadable directories are marked
 * "restricted" instead of failing the whole scan.
 */

const ICLOUD_CHECK_MIN_BYTES = 1_000_000;
const ICLOUD_ALLOCATED_RATIO = 0.1;

const visitedInodes = new Set();

/**
 * Walks absPath. Returns a lightweight StorageEntry summary (never a
 * `children` array). If scanDir is provided, writes a listing file for
 * every directory visited: { path, entries: <one level of children> }.
 * categoryTotals is mutated in place as leaf files are visited — this is
 * how the overall per-category breakdown is computed without a second
 * pass over a (no-longer-existing) full tree afterward.
 *
 * reclaimCandidates and duplicateCandidatesBySize are mutated the same
 * way — evaluateEntry() (scanner/reclaim-rules.mjs) runs inline on every
 * entry as it's computed, same reasoning as categoryTotals: re-reading
 * the scan's ~200k listing files afterward for this would take minutes.
 * Duplicate detection needs cross-entry state (matching sizes), so only
 * the cheap part (group candidate paths by exact size) happens here;
 * the actual content-hash comparison runs once, after the walk, in
 * main() — see findDuplicates().
 */
async function walk(absPath, homeDir, scanDir, categoryTotals, reclaimCandidates, duplicateCandidatesBySize) {
  let stat;
  try {
    stat = await lstat(absPath);
  } catch {
    return null; // vanished between readdir and lstat, or unreadable — skip
  }

  const name = path.basename(absPath) || absPath;
  const category = categorize(absPath, homeDir);
  const flags = [];

  if (stat.nlink > 1) {
    const key = `${stat.dev}:${stat.ino}`;
    if (visitedInodes.has(key)) flags.push("symlink-target-already-counted");
    else visitedInodes.add(key);
  }

  const allocatedBytes = stat.blocks * 512;

  if (!stat.isDirectory()) {
    if (stat.size > ICLOUD_CHECK_MIN_BYTES && allocatedBytes < stat.size * ICLOUD_ALLOCATED_RATIO) {
      flags.push("icloud-optimized");
    }
    const entry = {
      path: absPath,
      name,
      kind: "file",
      sizeBytes: stat.size,
      allocatedBytes,
      category,
      modifiedAt: stat.mtime.toISOString(),
      lastUsedAt: null,
      flags,
    };
    if (!flags.includes("symlink-target-already-counted")) {
      categoryTotals[category] = (categoryTotals[category] ?? 0) + allocatedBytes;

      const flag = evaluateEntry(entry);
      if (flag) reclaimCandidates.push({ ...flag, allocatedBytes });

      if (allocatedBytes >= DUPLICATE_CANDIDATE_MIN_BYTES) {
        const bucket = duplicateCandidatesBySize.get(allocatedBytes) ?? [];
        bucket.push(absPath);
        duplicateCandidatesBySize.set(allocatedBytes, bucket);
      }
    }
    return entry;
  }

  let dirents;
  try {
    dirents = await readdir(absPath, { withFileTypes: true });
  } catch {
    return {
      path: absPath,
      name,
      kind: "directory",
      sizeBytes: 0,
      allocatedBytes: 0,
      category,
      modifiedAt: stat.mtime.toISOString(),
      lastUsedAt: null,
      flags: [...flags, "restricted"],
    };
  }

  const children = [];
  for (const dirent of dirents) {
    const child = await walk(
      path.join(absPath, dirent.name),
      homeDir,
      scanDir,
      categoryTotals,
      reclaimCandidates,
      duplicateCandidatesBySize,
    );
    if (child) children.push(child);
  }

  const rollUp = (key) =>
    children.reduce(
      (sum, c) => sum + (c.flags.includes("symlink-target-already-counted") ? 0 : c[key]),
      0,
    );
  const sizeBytes = rollUp("sizeBytes");
  const dirAllocatedBytes = rollUp("allocatedBytes");

  if (scanDir) {
    const listingPath = path.join(scanDir, listingFilename(absPath));
    await writeFile(listingPath, JSON.stringify({ path: absPath, entries: children }), "utf8");
  }

  // children is dropped here (goes out of scope) — only the summary below
  // is returned, so the parent never retains this level's data.
  const dirEntry = {
    path: absPath,
    name,
    kind: "directory",
    sizeBytes,
    allocatedBytes: dirAllocatedBytes,
    category,
    modifiedAt: stat.mtime.toISOString(),
    lastUsedAt: null,
    flags,
  };

  const flag = evaluateEntry(dirEntry);
  if (flag) reclaimCandidates.push({ ...flag, allocatedBytes: dirAllocatedBytes });

  return dirEntry;
}

function gb(bytes) {
  return (bytes / 1_000_000_000).toFixed(2);
}

/**
 * Content-hashes files that already share an identical size — cheap
 * pre-filter (size grouping happened for free during the main walk),
 * so this only ever hashes real candidates, never the whole disk.
 * Bounded further by DUPLICATE_CANDIDATE_MIN_BYTES (50MB) — tiny
 * duplicate files aren't worth the hashing cost or the user's attention.
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function findDuplicateFlags(duplicateCandidatesBySize) {
  const flags = [];
  for (const [sizeBytes, paths] of duplicateCandidatesBySize.entries()) {
    if (paths.length < 2) continue;

    const byHash = new Map();
    for (const filePath of paths) {
      let digest;
      try {
        digest = await hashFile(filePath);
      } catch {
        continue; // vanished or unreadable since the walk saw it — skip, don't fail the scan
      }
      const bucket = byHash.get(digest) ?? [];
      bucket.push(filePath);
      byHash.set(digest, bucket);
    }

    for (const matchingPaths of byHash.values()) {
      if (matchingPaths.length < 2) continue;
      const [kept, ...duplicates] = matchingPaths;
      for (const dup of duplicates) {
        flags.push({
          path: dup,
          ruleId: "duplicate-file",
          reason: `Identical content to ${kept}`,
          confidence: "caution",
          duplicateOf: kept,
          allocatedBytes: sizeBytes,
        });
      }
    }
  }
  return flags;
}

function parseArgs(argv) {
  const args = { root: process.env.HOME ?? ".", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const { root, dryRun } = parseArgs(process.argv.slice(2));
  const resolvedRoot = path.resolve(root);
  const homeDir = process.env.HOME ?? resolvedRoot;

  const scannedAt = new Date().toISOString();
  const scanFolderName = scannedAt.replace(/[:.]/g, "-");
  const scanDir = dryRun ? null : path.join(SCANS_DIR, scanFolderName);
  if (scanDir) await mkdir(scanDir, { recursive: true });

  const categoryTotals = {};
  const reclaimCandidates = [];
  const duplicateCandidatesBySize = new Map();
  const start = Date.now();

  // The dashboard's root is synthetic, not a single real filesystem path:
  // $HOME's own top-level folders plus /Applications, which sits outside
  // $HOME entirely (per spec.md's Assumptions — macOS Storage settings
  // covers both, and Applications is real, often-large space that a
  // $HOME-only scan would silently miss). Each real folder is still
  // walked and listed normally; only the very top level is synthetic.
  const topEntries = [];
  let homeDirents = [];
  try {
    homeDirents = await readdir(resolvedRoot, { withFileTypes: true });
  } catch {
    console.error(`Could not read ${resolvedRoot} — path missing or unreadable.`);
    process.exitCode = 1;
    return;
  }
  for (const dirent of homeDirents) {
    const child = await walk(
      path.join(resolvedRoot, dirent.name),
      homeDir,
      scanDir,
      categoryTotals,
      reclaimCandidates,
      duplicateCandidatesBySize,
    );
    if (child) topEntries.push(child);
  }
  // Only merge in /Applications for a real full-home scan — a scoped test
  // scan (--root ./some/small/folder) shouldn't silently also walk 11GB
  // of /Applications every time.
  const includedApplications = resolvedRoot === homeDir;
  if (includedApplications) {
    const applicationsEntry = await walk(
      "/Applications",
      homeDir,
      scanDir,
      categoryTotals,
      reclaimCandidates,
      duplicateCandidatesBySize,
    );
    if (applicationsEntry) {
      // $HOME often has its own (usually near-empty) "Applications" folder
      // too — real, found via a live test: both would otherwise display
      // with the identical name "Applications" at the top level, with no
      // way to tell which is which without reading the raw path.
      applicationsEntry.name = "Applications (system-wide)";
      topEntries.push(applicationsEntry);
    }
  }

  const durationMs = Date.now() - start;

  const ROOT_PATH = "__root__"; // synthetic id, not a real fs path
  const rollUp = (key) =>
    topEntries.reduce(
      (sum, c) => sum + (c.flags.includes("symlink-target-already-counted") ? 0 : c[key]),
      0,
    );
  const rootEntry = {
    path: ROOT_PATH,
    name: "This Mac",
    kind: "directory",
    sizeBytes: rollUp("sizeBytes"),
    allocatedBytes: rollUp("allocatedBytes"),
    category: "other",
    modifiedAt: scannedAt,
    lastUsedAt: null,
    flags: [],
  };
  if (scanDir) {
    await writeFile(
      path.join(scanDir, listingFilename(ROOT_PATH)),
      JSON.stringify({ path: ROOT_PATH, entries: topEntries }),
      "utf8",
    );
  }

  // Real, whole-disk context (added 2026-09-01, per Deepak's request):
  // the actual volume's total capacity and free space, from the OS
  // itself (fs.statfsSync) — not derived from our scan, which only
  // covers a subset ($HOME + /Applications). Shown alongside our
  // category breakdown so "used X of Y GB total" is honest about how
  // much of the real disk this tool has actually looked at vs. what
  // macOS itself reports as used/free.
  const volumeStats = statfsSync(resolvedRoot);
  const diskTotalBytes = volumeStats.blocks * volumeStats.bsize;
  const diskFreeBytes = volumeStats.bavail * volumeStats.bsize;
  const diskUsedBytes = diskTotalBytes - diskFreeBytes;

  // Duplicate detection's actual hashing pass — only real candidates
  // (same-size files, already grouped for free during the walk above),
  // never the whole disk. See findDuplicateFlags() for why this can't
  // run inline during the walk itself (needs cross-entry state).
  const duplicateFlags = await findDuplicateFlags(duplicateCandidatesBySize);
  const cleanupFlags = boundFlags([...reclaimCandidates, ...duplicateFlags]);

  console.log(`Scanned ${resolvedRoot}${includedApplications ? " + /Applications" : ""}`);
  console.log(`Total: ${gb(rootEntry.allocatedBytes)} GB in ${durationMs}ms (real disk usage)`);
  console.log(`Disk: ${gb(diskUsedBytes)} GB used of ${gb(diskTotalBytes)} GB total (${gb(diskFreeBytes)} GB free)`);
  console.log("By category:");
  for (const [cat, bytes] of Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(14)} ${gb(bytes)} GB`);
  }
  console.log(`Cleanup flags: ${cleanupFlags.length} (of ${reclaimCandidates.length + duplicateFlags.length} found, bounded to largest)`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written to data/");
    return;
  }

  await writeFile(
    path.join(scanDir, "meta.json"),
    JSON.stringify(
      {
        scannedAt,
        durationMs,
        root: rootEntry,
        categoryTotals,
        diskTotalBytes,
        diskUsedBytes,
        diskFreeBytes,
        cleanupFlags,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await appendIndexEntry({
    date: scannedAt,
    type: "scan",
    file: `scans/${scanFolderName}/meta.json`,
    totalBytes: rootEntry.allocatedBytes,
    deletedBytes: null,
  });
  const pruned = await pruneOldScans();

  console.log(`\nWrote data/scans/${scanFolderName}/`);
  if (pruned.length) console.log(`Pruned ${pruned.length} old scan folder(s): ${pruned.join(", ")}`);
}

main();
