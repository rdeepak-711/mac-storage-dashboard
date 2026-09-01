import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { StorageEntry, Category } from "./scan-types";

/**
 * Turns a flat list of StorageEntry (one DirectoryListing level — see
 * data-model.md) into positioned rectangles ready to render. Pure layout
 * math — no DOM, no React — so it's testable with plain data and reusable
 * for both the top-level treemap (T010) and any drill-down level (T014).
 */

export interface TreemapRect {
  path: string;
  name: string;
  category: Category;
  kind: "file" | "directory";
  allocatedBytes: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Present only on the synthetic "N more items" cell — see groupSmallEntries(). */
  groupedCount?: number;
}

const GROUPED_PATH = "__grouped__";
// Matches the exact label-visibility check in app/page.tsx
// (r.width > 60 && r.height > 30) — kept in sync deliberately, not
// re-derived, since the whole point is these two must agree.
const MIN_LABEL_WIDTH = 60;
const MIN_LABEL_HEIGHT = 30;
// The grouped "N more items" cell gets a guaranteed minimum layout AREA
// regardless of its real byte share — its whole purpose is staying
// legible. The number it displays stays the real, un-inflated total;
// only where the squarified algorithm places it is adjusted.
const MIN_GROUPED_SHARE = 0.03;
// Bounded, not unbounded — each pass can only shrink the visible set
// (never grow it back), so this terminates well before the cap in
// practice; the cap just guards against surprises.
const MAX_GROUPING_ITERATIONS = 8;
// Same floor as MIN_GROUPED_SHARE, applied to every entry instead of just
// the grouped cell — used by noGroup mode (the category-summary page,
// where there are at most 9 fixed categories and grouping any of them
// away just hides a real category name for no good reason; see app/page.tsx).
const MIN_UNGROUPED_SHARE = 0.03;

function dominantCategoryAndLatestDate(items: StorageEntry[]): { category: Category; modifiedAt: string } {
  const byCategory = new Map<Category, number>();
  let latestModified = items[0]?.modifiedAt ?? new Date(0).toISOString();
  for (const e of items) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.allocatedBytes);
    if (e.modifiedAt > latestModified) latestModified = e.modifiedAt;
  }
  let category: Category = "other";
  let maxBytes = -1;
  for (const [c, bytes] of byCategory) {
    if (bytes > maxBytes) {
      maxBytes = bytes;
      category = c;
    }
  }
  return { category, modifiedAt: latestModified };
}

function buildGroupedEntry(folded: StorageEntry[]): StorageEntry {
  const { category, modifiedAt } = dominantCategoryAndLatestDate(folded);
  const totalBytes = folded.reduce((sum, e) => sum + e.allocatedBytes, 0);
  return {
    path: GROUPED_PATH,
    name: `${folded.length} more items`,
    kind: "directory",
    sizeBytes: totalBytes,
    allocatedBytes: totalBytes,
    category,
    modifiedAt,
    lastUsedAt: null,
    flags: [],
  };
}

