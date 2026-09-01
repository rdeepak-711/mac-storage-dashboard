"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { layoutTreemap, type TreemapRect } from "@/lib/treemap";
import type { Category, ScanSnapshot } from "@/lib/scan-types";

function formatGB(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function categoryLabel(category: string) {
  return category.replace("-", " ");
}

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

  // Real categoryTotals (from the scanner, see data-model.md) turned into
  // the same StorageEntry-like shape layoutTreemap already knows how to
  // lay out — no separate rendering path needed for 9 items.
  const rects: TreemapRect[] =
    categoryTotals && size.width > 0 && size.height > 0
      ? layoutTreemap(
          Object.entries(categoryTotals)
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
            })),
          size.width,
          size.height,
        )
      : [];

  const hovered = rects.find((r) => r.path === hoveredPath) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-baseline gap-3">
          <div className="font-[family-name:var(--font-data)] text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {scan ? formatGB(scan.diskUsedBytes) : "—"}
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              {scan ? `of ${formatGB(scan.diskTotalBytes)} used — rest is free` : "No scan yet"}
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
                background: r.color,
                opacity: isDimmed ? 0.55 : 1,
                boxShadow: isHovered ? "inset 0 0 0 2px var(--text-primary)" : undefined,
                zIndex: isHovered ? 1 : 0,
              }}
            >
              {r.width > 60 && r.height > 30 && (
                <>
                  <div className="truncate text-sm font-semibold uppercase tracking-wide text-[var(--bg)]">
                    {r.name}
                  </div>
                  <div className="font-[family-name:var(--font-data)] text-xs text-[var(--bg)] opacity-80">
                    {formatGB(r.allocatedBytes)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </main>

      <footer className="flex h-10 items-center border-t border-[var(--border)] bg-[var(--surface)] px-6 font-[family-name:var(--font-data)] text-xs">
        {hovered ? (
          <div className="flex w-full items-center gap-3 text-[var(--text-primary)]">
            <span className="truncate font-medium">{hovered.name}</span>
            <span className="text-[var(--text-secondary)]">{formatGB(hovered.allocatedBytes)}</span>
          </div>
        ) : (
          <span className="text-[var(--text-secondary)]">
            {rects.length > 0 ? "hover any category for its total — click \"Browse by folder\" to see real files" : ""}
          </span>
        )}
      </footer>
    </div>
  );
}
