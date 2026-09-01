import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read/add/remove helpers for data/protected-paths.json — a user-managed,
 * persisted list of real paths the delete flow must refuse unconditionally
 * (FR-010a, constitution Principle I amendment 2026-09-01). Shared by
 * scanner/delete.mjs and the Next.js API routes, same pattern as
 * lib/run-index.mjs.
 *
 * Matches specs/001-mac-storage-cleanup/data-model.md's ProtectedPath shape
 * — that doc is the source of truth.
 */

const DATA_DIR = path.resolve(process.cwd(), "data");
const PROTECTED_PATHS_FILE = path.join(DATA_DIR, "protected-paths.json");

/**
 * Read data/protected-paths.json. Returns [] if the file is missing or
 * empty — "nothing protected yet" is a normal, expected state, not an error.
 */
export async function readProtectedPaths(file = PROTECTED_PATHS_FILE) {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Add a path to the protected list. No-op (returns the unchanged list) if
 * the exact path is already protected — protecting something twice isn't
 * an error, just redundant.
 */
export async function addProtectedPath(absPath, note, file = PROTECTED_PATHS_FILE) {
  const entries = await readProtectedPaths(file);
  if (entries.some((e) => e.path === absPath)) return entries;
  entries.push({ path: absPath, addedAt: new Date().toISOString(), note: note || undefined });
  await writeFile(file, JSON.stringify(entries, null, 2) + "\n", "utf8");
  return entries;
}

/** Remove a path from the protected list, if present. */
export async function removeProtectedPath(absPath, file = PROTECTED_PATHS_FILE) {
  const entries = await readProtectedPaths(file);
  const remaining = entries.filter((e) => e.path !== absPath);
  await writeFile(file, JSON.stringify(remaining, null, 2) + "\n", "utf8");
  return remaining;
}

/**
 * True if candidatePath IS a protected path, or is INSIDE one (a protected
 * folder protects everything under it). Both sides are compared as resolved
 * absolute paths so "/a/b" can't be bypassed by an unresolved "/a/./b" or a
 * trailing slash — real path-boundary logic, not string prefix matching
 * alone: "/a/bcd" must NOT match a protected "/a/b".
 */
export function isProtected(candidatePath, protectedEntries) {
  const candidate = path.resolve(candidatePath);
  return protectedEntries.some((entry) => {
    const protectedAbs = path.resolve(entry.path);
    return candidate === protectedAbs || candidate.startsWith(protectedAbs + path.sep);
  });
}

export { DATA_DIR, PROTECTED_PATHS_FILE };