function runSquarifiedLayout(entries: StorageEntry[], width: number, height: number, minShare = 0) {
  const totalBytes = entries.reduce((sum, e) => sum + e.allocatedBytes, 0);
  const root = hierarchy<TreemapRoot | StorageEntry>({ children: entries })
    .sum((d) => {
      if (!("allocatedBytes" in d)) return 0;
      const floor = d.path === GROUPED_PATH ? MIN_GROUPED_SHARE : minShare;
      return Math.max(d.allocatedBytes, totalBytes * floor);
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const layout = treemap<TreemapRoot | StorageEntry>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2);

  return layout(root).leaves();
}

interface TreemapRoot {
  children: StorageEntry[];
}

interface OklchColor {
  l: number;
  c: number;
  h: number;
}

/**
 * Base color per category — OKLCH so lightness/chroma stay perceptually
 * consistent across hues. Revised 2026-09-01 after real data showed the
 * problem with the first pass: on Deepak's actual disk, most content
 * falls under "system-data"/"other", and those were near-zero-chroma
 * true greys — technically correct but made the whole treemap look flat
 * and undifferentiated. Both now carry a real, muted hue (cool slate for
 * system-data, warm sand for other) so they read as distinct categories
 * instead of "no color at all", while staying quieter than the named
 * categories per the design brief's restraint principle.
 */
const CATEGORY_BASE: Record<Category, OklchColor> = {
  documents: { l: 0.64, c: 0.14, h: 25 },
  applications: { l: 0.64, c: 0.13, h: 145 },
  developer: { l: 0.64, c: 0.13, h: 250 },
  photos: { l: 0.64, c: 0.13, h: 330 },
  "system-data": { l: 0.5, c: 0.055, h: 255 },
  mail: { l: 0.64, c: 0.12, h: 200 },
  music: { l: 0.64, c: 0.13, h: 300 },
  reclaimable: { l: 0.64, c: 0.15, h: 60 },
  other: { l: 0.46, c: 0.045, h: 70 },
};

export function categoryColor(category: Category): string {
  const { l, c, h } = CATEGORY_BASE[category] ?? CATEGORY_BASE.other;
  return `oklch(${l} ${c} ${h})`;
}

/**
 * Deterministic small hash of a string into [0, 1) — used to vary each
 * cell's lightness slightly within its category. Same path always
 * produces the same shade (stable across re-renders/re-scans), but
 * different sibling paths land at different points in the band, so
 * adjacent same-category cells stay visually separable instead of
 * merging into one undifferentiated block.
 */
function hashUnit(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

/**
 * Per-cell color: the category's base hue/chroma, with lightness offset
 * deterministically by path within a band tight enough to keep the
 * category still readable at a glance, wide enough to give the treemap
 * real visual texture instead of flat same-color blocks.
 */
export function cellColor(category: Category, path: string): string {
  const { l, c, h } = CATEGORY_BASE[category] ?? CATEGORY_BASE.other;
  const band = 0.09;
  const offset = (hashUnit(path) - 0.5) * band;
  const shadedL = Math.min(0.82, Math.max(0.32, l + offset));
  return `oklch(${shadedL.toFixed(3)} ${c} ${h})`;
}

/**
 * Lays out `entries` (one DirectoryListing's worth) into a `width` x
 * `height` box using d3's squarified tiling — see the chat explanation
 * for why squarified over the naive slice-and-dice alternative.
 *
 * Zero-byte entries are dropped: a treemap cell needs positive area, and
 * a 0-byte rectangle has nothing meaningful to show anyway.
 */
export function layoutTreemap(
  entries: StorageEntry[],
  width: number,
  height: number,
  options: { noGroup?: boolean } = {},
): TreemapRect[] {
  let visible = entries.filter((e) => e.allocatedBytes > 0);
  let folded: StorageEntry[] = [];
  if (visible.length === 0) return [];

  // noGroup: skip the fold-small-cells-into-"N more items" loop entirely.
  // Added 2026-09-01 for app/page.tsx's category-summary treemap — there
  // are at most 9 fixed categories there, never hundreds of real folders,
  // so grouping the smallest ones away just hides a real category name
  // Deepak explicitly wants to always see (e.g. "3 more items, 5.0 MB"
  // instead of "documents", "photos", "mail"). Every entry still gets a
  // guaranteed minimum layout area (MIN_UNGROUPED_SHARE) so a genuinely
  // tiny category doesn't shrink to an unreadable sliver — same mechanism
  // already used for the grouped cell itself, just applied to everyone.
  if (options.noGroup) {
    const leaves = runSquarifiedLayout(visible, width, height, MIN_UNGROUPED_SHARE);
    return leaves.map((node) => {
      const entry = node.data as StorageEntry;
      return {
        path: entry.path,
        name: entry.name,
        category: entry.category,
        kind: entry.kind,
        allocatedBytes: entry.allocatedBytes,
        x: node.x0,
        y: node.y0,
        width: node.x1 - node.x0,
        height: node.y1 - node.y0,
        color: cellColor(entry.category, entry.path),
        groupedCount: undefined,
      };
    });
  }

  // Real usability problem found in a real screenshot, twice: a folder
  // with many items produces cells too small to ever show a label. Two
  // earlier fixes (a fixed "top 40" cutoff, then an area-share estimate)
  // both turned out wrong — verified against real numbers: several cells
  // cleared the estimated area but were still individually too narrow
  // (squarified rows share a common height, so area alone doesn't
  // guarantee both dimensions clear the threshold).
  //
  // Correct fix: actually lay out, check the REAL rendered dimensions,
  // fold anything that still fails into the grouped cell, and lay out
  // again — until nothing (other than the grouped cell itself, which has
  // its own guaranteed floor) fails the check. Each pass only shrinks the
  // visible set, so this provably terminates.
  let leaves = runSquarifiedLayout(visible, width, height);

  for (let iteration = 0; iteration < MAX_GROUPING_ITERATIONS && visible.length > 1; iteration++) {
    const currentSet = folded.length > 0 ? [...visible, buildGroupedEntry(folded)] : visible;
    leaves = runSquarifiedLayout(currentSet, width, height);

    const failingPaths = new Set(
      leaves
        .filter((node) => {
          const entry = node.data as StorageEntry;
          if (entry.path === GROUPED_PATH) return false; // has its own guaranteed floor
          const w = (node.x1 ?? 0) - (node.x0 ?? 0);
          const h = (node.y1 ?? 0) - (node.y0 ?? 0);
          return !(w > MIN_LABEL_WIDTH && h > MIN_LABEL_HEIGHT);
        })
        .map((node) => (node.data as StorageEntry).path),
    );

    if (failingPaths.size === 0) break;

    folded = [...folded, ...visible.filter((e) => failingPaths.has(e.path))];
    visible = visible.filter((e) => !failingPaths.has(e.path));
    // Loop re-runs with the shrunk visible set + updated grouped entry.
    // Final `leaves` used below is always from the layout matching the
    // returned visible/folded state, since we re-assign it every pass.
  }

  return leaves.map((node) => {
    const entry = node.data as StorageEntry;
    const isGrouped = entry.path === GROUPED_PATH;
    return {
      path: entry.path,
      name: entry.name,
      category: entry.category,
      kind: entry.kind,
      allocatedBytes: entry.allocatedBytes,
      x: node.x0,
      y: node.y0,
      width: node.x1 - node.x0,
      height: node.y1 - node.y0,
      color: cellColor(entry.category, entry.path),
      groupedCount: isGrouped ? folded.length : undefined,
    };
  });
}
