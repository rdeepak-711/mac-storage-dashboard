import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Read/append/prune helpers for data/index.json and data/scans/.
 * Shared by the scanner scripts (scanner/ .mjs files) and the Next.js API
 * routes (app/api route handlers) — both run with cwd() at the web/ project
 * root, so the default paths below resolve the same way from either caller.
 *
 * Matches specs/001-mac-storage-cleanup/data-model.md's IndexEntry shape —
 * that doc is the source of truth.
 */

const DATA_DIR = path.resolve(process.cwd(), "data");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const SCANS_DIR = path.join(DATA_DIR, "scans");
const DELETES_DIR = path.join(DATA_DIR, "deletes");

const MAX_RETAINED_SCANS = 10;

/**
 * Read data/index.json. Returns [] if the file is missing or empty —
 * never throws for "no scans yet", since that's a real, expected state
 * (constitution Principle II: an empty/pending state, not an error).
 */
export async function readIndex(indexFile = INDEX_FILE) {
  try {
    const raw = await readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Append one IndexEntry to data/index.json. Index entries are small and
 * kept forever (constitution: durable trend record), so this never prunes.
 */
export async function appendIndexEntry(entry, indexFile = INDEX_FILE) {
  const entries = await readIndex(indexFile);
  entries.push(entry);
  await writeFile(indexFile, JSON.stringify(entries, null, 2) + "\n", "utf8");
  return entries;
}

/**
 * Keep only the most recent MAX_RETAINED_SCANS scan folders in data/scans/,
 * deleting the rest (recursively — each scan is a folder of per-directory
 * listing files, not a single file, since a full-disk scan's tree is too
 * large to hold or write as one JSON document; see scan.mjs). Folder names
 * are ISO-timestamp-prefixed, so lexicographic sort order is chronological.
 * Returns the list of deleted folder names.
 *
 * Only ever touches data/scans/ — never data/deletes/ (delete logs are the
 * audit trail; they are not pruned) and never anything outside DATA_DIR.
 */
export async function pruneOldScans(scansDir = SCANS_DIR, keep = MAX_RETAINED_SCANS) {
  let entries;
  try {
    entries = (await readdir(scansDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  entries.sort();
  const toDelete = entries.slice(0, Math.max(0, entries.length - keep));

  for (const dir of toDelete) {
    await rm(path.join(scansDir, dir), { recursive: true, force: true });
  }

  return toDelete;
}

export { DATA_DIR, INDEX_FILE, SCANS_DIR, DELETES_DIR };
