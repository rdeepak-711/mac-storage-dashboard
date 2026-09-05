"use client";

import { useState } from "react";
import { categoryColor } from "@/lib/treemap";
import { formatBytes, categoryIcon, categoryLabel } from "@/lib/format";
import { isPathProtected, type MergedFlag } from "@/lib/cleanup-flags";
import { FlagBadge } from "./FlagBadge";
import { getFolderDescription } from "@/lib/folder-descriptions";
import type { Category, DisplayEntry, ProtectedPath } from "@/lib/scan-types";

const CATEGORY_OPTIONS: Category[] = ["documents", "downloads", "desktop", "applications", "developer", "other"];

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
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {sorted.map((entry) => {
          const flag = flagsByPath.get(entry.path);
          const isProtected = isPathProtected(entry.path, protectedPaths);
          const isSelectable = !isProtected;
          const canDrillIn = entry.kind === "directory";

          return (
            <div key={entry.path} className="flex items-center gap-3 px-4 py-2">
              {isSelectable && (
                <input
                  type="checkbox"
                  checked={selected.has(entry.path)}
                  onChange={() => onToggleSelect(entry.path)}
                />
              )}
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm"
                style={{ background: `color-mix(in oklch, ${categoryColor(entry.category)} 22%, var(--bg))` }}
                aria-hidden
              >
                {categoryIcon(entry.category)}
              </span>
              <div
                className={`min-w-0 flex-1 ${canDrillIn ? "cursor-pointer" : ""}`}
                onClick={() => canDrillIn && onDrillInto(entry)}
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-sm text-[var(--text-primary)]">{entry.name}</span>
                  {getFolderDescription(entry.name) && (
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                      — {getFolderDescription(entry.name)}
                    </span>
                  )}
                  {isProtected && (
                    <span className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-secondary)]">
                      🔒 protected
                    </span>
                  )}
                  {flag && (
                    <FlagBadge
                      disposition={flag.disposition}
                      recoverability={flag.recoverability}
                      activity={flag.activity}
                      lastTouchedAt={flag.lastTouchedAt}
                    />
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
              <span className="w-20 shrink-0 text-right font-[family-name:var(--font-data)] text-sm text-[var(--text-primary)]">
                {formatBytes(entry.allocatedBytes)}
              </span>
              <button
                onClick={() => toggleDetails(entry.path)}
                className="w-24 shrink-0 text-right text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                {expandedPath === entry.path ? "Hide details" : "Details"}
              </button>
              {isSelectable && onSetCategory ? (
                <span className="flex w-32 shrink-0 items-center gap-1">
                  <span aria-hidden title="Wrong color? Pick the real category — fixes this folder's color, sticks on every future scan">
                    🎨
                  </span>
                  <select
                    value={entry.category}
                    onChange={(e) => onSetCategory(entry.path, e.target.value as Category)}
                    className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-xs text-[var(--text-secondary)]"
                    title="Wrong color? Pick the real category — fixes this folder's color, sticks on every future scan"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                onSetCategory && <span className="w-32 shrink-0" />
              )}
              {isSelectable && onProtect ? (
                <button
                  onClick={() => onProtect(entry.path)}
                  disabled={protectingPath === entry.path}
                  className="w-16 shrink-0 text-right text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  Protect
                </button>
              ) : (
                onProtect && <span className="w-16 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
