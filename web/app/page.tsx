"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { layoutTreemap, type TreemapRect } from "@/lib/treemap";
import type { ScanSnapshot, StorageEntry } from "@/lib/scan-types";

function formatGB(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

type Status = "loading" | "idle" | "scanning" | "error";

export default function Home() {
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [entries, setEntries] = useState<StorageEntry[] | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <div className="font-[family-name:var(--font-data)] text-sm text-[var(--text-primary)]">
            {scan ? `${formatGB(scan.root.allocatedBytes)} used` : "No scan yet"}
          </div>
          {scan && (
            <div className="text-xs text-[var(--text-secondary)]">
              Last scanned {new Date(scan.scannedAt).toLocaleString()}
            </div>
          )}
        </div>
        <button
          onClick={runScan}
          disabled={status === "scanning"}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] disabled:cursor-default disabled:opacity-60"
        >
          {status === "scanning" ? `Scanning… ${elapsedSec}s` : "Refresh"}
        </button>
      </header>

      {status === "error" && (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm text-red-400">
          Scan failed: {errorMessage}
        </div>
      )}

      <main ref={containerRef} className="relative flex-1 overflow-hidden">
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

        {rects.map((r) => (
          <div
            key={r.path}
            title={`${r.name} — ${formatGB(r.allocatedBytes)}`}
            className="absolute box-border flex flex-col justify-end overflow-hidden p-2 transition-[filter] hover:brightness-110"
            style={{ left: r.x, top: r.y, width: r.width, height: r.height, background: r.color }}
          >
            {r.width > 60 && r.height > 30 && (
              <>
                <div className="truncate text-xs font-semibold text-[var(--bg)]">{r.name}</div>
                <div className="font-[family-name:var(--font-data)] text-[11px] text-[var(--bg)] opacity-80">
                  {formatGB(r.allocatedBytes)}
                </div>
              </>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
