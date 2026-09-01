"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { layoutTreemap, type TreemapRect } from "@/lib/treemap";
import { formatBytes, categoryLabel } from "@/lib/format";
import type { Category, ScanSnapshot } from "@/lib/scan-types";

type Status = "loading" | "idle" | "scanning" | "error";

/**
 * The real landing view — per spec.md FR-002, the top level is the
 * categorized breakdown (the same 9 buckets macOS Storage settings
 * shows), not a raw folder listing. Rewritten 2026-09-01: the first
 * version of this page rendered $HOME's individual top-level folders
 * instead, which was a real scope mismatch (Deepak caught it) — that
 * flat folder view now lives at /browse.
 *
 * Category tiles are deliberately NOT clickable yet — Documents-tagged
 * files, for example, are scattered across many real folders on disk;
 * showing "everything in category X" disk-wide is a real, separate
 * capability the scanner doesn't currently build (it would need its own
 * index), not something to bolt on silently here.
 */
export default function Home() {
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<Record<string, number> | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/scan");
      const data = await res.json();
      if (data.scan) {
        setScan(data.scan);
        setCategoryTotals(data.scan.categoryTotals);
      }
      setStatus("idle");
    })();
  }, []);

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
      setCategoryTotals(meta.categoryTotals);
      setStatus("idle");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const NOT_SCANNED_PATH = "not-scanned";

  // Real categoryTotals (from the scanner, see data-model.md) turned into
  // the same StorageEntry-like shape layoutTreemap already knows how to
  // lay out — no separate rendering path needed for 9 items.
  //
  // Added 2026-09-01, per Deepak's request: a real "not scanned" segment
  // — the gap between the real, whole-disk diskUsedBytes (fs.statfsSync)
  // and what our own categories add up to. This is genuinely real data
  // (a subtraction of two real numbers, not fabricated) and includes
  // macOS itself plus root-level system folders we deliberately don't
  // scan. Rendered as view-only — never selectable, never deletable —
  // both because it's not a real scanned entry with a real path we could
  // safely act on, and because this is exactly the kind of system space
  // that should never be touched by a cleanup tool.
  const categoryEntries =
    categoryTotals
      ? Object.entries(categoryTotals)
          .filter(([, bytes]) => bytes > 0)
          .map(([category, bytes]) => ({
            path: `category:${category}`,
            name: categoryLabel(category),
            kind: "directory" as const,
            sizeBytes: bytes,
            allocatedBytes: bytes,
            category: category as Category,
            modifiedAt: scan?.scannedAt ?? new Date(0).toISOString(),
            lastUsedAt: null,
            flags: [],
          }))
      : [];

  const scannedTotal = categoryEntries.reduce((sum, e) => sum + e.allocatedBytes, 0);
  const notScannedBytes = scan ? Math.max(0, scan.diskUsedBytes - scannedTotal) : 0;
  if (scan && notScannedBytes > 0) {
    categoryEntries.push({
      path: NOT_SCANNED_PATH,
      name: "Not Scanned (System)",
      kind: "directory" as const,
      sizeBytes: notScannedBytes,
      allocatedBytes: notScannedBytes,
      category: "system-data" as Category,
      modifiedAt: scan.scannedAt,
      lastUsedAt: null,
      flags: [],
    });
  }

  const rects: TreemapRect[] =
    categoryEntries.length > 0 && size.width > 0 && size.height > 0
      ? layoutTreemap(categoryEntries, size.width, size.height)
      : [];

  const hovered = rects.find((r) => r.path === hoveredPath) ?? null;

  // Tooltip position, clamped so it never renders off the right/bottom
  // edge of the treemap area. Added 2026-09-01: the footer-only hover
  // feedback made the eye travel away from the hovered cell — this
  // shows up right where you're already looking.
  const tooltipWidth = 200;
  const tooltipHeight = 52;
  const tooltipX = Math.min(cursor.x + 16, Math.max(0, size.width - tooltipWidth - 8));
  const tooltipY = Math.min(cursor.y + 16, Math.max(0, size.height - tooltipHeight - 8));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-baseline gap-3">
          <div className="font-[family-name:var(--font-data)] text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {scan ? formatBytes(scan.diskUsedBytes) : "—"}
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              {scan ? `of ${formatBytes(scan.diskTotalBytes)} used — rest is free` : "No scan yet"}
            </span>
            {scan && (
              <span className="text-xs text-[var(--text-secondary)]">
                Scanned {new Date(scan.scannedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/browse"
            className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
          >
            Browse by folder →
          </Link>
          <button
            onClick={runScan}
            disabled={status === "scanning"}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-60"
          >
            {status === "scanning" ? `Scanning… ${elapsedSec}s` : "Refresh"}
          </button>
        </div>
      </header>

      {status === "error" && (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm text-red-400">
          Scan failed: {errorMessage}
        </div>
      )}

      <main
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onMouseLeave={() => setHoveredPath(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
      >
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

        {rects.map((r) => {
          const isHovered = r.path === hoveredPath;
          const isDimmed = hoveredPath !== null && !isHovered;
          const isViewOnly = r.path === NOT_SCANNED_PATH;
          return (
            <div
              key={r.path}
              onMouseEnter={() => setHoveredPath(r.path)}
              className="absolute box-border flex cursor-default flex-col justify-end overflow-hidden p-2 transition-all duration-150"
              style={{
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
                background: isViewOnly
                  ? `repeating-linear-gradient(135deg, ${r.color}, ${r.color} 8px, var(--bg) 8px, var(--bg) 9px)`
                  : r.color,
                opacity: isDimmed ? 0.55 : 1,
                boxShadow: isHovered ? "inset 0 0 0 2px var(--text-primary)" : undefined,
                zIndex: isHovered ? 1 : 0,
              }}
            >
              {r.width > 60 && r.height > 30 && (
                <>
                  <div className="flex items-center gap-1 truncate text-sm font-semibold uppercase tracking-wide text-[var(--bg)]">
                    {isViewOnly && <span aria-hidden>🔒</span>}
                    {isViewOnly ? "System (not scanned)" : r.name}
                  </div>
                  <div className="font-[family-name:var(--font-data)] text-xs text-[var(--bg)] opacity-80">
                    {formatBytes(r.allocatedBytes)}
                    {isViewOnly && " · view only"}
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
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {hovered.path === NOT_SCANNED_PATH ? "System (not scanned)" : hovered.name}
            </div>
            <div className="font-[family-name:var(--font-data)] text-xs text-[var(--text-secondary)]">
              {formatBytes(hovered.allocatedBytes)}
              {hovered.path === NOT_SCANNED_PATH && " · view only"}
            </div>
          </div>
        )}
      </main>

      <footer className="flex h-10 items-center border-t border-[var(--border)] bg-[var(--surface)] px-6 font-[family-name:var(--font-data)] text-xs">
        {hovered ? (
          hovered.path === NOT_SCANNED_PATH ? (
            <div className="flex w-full items-center gap-3 text-[var(--text-primary)]">
              <span className="truncate font-medium">🔒 System (not scanned)</span>
              <span className="text-[var(--text-secondary)]">{formatBytes(hovered.allocatedBytes)}</span>
              <span className="ml-auto truncate text-[var(--text-secondary)]">
                Includes macOS itself and system-internal folders this tool deliberately doesn&apos;t scan — never selectable, never deletable.
              </span>
            </div>
          ) : (
            <div className="flex w-full items-center gap-3 text-[var(--text-primary)]">
              <span className="truncate font-medium">{hovered.name}</span>
              <span className="text-[var(--text-secondary)]">{formatBytes(hovered.allocatedBytes)}</span>
            </div>
          )
        ) : (
          <span className="text-[var(--text-secondary)]">
            {rects.length > 0 ? "hover any category for its total — click \"Browse by folder\" to see real files" : ""}
          </span>
        )}
      </footer>
    </div>
  );
}
