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
}

export type CleanupConfidence = "safe" | "caution";

export interface CleanupFlag {
  path: string;
  ruleId: string;
  reason: string;
  confidence: CleanupConfidence;
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
