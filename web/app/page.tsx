"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { formatBytes } from "@/lib/format";
import { mergeFlagsByPath, isPathProtected, type MergedFlag } from "@/lib/cleanup-flags";
import { TreemapLevel } from "./TreemapLevel";
import { ListLevel } from "./ListLevel";
import { AiEvalPanel, type AiEvalReport } from "./AiEvalPanel";
import type { Category, DisplayEntry, ProtectedPath, ScanSnapshot, StorageEntry } from "@/lib/scan-types";

type Status = "loading" | "idle" | "scanning" | "error";
type ViewMode = "treemap" | "list";
type Mode = "browse" | "cleanup";
type DeletePhase = "idle" | "confirming" | "deleting" | "done" | "error";

interface FolderCrumb {
  path: string;
  name: string;
}

const ROOT: FolderCrumb = { path: "__root__", name: "Home" };

/**
 * Simplified 2026-09-01, same day as the first unification, after Deepak
 * reviewed it and said plainly it wasn't understandable. Root cause: the
 * 9-category top level lied about being consistent — clicking a tile led
 * to three different kinds of screens (a real folder, a "this category is
 * scattered" fallback, or the flagged list) with no way to predict which.
 *
 * Fixed by removing the category-navigation layer entirely. Two plain
 * modes instead: Browse (real folders only, every click behaves
 * identically — drill into a real folder, always) and Clean up (the
 * flagged list, its own tab, not nested behind anything). Category is
 * now only ever a color hint on a real entry (via lib/treemap.ts's
 * categoryColor/cellColor), never something you click through. See
 * .claude/plans/functional-enchanting-corbato.md for the full rationale.
 *
 * `selected` (and its size/name in `selectedDetails`) persists across
 * navigation AND across the Browse/Clean up mode switch — a cart, not a
 * per-level selection.
 */
/**
 * useSearchParams() requires a <Suspense> boundary (Next 16 App Router —
 * see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
 * This is the real default export; DashboardApp below does the actual work.
 */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <DashboardApp />
    </Suspense>
  );
}

