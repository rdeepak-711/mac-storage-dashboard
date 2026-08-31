#!/usr/bin/env node
import { readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { categorize } from "./categorize.mjs";
import { appendIndexEntry, pruneOldScans, SCANS_DIR } from "../lib/run-index.mjs";

/**
 * Recursive filesystem walker — builds one ScanSnapshot (data-model.md).
 *
 * Key decisions, per research.md:
 * - lstat, not stat: a symlink is sized as the tiny symlink object itself
 *   and never recursed into (isDirectory() is false for a symlink).
 * - (dev, ino) tracked across the whole walk to catch hard links: a
 *   duplicate is still shown in the tree (for display) but excluded from
 *   its parent's rolled-up size, so totals aren't double-counted.
 * - allocatedBytes (stat.blocks * 512) vs sizeBytes flags iCloud-optimized
 *   ("dataless") files — real disk usage far below the nominal size.
 * - A directory that can't be read (EACCES) is marked "restricted" with
 *   an unknown size rather than crashing the whole scan.
 */

const ICLOUD_CHECK_MIN_BYTES = 1_000_000; // below this, block rounding alone can look "optimized"
const ICLOUD_ALLOCATED_RATIO = 0.1;

const visitedInodes = new Set();

async function walk(absPath, homeDir) {
  let stat;
  try {
    stat = await lstat(absPath);
  } catch {
    // Vanished between readdir and lstat, or genuinely unreadable at the
    // lstat level (rare) — skip rather than fail the whole scan.
    return null;
  }

  const name = path.basename(absPath) || absPath;
  const category = categorize(absPath, homeDir);
  const flags = [];

  if (stat.nlink > 1) {
    const key = `${stat.dev}:${stat.ino}`;
    if (visitedInodes.has(key)) {
      flags.push("symlink-target-already-counted");
    } else {
      visitedInodes.add(key);
    }
  }

  const allocatedBytes = stat.blocks * 512;

  if (!stat.isDirectory()) {
    if (stat.size > ICLOUD_CHECK_MIN_BYTES && allocatedBytes < stat.size * ICLOUD_ALLOCATED_RATIO) {
      flags.push("icloud-optimized");
    }
    return {
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
      children: [],
    };
  }

  const children = [];
  for (const dirent of dirents) {
    const child = await walk(path.join(absPath, dirent.name), homeDir);
    if (child) children.push(child);
  }

  const rollUp = (key) =>
    children.reduce(
      (sum, c) => sum + (c.flags.includes("symlink-target-already-counted") ? 0 : c[key]),
      0,
    );

  return {
    path: absPath,
    name,
    kind: "directory",
    sizeBytes: rollUp("sizeBytes"),
    allocatedBytes: rollUp("allocatedBytes"),
    category,
    modifiedAt: stat.mtime.toISOString(),
    lastUsedAt: null,
    flags,
    children,
  };
}

// Summed by allocatedBytes (real disk usage), not sizeBytes (logical size) —
// see data-model.md's note on StorageEntry.allocatedBytes: this is what
// actually matches Finder/Storage settings and SC-002's 5% tolerance.
function summarizeByCategory(entry, acc = {}) {
  if (entry.kind === "file") {
    if (!entry.flags.includes("symlink-target-already-counted")) {
      acc[entry.category] = (acc[entry.category] ?? 0) + entry.allocatedBytes;
    }
  } else {
    for (const child of entry.children ?? []) summarizeByCategory(child, acc);
  }
  return acc;
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

  const start = Date.now();
  const rootEntry = await walk(resolvedRoot, homeDir);
  const durationMs = Date.now() - start;

  if (!rootEntry) {
    console.error(`Could not scan ${resolvedRoot} — path missing or unreadable.`);
    process.exitCode = 1;
    return;
  }

  const scannedAt = new Date().toISOString();
  const snapshot = { scannedAt, durationMs, root: rootEntry };

  console.log(`Scanned ${resolvedRoot}`);
  console.log(`Total: ${gb(rootEntry.allocatedBytes)} GB in ${durationMs}ms (real disk usage)`);
  console.log("By category:");
  const byCategory = summarizeByCategory(rootEntry);
  for (const [cat, bytes] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(14)} ${gb(bytes)} GB`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written to data/");
    return;
  }

  const filename = scannedAt.replace(/[:.]/g, "-") + ".json";
  await mkdir(SCANS_DIR, { recursive: true });
  await writeFile(path.join(SCANS_DIR, filename), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  await appendIndexEntry({
    date: scannedAt,
    type: "scan",
    file: `scans/${filename}`,
    totalBytes: rootEntry.allocatedBytes,
    deletedBytes: null,
  });
  const pruned = await pruneOldScans();

  console.log(`\nWrote data/scans/${filename}`);
  if (pruned.length) console.log(`Pruned ${pruned.length} old scan file(s): ${pruned.join(", ")}`);
}

main();
