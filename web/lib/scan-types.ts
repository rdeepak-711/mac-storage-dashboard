/**
 * Shared types for the scan/delete data model.
 * Mirrors specs/001-mac-storage-cleanup/data-model.md exactly — that doc is
 * the source of truth; keep this file in sync with it, not the other way around.
 */

/**
 * Simplified 2026-09-03, real-usage-driven: Deepak said plainly the old
 * 9-category split ("this segregation of categories I am not able to
 * understand") didn't map to how he actually thinks about his disk. The
 * categories that matter to him are the real, recognizable top-level
 * folders he navigates to on purpose — Documents, Downloads, Desktop,
 * Applications, Developer (dropped Google Drive for now, explicitly
 * "later - maybe" per his own words) — plus the two functional catch-alls
 * (Reclaimable, Other). Photos/Music/Mail/System-Data are gone: on his
 * real scan they were either negligible (Photos 8KB, Music 1.5MB) or,
 * for System Data (Library, 48GB) — deliberately folded into Other since
 * it's opaque OS/app-managed data he never navigates to on purpose, unlike
 * Developer (21GB, but his own organized project folders).
 */
export type Category =
  | "documents"
  | "downloads"
  | "desktop"
  | "applications"
  | "developer"
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

/**
 * Alias used by TreemapLevel/ListLevel/app/page.tsx — every DisplayEntry
 * is a real, individually-deletable filesystem path (or, for the Clean
 * up tab, a real flagged path adapted into this shape). No synthetic
 * "view only" entries exist since the 2026-09-01 category-navigation
 * removal — see .claude/plans/functional-enchanting-corbato.md.
 */
export type DisplayEntry = StorageEntry;

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
  /**
   * Added 2026-09-01: the real `.app` bundle (Terminal, VS Code, etc.)
   * that actually launched the scanner process, detected by walking the
   * real process tree via `ps` — see scanner/scan.mjs's detectHostApp().
   * macOS's own "Full Disk Access" Settings pane doesn't say which app to
   * add; this is the one piece of information we have that it doesn't.
   * null when nothing was restricted, or when detection failed/found no
   * `.app` ancestor (e.g. running outside a normal app-launched shell).
   */
  scannerHostApp: string | null;
}

/**
 * How an item comes back if you delete it. Replaced the old
 * `CleanupConfidence = "safe" | "caution"` on 2026-09-03.
 *
 * "Safe" was doing two incompatible jobs — *nothing is lost* and
 * *nothing that matters is lost* — and they come apart exactly where it
 * hurts: deleting 5.6 GB of HuggingFace models loses nothing permanent
 * and still costs an hour. These three tiers say the thing the single
 * word couldn't.
 */
export type Recoverability =
  /** Regenerated locally from what's already on disk. No network. */
  | "instant"
  /** Regenerated only by fetching over the network — time and bandwidth. */
  | "redownload"
  /** Cannot be regenerated automatically. The default for anything unproven. */
  | "irreplaceable";

/** How long since the item was last modified. See lib/recoverability.mjs. */
export type Activity = "active" | "idle" | "stale";

/**
 * What the tool is willing to say about an item.
 *
 * `review` is the important addition. Without it the tool is silent
 * about everything it cannot prove regenerable — roughly 19 GB of
 * abandoned tooling on this disk (.vscode untouched since 2025-09-28,
 * .local, .npm-global, old editor profiles). Silent is safe and useless.
 * Review items are shown with their real size and date, are never
 * pre-selected, and are never included in a bulk delete: the tool
 * surfaces the fact, the user makes the call.
 */
export type Disposition = "suggested" | "review";

export interface CleanupFlag {
  path: string;
  ruleId: string;
  /** Whether this is offered for deletion, or only surfaced for a human decision. */
  disposition: Disposition;
  recoverability: Recoverability;
  activity: Activity;
  /** Derived from tier + size, never hand-written per rule. See costSentence(). */
  reason: string;
  /** A real command that restores this, when one exists (e.g. "npm install"). Never prose. */
  restoreCommand: string | null;
  /** ISO mtime — the "last touched" date shown next to review items. */
  lastTouchedAt: string | null;
  /** allocatedBytes at scan time — kept (not stripped) so the Cleanup view's pre-delete total (FR-008) doesn't need a second lookup. */
  sizeBytes: number;
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

/**
 * One persisted `/api/ai-suggest` call — added alongside the eval harness
 * (lib/ai-eval.mjs), 2026-09-02. Stored at data/ai-suggestions/<timestamp>.json,
 * one file per call, same pattern as DeleteLogEntry under data/deletes/.
 * This is what makes the AI layer's real-world accuracy measurable instead
 * of a black box: scoreRealUsage() cross-references `suggestions` here
 * against later DeleteLogEntry/ProtectedPath activity to find out whether
 * each suggestion was actually acted on.
 */
export interface AiSuggestionLogEntry {
  requestedAt: string;
  model: string;
  candidates: { path: string; name: string; category: Category; allocatedBytes: number }[];
  suggestions: AISuggestion[];
  /** Whether buildHistoryContext() found prior outcomes relevant to this batch and injected them into the prompt. */
  historyContextUsed: boolean;
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