function DashboardApp() {
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [protectedPaths, setProtectedPaths] = useState<ProtectedPath[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [viewMode, setViewMode] = useState<ViewMode>("treemap");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [folderCache, setFolderCache] = useState<Map<string, StorageEntry[]>>(new Map());

  // Real browser Back/Forward integration — added 2026-09-02 after Deepak
  // pointed out the back gesture did nothing useful. A first attempt used
  // raw window.history.pushState/popstate directly and looked right in
  // isolation, but real testing caught it: Next.js's App Router manages
  // browser history itself, and fighting it that way caused an actual
  // page reload on Back (visible as a second "HMR connected" + the tab
  // title flashing "Loading http://localhost:3000/") instead of a clean
  // in-place state restore — jumping straight to Home instead of one
  // level up. Fixed the correct way: mode/breadcrumb are derived FROM the
  // URL's `s` query param via useSearchParams (which Next.js does keep in
  // sync with real Back/Forward), and every navigation action calls
  // router.push with an updated `s` param instead of touching history
  // directly. folderCache/selection stay in memory the whole time (this
  // is client-side navigation, never a real page reload), so going back
  // to an already-visited level shows instantly, no re-fetch.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { mode, breadcrumb } = useMemo<{ mode: Mode; breadcrumb: FolderCrumb[] }>(() => {
    const raw = searchParams.get("s");
    if (!raw) return { mode: "browse", breadcrumb: [ROOT] };
    try {
      const parsed = JSON.parse(raw) as { mode?: string; breadcrumb?: FolderCrumb[] };
      return {
        mode: parsed.mode === "cleanup" ? "cleanup" : "browse",
        breadcrumb: Array.isArray(parsed.breadcrumb) && parsed.breadcrumb.length ? parsed.breadcrumb : [ROOT],
      };
    } catch {
      return { mode: "browse", breadcrumb: [ROOT] };
    }
  }, [searchParams]);

  function navigate(newMode: Mode, newBreadcrumb: FolderCrumb[], opts: { replace?: boolean } = {}) {
    const encoded = encodeURIComponent(JSON.stringify({ mode: newMode, breadcrumb: newBreadcrumb }));
    const url = `${pathname}?s=${encoded}`;
    if (opts.replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDetails, setSelectedDetails] = useState<
    Map<string, { name: string; sizeBytes: number; modifiedAt: string; category: Category }>
  >(new Map());
  const [phase, setPhase] = useState<DeletePhase>("idle");
  const [deleteResult, setDeleteResult] = useState<{
    deleted: { path: string; sizeBytes: number }[];
    skipped: { path: string; reason: string }[];
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [protectingPath, setProtectingPath] = useState<string | null>(null);

  // User Story 4 (P4) — additive only, never load-bearing. Candidates are
  // whatever's currently selected in Browse mode and NOT already
  // deterministically flagged (FR-016: only for items the rules didn't
  // confidently flag). No separate whole-disk "ambiguous items" index —
  // reuses the existing selection cart as the candidate source, kept
  // deliberately simple for a P4 story per the constitution.
  const [aiSuggestions, setAiSuggestions] = useState<{ path: string; rationale: string }[] | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // The eval harness (lib/ai-eval.mjs) — what makes the AI feature
  // measurable instead of a black box. Fetched on demand, not on every
  // page load, since golden-set scoring costs one real model call.
  const [aiEvalReport, setAiEvalReport] = useState<AiEvalReport | null>(null);
  const [aiEvalLoading, setAiEvalLoading] = useState(false);
  const [aiEvalError, setAiEvalError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [scanRes, protectedRes] = await Promise.all([fetch("/api/scan"), fetch("/api/protected-paths")]);
      const scanData = await scanRes.json();
      const protectedData = await protectedRes.json();
      setScan(scanData.scan);
      setProtectedPaths(protectedData.protected ?? []);
      setStatus("idle");
    })();
  }, []);

  useEffect(() => {
    if (status !== "scanning") return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  async function runScan() {
    setStatus("scanning");
    setErrorMessage(null);
    setElapsedSec(0);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const meta = await res.json();
      if (!res.ok) throw new Error(meta.detail ?? meta.error ?? "scan failed");
      setScan(meta);
      // A fresh scan invalidates cached folder listings — read from the
      // previous scan's per-directory listing files, which may no longer
      // match reality (files moved/deleted since).
      setFolderCache(new Map());
      navigate("browse", [ROOT], { replace: true });
      setStatus("idle");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const restrictedNames = scan ? [...new Set((scan.restrictedPaths ?? []).map((p) => p.name))].sort() : [];
  const RESTRICTED_SAMPLE_SIZE = 6;
  const restrictedSample = restrictedNames.slice(0, RESTRICTED_SAMPLE_SIZE);
  const restrictedOverflow = restrictedNames.length - restrictedSample.length;

  const flagsByPath: Map<string, MergedFlag> = useMemo(
    () => mergeFlagsByPath(scan?.cleanupFlags ?? []),
    [scan],
  );

  // Real, whole-disk gap between diskUsedBytes and what the current
  // folder listing accounts for isn't tracked per-folder — this is just
  // the top-level note: macOS itself + root-level system folders this
  // tool deliberately doesn't scan. A plain text line, not a fake tile.
  const notScannedBytes = useMemo(() => {
    if (!scan) return 0;
    const rootEntries = folderCache.get(ROOT.path);
    if (!rootEntries) return 0;
    const rootTotal = rootEntries.reduce((sum, e) => sum + e.allocatedBytes, 0);
    return Math.max(0, scan.diskUsedBytes - rootTotal);
  }, [scan, folderCache]);

  // Reclaimable isn't folder-shaped — its natural view is the flagged
  // list, adapted into DisplayEntry shape (kind: "file" so it's never
  // treated as drillable) so it can reuse ListLevel's row rendering.
  // name is the full real path since there's no containing-folder
  // breadcrumb context here to shorten it.
  const reclaimableEntries: DisplayEntry[] = useMemo(() => {
    if (!scan) return [];
    return [...flagsByPath.values()].map((f) => ({
      path: f.path,
      name: f.path,
      kind: "file",
      sizeBytes: f.sizeBytes,
      allocatedBytes: f.sizeBytes,
      category: "reclaimable",
      modifiedAt: scan.scannedAt,
      lastUsedAt: null,
      flags: [],
    }));
  }, [scan, flagsByPath]);

  const currentPath = breadcrumb[breadcrumb.length - 1].path;
  const browseEntries: DisplayEntry[] | null = folderCache.get(currentPath) ?? null;
  const currentEntries = mode === "cleanup" ? reclaimableEntries : browseEntries;

  // Fetches to populate the folder cache when the current Browse path
  // isn't cached yet — currentEntries above stays a pure derivation.
  useEffect(() => {
    if (mode !== "browse" || folderCache.has(currentPath)) return;
    (async () => {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(currentPath)}`);
      const data = await res.json();
      setFolderCache((prev) => new Map(prev).set(currentPath, data.entries ?? []));
    })();
  }, [mode, currentPath, folderCache]);

  function drillInto(entry: DisplayEntry) {
    if (entry.kind === "directory") {
      navigate(mode, [...breadcrumb, { path: entry.path, name: entry.name }]);
    }
  }

  // The treemap's "+N more items" cell used to be a dead end — no way to
  // see what it actually folded together. Since the real folded entries
  // are already known client-side (lib/treemap.ts exposes them, no fetch
  // needed), seed the folder cache directly with a synthetic key scoped
  // to the current real path (so drilling into a group at two different
  // real folders never collides) and push a normal breadcrumb entry —
  // everything else (real folders inside it, selection, flags) works
  // exactly like any other level from here.
  function drillIntoGroup(groupedEntries: DisplayEntry[], label: string) {
    const syntheticPath = `${currentPath}::grouped`;
    setFolderCache((prev) => new Map(prev).set(syntheticPath, groupedEntries));
    navigate(mode, [...breadcrumb, { path: syntheticPath, name: label }]);
  }

  function toggleSelect(
    path: string,
    name: string,
    sizeBytes: number,
    modifiedAt: string = "",
    category: Category = "other",
  ) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setSelectedDetails((prev) => {
      const next = new Map(prev);
      if (next.has(path)) next.delete(path);
      else next.set(path, { name, sizeBytes, modifiedAt, category });
      return next;
    });
  }

  function handleToggleFromLevel(path: string) {
    const entry = currentEntries?.find((e) => e.path === path);
    if (entry) toggleSelect(entry.path, entry.name, entry.allocatedBytes, entry.modifiedAt, entry.category);
  }

  /**
   * Bulk selection deliberately skips `review` items (added 2026-09-03).
   *
   * A review item is one the tool could NOT prove is regenerable — it is
   * shown so it stops being invisible, not because it should go. Letting
   * "Select all" sweep those in would recreate the exact failure the
   * three-disposition model exists to prevent: a single confident click
   * standing in for a judgement only the user can make. Review items stay
   * individually selectable; they are just never selected FOR you.
   */
  function selectAllVisible() {
    if (!currentEntries) return;
    for (const entry of currentEntries) {
      if (isPathProtected(entry.path, protectedPaths)) continue;
      if (flagsByPath.get(entry.path)?.disposition === "review") continue;
      if (!selected.has(entry.path))
        toggleSelect(entry.path, entry.name, entry.allocatedBytes, entry.modifiedAt, entry.category);
    }
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectedDetails(new Map());
  }

  // Persists to data/category-overrides.json (checked before the
  // folder-name heuristics on the next scan — see scanner/categorize.mjs)
  // and updates the currently-cached listing optimistically so the color
  // change is visible immediately, not just after a rescan.
  async function setCategory(path: string, category: Category) {
    await fetch("/api/category-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, category }),
    });
    setFolderCache((prev) => {
      const entries = prev.get(currentPath);
      if (!entries) return prev;
      const next = new Map(prev);
      next.set(
        currentPath,
        entries.map((e) => (e.path === path ? { ...e, category } : e)),
      );
      return next;
    });
  }

  async function getAiSuggestions() {
    const candidates = [...selected]
      .filter((p) => !flagsByPath.has(p))
      .map((p) => {
        const d = selectedDetails.get(p);
        return d && { path: p, name: d.name, allocatedBytes: d.sizeBytes, modifiedAt: d.modifiedAt, category: d.category };
      })
      .filter((c): c is NonNullable<typeof c> => !!c);
    if (candidates.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuggestions(null);
    setAiUnavailable(false);
    try {
      const res = await fetch("/api/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI suggestion request failed");
      if (data.unavailable) setAiUnavailable(true);
      else setAiSuggestions(data.suggestions ?? []);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  async function getAiEval() {
    setAiEvalLoading(true);
    setAiEvalError(null);
    try {
      const res = await fetch("/api/ai-eval");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI eval request failed");
      setAiEvalReport(data as AiEvalReport);
    } catch (err) {
      setAiEvalError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiEvalLoading(false);
    }
  }

  async function protectPath(path: string) {
    setProtectingPath(path);
    try {
      await fetch("/api/protected-paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (selected.has(path)) toggleSelect(path, "", 0);
      const res = await fetch("/api/protected-paths");
      const data = await res.json();
      setProtectedPaths(data.protected ?? []);
    } finally {
      setProtectingPath(null);
    }
  }

  const selectedTotal = [...selectedDetails.values()].reduce((sum, d) => sum + d.sizeBytes, 0);

  async function confirmDelete() {
    setPhase("deleting");
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "delete failed");
      const deleted: { path: string; sizeBytes: number }[] = data.deleted ?? [];
      setDeleteResult({ deleted, skipped: data.skipped ?? [] });

      // Real deletions already happened on disk — redraw from that
      // response instead of waiting for a fresh multi-minute rescan.
      // Read categories from selectedDetails BEFORE clearSelection()
      // wipes it (it's the only place a deleted path's category is
      // still known client-side; /api/delete's response doesn't carry
      // one).
      const deletedPaths = new Set(deleted.map((d) => d.path));
      const categoryByPath = new Map(
        deleted.map((d) => [d.path, selectedDetails.get(d.path)?.category]),
      );
      const freed = deleted.reduce((sum, d) => sum + d.sizeBytes, 0);

      if (deletedPaths.size > 0) {
        setFolderCache((prev) => {
          const next = new Map<string, StorageEntry[]>();
          for (const [key, entries] of prev) next.set(key, entries.filter((e) => !deletedPaths.has(e.path)));
          return next;
        });

        setScan((prev) => {
          if (!prev) return prev;
          const categoryTotals = { ...prev.categoryTotals };
          for (const d of deleted) {
            const cat = categoryByPath.get(d.path);
            if (cat) categoryTotals[cat] = Math.max(0, categoryTotals[cat] - d.sizeBytes);
          }
          return {
            ...prev,
            diskUsedBytes: Math.max(0, prev.diskUsedBytes - freed),
            diskFreeBytes: prev.diskFreeBytes + freed,
            categoryTotals,
            cleanupFlags: prev.cleanupFlags.filter((f) => !deletedPaths.has(f.path)),
          };
        });
      }

      clearSelection();
      setPhase("done");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const freedBytes = deleteResult?.deleted.reduce((sum, d) => sum + d.sizeBytes, 0) ?? 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-baseline gap-3">
          <div className="font-[family-name:var(--font-data)] text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {scan ? formatBytes(scan.diskUsedBytes) : "—"}
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-[var(--text-secondary)]">
              {scan ? `of ${formatBytes(scan.diskTotalBytes)} used — rest is free` : "No scan yet"}
            </span>
            {scan && (
              <span className="text-xs text-[var(--text-secondary)]">
                Scanned {new Date(scan.scannedAt).toLocaleString()}
                {notScannedBytes > 0 && ` · ${formatBytes(notScannedBytes)} not scanned (macOS + system folders)`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-[var(--border)] p-0.5 text-sm">
            {(["browse", "cleanup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => navigate(m, breadcrumb)}
                className={`rounded px-3 py-1 capitalize transition-colors ${
                  mode === m
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {m === "browse" ? "Browse" : "Clean up"}
              </button>
            ))}
          </div>
          {mode === "browse" && (
            <div className="flex rounded-md border border-[var(--border)] p-0.5 text-sm">
              {(["treemap", "list"] as const).map((vmode) => (
                <button
                  key={vmode}
                  onClick={() => setViewMode(vmode)}
                  className={`rounded px-3 py-1 capitalize transition-colors ${
                    viewMode === vmode
                      ? "bg-[var(--border)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {vmode}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={runScan}
            disabled={status === "scanning"}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-60"
          >
            {status === "scanning" ? `Scanning… ${elapsedSec}s` : "Refresh"}
          </button>
        </div>
      </header>

      {mode === "browse" && (
        <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-2 text-sm">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--text-secondary)]">/</span>}
              <button
                onClick={() => navigate(mode, breadcrumb.slice(0, i + 1))}
                className={
                  i === breadcrumb.length - 1
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm text-red-400">
          Scan failed: {errorMessage}
        </div>
      )}

      {restrictedNames.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm text-[var(--text-secondary)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[var(--text-primary)]">
              {restrictedNames.length} folder{restrictedNames.length === 1 ? "" : "s"} couldn&apos;t be read
              {restrictedSample.length > 0 && (
                <>
                  {" "}
                  ({restrictedSample.join(", ")}
                  {restrictedOverflow > 0 ? `, +${restrictedOverflow} more` : ""})
                </>
              )}
            </span>
            <a
              href="x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
              className="font-medium text-[var(--accent)] transition-colors hover:underline"
            >
              Open Full Disk Access settings →
            </a>
          </div>
          <p>
            {scan?.scannerHostApp ? (
              <>
                In the list that opens, click <strong className="text-[var(--text-primary)]">+</strong>, add{" "}
                <strong className="text-[var(--text-primary)]">{scan.scannerHostApp}</strong> from Applications,
                turn it on, then fully quit and reopen {scan.scannerHostApp} before running another scan.
              </>
            ) : (
              <>
                In the list that opens, click <strong className="text-[var(--text-primary)]">+</strong> and add
                whichever app you used to start this dev server (Terminal, VS Code, etc.), turn it on, then
                fully quit and reopen that app before running another scan.
              </>
            )}
          </p>
        </div>
      )}

      <main className="relative flex-1 overflow-hidden">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            Loading…
          </div>
        )}

        {status !== "loading" && !scan && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-lg text-[var(--text-primary)]">No scan yet</p>
            <p className="max-w-xs text-sm text-[var(--text-secondary)]">
              Run your first scan to see where your space is going.
            </p>
          </div>
        )}

        {status === "idle" && scan && currentEntries === null && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            Loading…
          </div>
        )}

        {status === "idle" && scan && currentEntries !== null && currentEntries.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              {mode === "cleanup" ? "Nothing flagged as reclaimable in the latest scan." : "Nothing here."}
            </p>
          </div>
        )}

        {status === "idle" && scan && currentEntries !== null && currentEntries.length > 0 && (
          <div className="absolute inset-0">
            {mode === "cleanup" ? (
              <ListLevel
                entries={currentEntries}
                flagsByPath={flagsByPath}
                selected={selected}
                protectedPaths={protectedPaths}
                onToggleSelect={handleToggleFromLevel}
                onDrillInto={() => {}}
                onProtect={protectPath}
                protectingPath={protectingPath}
              />
            ) : viewMode === "treemap" ? (
              <TreemapLevel
                entries={currentEntries}
                flagsByPath={flagsByPath}
                selected={selected}
                protectedPaths={protectedPaths}
                onToggleSelect={handleToggleFromLevel}
                onDrillInto={drillInto}
                onDrillIntoGroup={drillIntoGroup}
              />
            ) : (
              <ListLevel
                entries={currentEntries}
                flagsByPath={flagsByPath}
                selected={selected}
                protectedPaths={protectedPaths}
                onToggleSelect={handleToggleFromLevel}
                onDrillInto={drillInto}
                onProtect={protectPath}
                protectingPath={protectingPath}
                onSetCategory={setCategory}
              />
            )}
          </div>
        )}
      </main>

      {currentEntries !== null && currentEntries.length > 0 && (
        <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-6 py-2 text-sm">
          <button onClick={selectAllVisible} className="text-[var(--accent)] hover:underline">
            Select all visible
          </button>
          {selected.size > 0 && (
            <button onClick={clearSelection} className="text-[var(--text-secondary)] hover:underline">
              Clear selection
            </button>
          )}
          {mode === "browse" && (
            <button
              onClick={getAiSuggestions}
              disabled={aiLoading || ![...selected].some((p) => !flagsByPath.has(p))}
              title={
                [...selected].some((p) => !flagsByPath.has(p))
                  ? "Get a second opinion from AI on the items you've selected"
                  : "Select something first — AI only weighs in on items you've picked that the rules didn't already flag"
              }
              className="text-[var(--accent)] hover:underline disabled:cursor-default disabled:text-[var(--text-secondary)] disabled:no-underline disabled:opacity-50"
            >
              {aiLoading ? "Asking AI…" : "🤖 Ask AI about selected"}
            </button>
          )}
          {mode === "browse" && (
            <button
              onClick={getAiEval}
              disabled={aiEvalLoading}
              title="How good the AI suggestions actually are — real acceptance rate plus agreement with the rule engine"
              className="text-[var(--accent)] hover:underline disabled:cursor-default disabled:opacity-50"
            >
              {aiEvalLoading ? "Scoring…" : "📊 Eval"}
            </button>
          )}
        </div>
      )}

      {aiEvalError && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm">
          <p className="mx-auto max-w-[1600px] text-xs text-red-400">AI eval request failed: {aiEvalError}</p>
        </div>
      )}
      {aiEvalReport && <AiEvalPanel report={aiEvalReport} onClose={() => setAiEvalReport(null)} />}

      {(aiSuggestions || aiUnavailable || aiError) && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm">
          <div className="mx-auto max-w-[1600px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--accent)]">
                AI Suggestions — worth a look, not a recommendation to delete
              </span>
              <button
                onClick={() => {
                  setAiSuggestions(null);
                  setAiUnavailable(false);
                  setAiError(null);
                }}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Dismiss
              </button>
            </div>
            {aiUnavailable && (
              <p className="text-xs text-[var(--text-secondary)]">
                AI suggestions aren&apos;t available (no Anthropic API key configured) — everything else here still
                works normally.
              </p>
            )}
            {aiError && <p className="text-xs text-red-400">AI suggestion request failed: {aiError}</p>}
            {aiSuggestions?.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)]">No suggestions for the selected items.</p>
            )}
            {aiSuggestions && aiSuggestions.length > 0 && (
              <ul className="space-y-2">
                {aiSuggestions.map((s) => (
                  <li key={s.path} className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                    <div className="truncate font-[family-name:var(--font-data)] text-xs text-[var(--text-primary)]">
                      {s.path}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{s.rationale}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {selected.size > 0 && phase === "idle" && (
        <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--surface)] px-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              {selected.size} item{selected.size === 1 ? "" : "s"} selected · {formatBytes(selectedTotal)}
            </span>
            <button
              onClick={() => setPhase("confirming")}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
            >
              Delete selected…
            </button>
          </div>
        </div>
      )}

      {phase === "confirming" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Move {selected.size} item{selected.size === 1 ? "" : "s"} to Trash?
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Total:{" "}
              <span className="font-[family-name:var(--font-data)] text-[var(--text-primary)]">
                {formatBytes(selectedTotal)}
              </span>
              . Moved to Trash, not permanently deleted — recoverable until you empty it yourself.
            </p>
            <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-[family-name:var(--font-data)] text-xs text-[var(--text-secondary)]">
              {[...selectedDetails.entries()].map(([path, d]) => (
                <li key={path} className="flex justify-between gap-3">
                  <span className="truncate">{path}</span>
                  <span className="shrink-0">{formatBytes(d.sizeBytes)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPhase("idle")}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-90"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "deleting" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60">
          <p className="text-sm text-[var(--text-secondary)]">Moving to Trash…</p>
        </div>
      )}

      {phase === "error" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-red-400">Delete failed: {deleteError}</p>
            <button
              onClick={() => setPhase("idle")}
              className="mt-4 rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === "done" && deleteResult && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Freed {formatBytes(freedBytes)}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {deleteResult.deleted.length} item{deleteResult.deleted.length === 1 ? "" : "s"} moved to Trash.
              {deleteResult.skipped.length > 0 && ` ${deleteResult.skipped.length} skipped.`}
            </p>
            {deleteResult.skipped.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
                {deleteResult.skipped.map((s) => (
                  <li key={s.path}>
                    {s.path} — {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-[var(--text-secondary)]">
              Totals above and any list you&apos;re viewing already reflect this. Run a fresh scan only if you want
              deeper folders that contained these items (their own sizes, shown while browsing) to catch up too.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  setPhase("idle");
                  setDeleteResult(null);
                }}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
