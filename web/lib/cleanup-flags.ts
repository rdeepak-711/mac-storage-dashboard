import { ruleLabel } from "./format";
import type { CleanupFlag, ProtectedPath } from "./scan-types";

/**
 * Shared by the unified drill-down page (app/page.tsx) so any entry, at
 * any depth, can show its cleanup badge — not just the flat reclaimable
 * list. A single real path can legitimately match more than one rule
 * (e.g. both stale-large-file and duplicate-file) — reclaim-rules.mjs
 * correctly reports both as independent findings, but selection/deletion
 * is keyed by path, so this merges same-path flags into one record with
 * every reason, keeping the worst confidence. Extracted 2026-09-01 from
 * the old app/cleanup/page.tsx so the merge logic has one home instead
 * of being duplicated per view.
 */
export interface MergedFlag extends CleanupFlag {
  reasons: string[];
}

export function mergeFlagsByPath(flags: CleanupFlag[]): Map<string, MergedFlag> {
  const byPath = new Map<string, MergedFlag>();
  for (const flag of flags) {
    const existing = byPath.get(flag.path);
    const reasonLine = `${ruleLabel(flag.ruleId)} — ${flag.reason}`;
    if (existing) {
      existing.reasons.push(reasonLine);
      if (flag.confidence === "caution") existing.confidence = "caution";
    } else {
      byPath.set(flag.path, { ...flag, reasons: [reasonLine] });
    }
  }
  return byPath;
}

/**
 * Mirrors lib/protected-paths.mjs's isProtected() boundary logic
 * (exact match OR nested under a protected folder) — client-side only,
 * for disabling selection in the UI; scanner/delete.mjs re-checks this
 * for real before anything actually moves.
 */
export function isPathProtected(path: string, protectedPaths: ProtectedPath[]): boolean {
  return protectedPaths.some((p) => path === p.path || path.startsWith(p.path + "/"));
}
