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
): TreemapRect[] {
  const sized = entries.filter((e) => e.allocatedBytes > 0);
  if (sized.length === 0) return [];

  const root = hierarchy<TreemapRoot | StorageEntry>({ children: sized })
    .sum((d) => ("allocatedBytes" in d ? d.allocatedBytes : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const layout = treemap<TreemapRoot | StorageEntry>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2);

  const positioned = layout(root);

  return positioned.leaves().map((node) => {
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
    };
  });
}
