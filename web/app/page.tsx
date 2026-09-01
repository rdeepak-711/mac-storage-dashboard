"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { layoutTreemap, type TreemapRect } from "@/lib/treemap";
import type { ScanSnapshot, StorageEntry } from "@/lib/scan-types";

function formatGB(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function categoryLabel(category: string) {
  return category.replace("-", " ");
}

type Status = "loading" | "idle" | "scanning" | "error";

export default function Home() {
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [entries, setEntries] = useState<StorageEntry[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadEntriesFor = useCallback(async (rootPath: string) => {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(rootPath)}`);
    const data = await res.json();
    setEntries(data.entries ?? null);
  }, []);

  // On mount: show whatever the last scan already found — never force a
  // fresh multi-minute scan just from opening the page (GET /api/scan,
  // not POST). Refresh is the explicit, deliberate action for that.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/scan");
      const data = await res.json();
      if (data.scan) {
        setScan(data.scan);
        await loadEntriesFor(data.scan.root.path);
      }
      setStatus("idle");
    })();
  }, [loadEntriesFor]);

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

  // Real progress feedback while a scan runs, per design-brief.md — a
  // scan takes real minutes, a spinner with no information would be
  // exactly the kind of empty loading state the brief rules out.
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
      await loadEntriesFor(meta.root.path);
      setStatus("idle");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const rects: TreemapRect[] =
    entries && size.width > 0 && size.height > 0
      ? layoutTreemap(entries, size.width, size.height)
      : [];

  const hovered = rects.find((r) => r.path === hoveredPath) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-baseline gap-3">
          <div className="font-[family-name:var(--font-data)] text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {scan ? formatGB(scan.root.allocatedBytes) : "—"}
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              {scan ? "used" : "No scan yet"}
            </span>
            {scan && (
              <span className="text-xs text-[var(--text-secondary)]">
                Scanned {new Date(scan.scannedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={runScan}
          disabled={status === "scanning"}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-60"
        >
          {status === "scanning" ? `Scanning… ${elapsedSec}s` : "Refresh"}
        </button>
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
          const isGrouped = r.groupedCount !== undefined;
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
                outline: isGrouped ? "2px dashed var(--bg)" : undefined,
                outlineOffset: isGrouped ? -4 : undefined,
                boxShadow: isHovered ? "inset 0 0 0 2px var(--text-primary)" : undefined,
                zIndex: isHovered ? 1 : 0,
              }}
            >
              {r.width > 60 && r.height > 30 && (
                <>
                  <div className="truncate text-xs font-semibold text-[var(--bg)]">
                    {isGrouped ? `+ ${r.name}` : r.name}
                  </div>
                  <div className="font-[family-name:var(--font-data)] text-[11px] text-[var(--bg)] opacity-80">
                    {formatGB(r.allocatedBytes)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </main>

      {/* Status strip — deliberate hover feedback (design-brief.md: direct
          manipulation, not a cross-referenced legend or native tooltip). */}
      <footer className="flex h-10 items-center border-t border-[var(--border)] bg-[var(--surface)] px-6 font-[family-name:var(--font-data)] text-xs">
        {hovered ? (
          <div className="flex w-full items-center gap-3 text-[var(--text-primary)]">
            <span className="truncate font-medium">{hovered.name}</span>
            <span className="rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              {hovered.groupedCount !== undefined ? "mixed, mostly " + categoryLabel(hovered.category) : categoryLabel(hovered.category)}
            </span>
            <span className="text-[var(--text-secondary)]">{formatGB(hovered.allocatedBytes)}</span>
            <span className="ml-auto truncate text-[var(--text-secondary)]">
              {hovered.groupedCount !== undefined ? "smallest items, grouped for legibility" : hovered.path}
            </span>
          </div>
        ) : (
          <span className="text-[var(--text-secondary)]">
            {rects.length > 0 ? `${rects.length} items — hover any block for details` : ""}
          </span>
        )}
      </footer>
    </div>
  );
}
