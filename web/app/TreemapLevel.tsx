"use client";

import { useEffect, useRef, useState } from "react";
import { layoutTreemap } from "@/lib/treemap";
import { formatBytes } from "@/lib/format";
import type { MergedFlag } from "@/lib/cleanup-flags";
import { isPathProtected } from "@/lib/cleanup-flags";
import type { DisplayEntry } from "@/lib/scan-types";
import type { ProtectedPath } from "@/lib/scan-types";

/**
 * One drill-down level rendered as a treemap. Used for every level
 * (categories / category-roots / folder) — app/page.tsx swaps the
 * `entries` prop as the user drills in/out; this component is otherwise
 * stateless about navigation. Merged 2026-09-01 from the near-duplicate
 * rect-rendering blocks that used to live separately in app/page.tsx and
 * app/browse/page.tsx.
 *
 * Selection uses a small checkbox rendered inside a cell only when the
 * cell is large enough to show its label (matches the existing
 * label-visibility threshold) — a real, accepted limitation: a tiny
 * directory cell can't offer "select without drilling in" via treemap;
 * List view doesn't have that constraint.
 */
export function TreemapLevel({
  entries,
  flagsByPath,
  selected,
  protectedPaths,
  onToggleSelect,
  onDrillInto,
}: {
  entries: DisplayEntry[];
  flagsByPath: Map<string, MergedFlag>;
  selected: Set<string>;
  protectedPaths: ProtectedPath[];
  onToggleSelect: (path: string) => void;
  onDrillInto: (entry: DisplayEntry) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const entryByPath = new Map(entries.map((e) => [e.path, e]));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((observedEntries) => {
      for (const entry of observedEntries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Category/category-roots levels are small fixed sets (never grouped);
  // a real folder can have hundreds of children (grouping on).
  const noGroup = entries.length <= 12;
  const rects =
    entries.length > 0 && size.width > 0 && size.height > 0
      ? layoutTreemap(entries, size.width, size.height, { noGroup })
      : [];

  const hovered = rects.find((r) => r.path === hoveredPath) ?? null;
  const tooltipWidth = 220;
  const tooltipHeight = 60;
  const tooltipX = Math.min(cursor.x + 16, Math.max(0, size.width - tooltipWidth - 8));
  const tooltipY = Math.min(cursor.y + 16, Math.max(0, size.height - tooltipHeight - 8));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onMouseLeave={() => setHoveredPath(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      {rects.map((r) => {
        const entry = entryByPath.get(r.path);
        const isGrouped = r.groupedCount !== undefined;
        const flag = flagsByPath.get(r.path);
        const isProtected = isPathProtected(r.path, protectedPaths);
        const isSelectable = !isGrouped && !isProtected;
        const isHovered = r.path === hoveredPath;
        const isDimmed = hoveredPath !== null && !isHovered;
        const showLabel = r.width > 60 && r.height > 30;
        const canDrillIn = entry?.kind === "directory" && !isGrouped;

        return (
          <div
            key={r.path}
            onMouseEnter={() => setHoveredPath(r.path)}
            onClick={() => {
              if (isGrouped || !entry) return;
              if (canDrillIn) onDrillInto(entry);
              else if (isSelectable) onToggleSelect(r.path);
            }}
            className={`absolute box-border flex flex-col justify-end overflow-hidden p-2 transition-all duration-150 ${
              isGrouped ? "cursor-default" : "cursor-pointer"
            }`}
            style={{
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              background: r.color,
              opacity: isDimmed ? 0.55 : 1,
              boxShadow: isHovered ? "inset 0 0 0 2px var(--text-primary)" : undefined,
              zIndex: isHovered ? 1 : 0,
            }}
          >
            {isSelectable && showLabel && (
              <input
                type="checkbox"
                checked={selected.has(r.path)}
                onChange={() => onToggleSelect(r.path)}
                onClick={(e) => e.stopPropagation()}
                className="absolute left-2 top-2"
              />
            )}
            {flag && showLabel && (
              <span
                className={`absolute right-2 top-2 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                  flag.confidence === "safe"
                    ? "bg-[color-mix(in_oklch,oklch(0.64_0.13_145)_35%,var(--bg))] text-[oklch(0.85_0.13_145)]"
                    : "bg-[color-mix(in_oklch,oklch(0.64_0.15_60)_35%,var(--bg))] text-[oklch(0.85_0.15_60)]"
                }`}
              >
                {flag.confidence}
              </span>
            )}
            {showLabel && (
              <>
                <div className="flex items-start gap-1 text-sm font-semibold uppercase leading-tight tracking-wide text-[var(--bg)] [overflow-wrap:anywhere]">
                  {isProtected && <span aria-hidden>🔒</span>}
                  <span>{isGrouped ? `+ ${r.name}` : r.name}</span>
                </div>
                <div className="font-[family-name:var(--font-data)] text-xs text-[var(--bg)] opacity-80">
                  {formatBytes(r.allocatedBytes)}
                </div>
              </>
            )}
          </div>
        );
      })}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg"
          style={{ left: tooltipX, top: tooltipY, width: tooltipWidth }}
        >
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{hovered.name}</div>
          <div className="font-[family-name:var(--font-data)] text-xs text-[var(--text-secondary)]">
            {formatBytes(hovered.allocatedBytes)}
          </div>
          {flagsByPath.get(hovered.path) && (
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              {flagsByPath.get(hovered.path)!.reasons.join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
