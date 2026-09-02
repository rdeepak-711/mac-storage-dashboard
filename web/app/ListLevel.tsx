"use client";

import { useState } from "react";
import { categoryColor } from "@/lib/treemap";
import { formatBytes, categoryIcon, categoryLabel } from "@/lib/format";
import { isPathProtected, type MergedFlag } from "@/lib/cleanup-flags";
import type { Category, DisplayEntry, ProtectedPath } from "@/lib/scan-types";

const CATEGORY_OPTIONS: Category[] = [
  "documents",
  "applications",
  "developer",
  "photos",
  "system-data",
  "mail",
  "music",
  "other",
];

/**
 * One drill-down level rendered as a row list — used for every level
 * (Browse's real folders and the Clean up flagged list alike). Every row
 * is a real, individually-deletable path, so every row gets a checkbox,
 * flag badge, and Protect action — simplified 2026-09-01 alongside the
 * category-navigation removal (see .claude/plans/functional-enchanting-corbato.md):
 * there is no longer a top "categories" level with different rules.
 */
export function ListLevel({
  entries,
  flagsByPath,
  selected,
  protectedPaths,
  onToggleSelect,
  onDrillInto,
  onProtect,
  protectingPath,
  onSetCategory,
}: {
  entries: DisplayEntry[];
  flagsByPath: Map<string, MergedFlag>;
  selected: Set<string>;
  protectedPaths: ProtectedPath[];
  onToggleSelect: (path: string) => void;
  onDrillInto: (entry: DisplayEntry) => void;
  onProtect?: (path: string) => void;
  protectingPath?: string | null;
  /** Browse mode only — lets a real folder's category be fixed permanently
   * (data/category-overrides.json) instead of relying on the folder-name
   * heuristics, which fail badly on real disks (see lib/category-overrides.mjs). */
  onSetCategory?: (path: string, category: Category) => void;
}) {
  const sorted = [...entries].sort((a, b) => b.allocatedBytes - a.allocatedBytes);

  // T013: last-used date is deliberately NOT fetched for every visible
  // row — that's one `mdls` process spawn per file, too slow to run
  // eagerly for a folder with hundreds of entries (research.md's "Last
  // used data" decision). Fetched on demand, per file, only when its
  // "Details" toggle is clicked, cached here so re-toggling doesn't
  // re-fetch.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [lastUsedByPath, setLastUsedByPath] = useState<Map<string, string | null>>(new Map());
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  async function toggleDetails(path: string) {
    if (expandedPath === path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(path);
    if (lastUsedByPath.has(path)) return;
    setLoadingDetail(path);
    try {
      const res = await fetch(`/api/entry-detail?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setLastUsedByPath((prev) => new Map(prev).set(path, res.ok ? (data.lastUsedAt ?? null) : null));
    } finally {
      setLoadingDetail(null);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {sorted.map((entry) => {
          const flag = flagsByPath.get(entry.path);
          const isProtected = isPathProtected(entry.path, protectedPaths);
          const isSelectable = !isProtected;
          const canDrillIn = entry.kind === "directory";

          return (
            <div key={entry.path} className="flex items-start gap-3 px-5 py-3">
              {isSelectable && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(entry.path)}
                  onChange={() => onToggleSelect(entry.path)}
                />
              )}
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
                style={{ background: `color-mix(in oklch, ${categoryColor(entry.category)} 22%, var(--bg))` }}
                aria-hidden
              >
                {categoryIcon(entry.category)}
              </span>
              <div
                className={`min-w-0 flex-1 ${canDrillIn ? "cursor-pointer" : ""}`}
                onClick={() => canDrillIn && onDrillInto(entry)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[var(--text-primary)]">{entry.name}</span>
                  {isProtected && (
                    <span className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-secondary)]">
                      🔒 protected
                    </span>
                  )}
                  {flag && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        flag.confidence === "safe"
                          ? "bg-[color-mix(in_oklch,oklch(0.64_0.13_145)_25%,var(--bg))] text-[oklch(0.8_0.13_145)]"
                          : "bg-[color-mix(in_oklch,oklch(0.64_0.15_60)_25%,var(--bg))] text-[oklch(0.8_0.15_60)]"
                      }`}
                    >
                      {flag.confidence}
                    </span>
                  )}
                </div>
                {flag?.reasons.map((reasonLine) => (
                  <p key={reasonLine} className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    {reasonLine}
                  </p>
                ))}
                {expandedPath === entry.path && (
                  <div className="mt-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                    <div>Modified: {new Date(entry.modifiedAt).toLocaleString()}</div>
                    <div>
                      Last opened:{" "}
                      {loadingDetail === entry.path
                        ? "…"
                        : lastUsedByPath.get(entry.path)
                          ? new Date(lastUsedByPath.get(entry.path)!).toLocaleString()
                          : "not tracked by Spotlight"}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-[family-name:var(--font-data)] text-sm text-[var(--text-primary)]">
                  {formatBytes(entry.allocatedBytes)}
                </span>
                <button
                  onClick={() => toggleDetails(entry.path)}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
                >
                  {expandedPath === entry.path ? "Hide details" : "Details"}
                </button>
                {isSelectable && onSetCategory && (
                  <select
                    value={entry.category}
                    onChange={(e) => onSetCategory(entry.path, e.target.value as Category)}
                    className="rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-xs text-[var(--text-secondary)]"
                    title="Fix this folder's category — sticks on every future scan"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                )}
                {isSelectable && onProtect && (
                  <button
                    onClick={() => onProtect(entry.path)}
                    disabled={protectingPath === entry.path}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    Protect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
