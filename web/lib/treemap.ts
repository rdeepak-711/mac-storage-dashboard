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

/**
 * One color per category, OKLCH so lightness/chroma stay perceptually
 * consistent across hues (per .impeccable.md's color rules) — not final
 * visual polish (that's T010's design pass), just a real, distinct
 * mapping so layoutTreemap() is usable and testable now.
 */
const CATEGORY_COLORS: Record<Category, string> = {
  documents: "oklch(0.64 0.14 25)",
  applications: "oklch(0.64 0.13 145)",
  developer: "oklch(0.64 0.13 250)",
  photos: "oklch(0.64 0.13 330)",
  "system-data": "oklch(0.55 0.02 250)",
  mail: "oklch(0.64 0.12 200)",
  music: "oklch(0.64 0.13 300)",
  reclaimable: "oklch(0.64 0.15 60)",
  other: "oklch(0.5 0.01 250)",
};

export function categoryColor(category: Category): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
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
      color: categoryColor(entry.category),
    };
  });
}
