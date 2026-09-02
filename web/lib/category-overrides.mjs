import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read/add/remove helpers for data/category-overrides.json — a user-
 * managed, persisted list of real paths whose category the scanner should
 * use verbatim, instead of guessing from folder-name heuristics. Added
 * 2026-09-01 after real data showed the heuristics failing badly: 93.4%
 * of Deepak's real top-level folders (99 of 106) fell into "other", and
 * "developer" matched zero of them, because his real folders aren't named
 * `Developer`/`Projects`/`code` — categorize.mjs's assumed names. Rather
 * than keep guessing folder names (which will always lag how someone
 * actually organizes their disk), this lets a real path be fixed once,
 * from wherever it's found in the UI, and it sticks on every future scan.
 * Same pattern as lib/protected-paths.mjs.
 *
 * Matches specs/001-mac-storage-cleanup/data-model.md's CategoryOverride
 * shape.
 */

const DATA_DIR = path.resolve(process.cwd(), "data");
const CATEGORY_OVERRIDES_FILE = path.join(DATA_DIR, "category-overrides.json");

/**
 * Read data/category-overrides.json. Returns [] if the file is missing or
 * empty — "no overrides yet" is a normal, expected state, not an error.
 */
export async function readCategoryOverrides(file = CATEGORY_OVERRIDES_FILE) {
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
 * Add (or replace) the override for a path. Replaces rather than
 * duplicating if the exact path already has an override — re-categorizing
 * something isn't an error, just a correction.
 */
export async function addCategoryOverride(absPath, category, file = CATEGORY_OVERRIDES_FILE) {
  const entries = await readCategoryOverrides(file);
  const remaining = entries.filter((e) => e.path !== absPath);
  remaining.push({ path: absPath, category, addedAt: new Date().toISOString() });
  await writeFile(file, JSON.stringify(remaining, null, 2) + "\n", "utf8");
  return remaining;
}

/** Remove the override for a path, if present. */
export async function removeCategoryOverride(absPath, file = CATEGORY_OVERRIDES_FILE) {
  const entries = await readCategoryOverrides(file);
  const remaining = entries.filter((e) => e.path !== absPath);
  await writeFile(file, JSON.stringify(remaining, null, 2) + "\n", "utf8");
  return remaining;
}

/**
 * True category for candidatePath if any override applies — an exact
 * match, or candidatePath being INSIDE an overridden folder (so
 * overriding ~/dev as "developer" covers everything under it, not just
 * the folder itself). When more than one override could match (nested
 * overrides), the most specific (longest) path wins. Returns null if no
 * override applies — caller falls back to the folder-name heuristics.
 */
export function findOverrideCategory(candidatePath, overrides) {
  const candidate = path.resolve(candidatePath);
  let best = null;
  for (const entry of overrides) {
    const overrideAbs = path.resolve(entry.path);
    const matches = candidate === overrideAbs || candidate.startsWith(overrideAbs + path.sep);
    if (matches && (!best || overrideAbs.length > path.resolve(best.path).length)) {
      best = entry;
    }
  }
  return best ? best.category : null;
}

export { DATA_DIR, CATEGORY_OVERRIDES_FILE };
