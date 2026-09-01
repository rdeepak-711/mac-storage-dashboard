/**
 * Shared types for the scan/delete data model.
 * Mirrors specs/001-mac-storage-cleanup/data-model.md exactly — that doc is
 * the source of truth; keep this file in sync with it, not the other way around.
 */

export type Category =
  | "documents"
  | "applications"
  | "developer"
  | "photos"
  | "system-data"
  | "mail"
  | "music"
  | "reclaimable"
  | "other";

export type StorageEntryFlag =
  | "restricted"
  | "icloud-optimized"
  | "symlink-target-already-counted";

export interface StorageEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  sizeBytes: number;
  allocatedBytes: number;
  category: Category;
  modifiedAt: string;
  lastUsedAt: string | null;
  flags: StorageEntryFlag[];
  children?: StorageEntry[];
}

export interface ScanSnapshot {
  scannedAt: string;
  durationMs: number;
  root: StorageEntry;
  categoryTotals: Record<Category, number>;
  /**
   * Real, whole-disk context from the OS itself (fs.statfsSync), not
   * derived from our scan — the scan only covers a subset ($HOME +
   * /Applications). Added 2026-09-01 so the UI can honestly show
   * "used X of Y GB total" against the real volume, not just our
   * partial categorized total.
   */
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskFreeBytes: number;
  /** Computed inline during the walk, bounded to the largest 50 by size. See reclaim-rules.mjs. */
  cleanupFlags: CleanupFlag[];
  /**
   * Real folders the scanner couldn't read (readdir failed — almost
   * always a missing Full Disk Access grant for whatever process ran the
   * scan). Added 2026-09-01 after finding ~/Library/Mail, Messages,
   * Photos, Safari etc. were silently reporting as 0GB on a real Mac
   * without FDA granted — this makes that gap visible instead of hidden.
   */
  restrictedPaths: { path: string; name: string }[];
}

export type CleanupConfidence = "safe" | "caution";

export interface CleanupFlag {
  path: string;
  ruleId: string;
  reason: string;
  confidence: CleanupConfidence;
  /** Only set for ruleId "duplicate-file": the path of the copy being kept. */
  duplicateOf?: string;
}

/**
 * Added 2026-09-01 (FR-010a): a user-managed, persisted list of real paths
 * the delete flow must refuse unconditionally. Stored at
 * data/protected-paths.json, separate from any scan — see
 * lib/protected-paths.mjs and data-model.md's "Protected Path" section.
 */
export interface ProtectedPath {
  path: string;
  addedAt: string;
  note?: string;
}

export interface AISuggestion {
  path: string;
  rationale: string;
  confidence: "worth-a-look";
}

export interface DeleteLogEntry {
  path: string;
  sizeBytes: number;
  deletedAt: string;
  ruleId: string | null;
}

export type IndexEntry =
  | {
      date: string;
      type: "scan";
      file: string;
      totalBytes: number;
      deletedBytes: null;
    }
  | {
      date: string;
      type: "delete";
      file: string;
      totalBytes: null;
      deletedBytes: number;
    };
