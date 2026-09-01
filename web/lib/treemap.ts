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

const DEFAULT_MAX_VISIBLE = 40;
const GROUPED_PATH = "__grouped__";

/**
 * Added 2026-09-01 — real usability problem found in a real screenshot:
 * a folder with 95 real items produces dozens of cells too small to
 * ever show a label, discoverable only by hovering one at a time. That's
 * not usable. Standard treemap fix: keep the largest `maxVisible - 1`
 * items individually visible, and fold everything smaller into one
 * clearly-labeled "N more items" cell — nothing hidden, just legible.
 * The grouped cell's category is whichever category holds the most
 * bytes among the folded items, and its size is the real sum — never a
 * fabricated number.
 */
function groupSmallEntries(
  entries: StorageEntry[],
  maxVisible: number,
): { entries: StorageEntry[]; groupedCount: number | null } {
  const sized = entries.filter((e) => e.allocatedBytes > 0);
  if (sized.length <= maxVisible) return { entries: sized, groupedCount: null };

  const sorted = [...sized].sort((a, b) => b.allocatedBytes - a.allocatedBytes);
  const visible = sorted.slice(0, maxVisible - 1);
  const rest = sorted.slice(maxVisible - 1);

  const totalRest = rest.reduce((sum, e) => sum + e.allocatedBytes, 0);
  const byCategory = new Map<Category, number>();
  let latestModified = rest[0]?.modifiedAt ?? new Date(0).toISOString();
  for (const e of rest) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.allocatedBytes);
    if (e.modifiedAt > latestModified) latestModified = e.modifiedAt;
  }
  let dominantCategory: Category = "other";
  let dominantBytes = -1;
  for (const [category, bytes] of byCategory) {
    if (bytes > dominantBytes) {
      dominantBytes = bytes;
      dominantCategory = category;
    }
  }

  const grouped: StorageEntry = {
    path: GROUPED_PATH,
    name: `${rest.length} more items`,
    kind: "directory",
    sizeBytes: totalRest,
    allocatedBytes: totalRest,
    category: dominantCategory,
    modifiedAt: latestModified,
    lastUsedAt: null,
    flags: [],
  };

  return { entries: [...visible, grouped], groupedCount: rest.length };
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
  maxVisible: number = DEFAULT_MAX_VISIBLE,
): TreemapRect[] {
  const { entries: displayEntries, groupedCount } = groupSmallEntries(entries, maxVisible);
  if (displayEntries.length === 0) return [];

  // The grouped "N more items" cell exists specifically to stay legible —
  // that's its entire purpose. But its real byte share can still be tiny
  // (a real bug caught in verification: it rendered at 16x16px, completely
  // empty — exactly the problem it was built to solve). Its layout AREA
  // gets a guaranteed floor (MIN_GROUPED_SHARE of the total); the number
  // it displays (allocatedBytes on the returned rect) stays the real,
  // un-inflated value — only where the squarified algorithm places it is
  // adjusted, never what it claims to be.
  const MIN_GROUPED_SHARE = 0.03;
  const totalBytes = displayEntries.reduce((sum, e) => sum + e.allocatedBytes, 0);

  const root = hierarchy<TreemapRoot | StorageEntry>({ children: displayEntries })
    .sum((d) => {
      if (!("allocatedBytes" in d)) return 0;
      if (d.path === GROUPED_PATH) return Math.max(d.allocatedBytes, totalBytes * MIN_GROUPED_SHARE);
      return d.allocatedBytes;
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const layout = treemap<TreemapRoot | StorageEntry>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2);

  const positioned = layout(root);

  return positioned.leaves().map((node) => {
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
      groupedCount: isGrouped ? (groupedCount ?? undefined) : undefined,
    };
  });
}
