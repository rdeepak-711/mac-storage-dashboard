#!/usr/bin/env node
import { readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { statfsSync } from "node:fs";
import path from "node:path";
import { categorize } from "./categorize.mjs";
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
 */
async function walk(absPath, homeDir, scanDir, categoryTotals) {
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
    const child = await walk(path.join(absPath, dirent.name), homeDir, scanDir, categoryTotals);
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
  return {
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
}

function gb(bytes) {
  return (bytes / 1_000_000_000).toFixed(2);
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
    const child = await walk(path.join(resolvedRoot, dirent.name), homeDir, scanDir, categoryTotals);
    if (child) topEntries.push(child);
  }
  // Only merge in /Applications for a real full-home scan — a scoped test
  // scan (--root ./some/small/folder) shouldn't silently also walk 11GB
  // of /Applications every time.
  const includedApplications = resolvedRoot === homeDir;
  if (includedApplications) {
    const applicationsEntry = await walk("/Applications", homeDir, scanDir, categoryTotals);
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

  console.log(`Scanned ${resolvedRoot}${includedApplications ? " + /Applications" : ""}`);
  console.log(`Total: ${gb(rootEntry.allocatedBytes)} GB in ${durationMs}ms (real disk usage)`);
  console.log(`Disk: ${gb(diskUsedBytes)} GB used of ${gb(diskTotalBytes)} GB total (${gb(diskFreeBytes)} GB free)`);
  console.log("By category:");
  for (const [cat, bytes] of Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(14)} ${gb(bytes)} GB`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written to data/");
    return;
  }

  await writeFile(
    path.join(scanDir, "meta.json"),
    JSON.stringify(
      { scannedAt, durationMs, root: rootEntry, categoryTotals, diskTotalBytes, diskUsedBytes, diskFreeBytes },
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
