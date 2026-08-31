# Phase 1 Data Model: Mac Storage Cleanup Dashboard

Six entities, five defined in spec.md's Key Entities section plus AI Suggestion (added after the AI-reasoning layer was approved as an explicit extra pass). This document adds the concrete field-level shape each one takes as JSON, since this project has no database — these shapes ARE the storage format, written under `data/` per the per-run + index design (see plan.md and the constitution's Technology Constraints).

## Run Index

The single persistent, append-only file at `data/index.json` — a list of every scan and delete run, small enough to keep forever even after individual scan files are pruned.

```text
IndexEntry
├── date: string (ISO 8601) — when this run happened
├── type: "scan" | "delete"
├── file: string — relative path to the full run file (data/scans/<file> or data/deletes/<file>)
├── totalBytes: number | null — set for "scan" runs (root.sizeBytes), null for "delete" runs
├── deletedBytes: number | null — set for "delete" runs (sum of that run's deletions), null for "scan" runs
```

## Scan Snapshot

One scan run's full result, written to its own timestamped file under `data/scans/` (e.g. `data/scans/2026-09-01T10-15-00.json`), and summarized as one `IndexEntry` in `data/index.json`.

```text
ScanSnapshot
├── scannedAt: string (ISO 8601 timestamp) — when this scan completed
├── durationMs: number — how long the scan took, for the performance baseline in quickstart.md
├── root: StorageEntry — the root node (the disk itself), whose children are the top-level categories
```

## Storage Entry

A single file or folder node — the recursive tree structure. Every category, folder, and file is one of these.

```text
StorageEntry
├── path: string — absolute path
├── name: string — display name (basename of path)
├── kind: "file" | "directory"
├── sizeBytes: number — logical size for files; sum of children for directories
├── allocatedBytes: number — actual bytes on disk (from stat.blocks * 512); used to detect
│                            iCloud-optimized files (allocatedBytes << sizeBytes)
├── category: string — one of the Category ids (see below); set on top-level entries, inherited
│                       by children for filtering/coloring purposes
├── modifiedAt: string (ISO 8601) — fs.stat().mtime
├── lastUsedAt: string (ISO 8601) | null — from mdls kMDItemLastUsedDate, fetched on-demand per
│                                          User Story 2's drill-down, not during the bulk scan
├── flags: string[] — zero or more of: "restricted" (permission denied), "icloud-optimized",
│                      "symlink-target-already-counted" (dedup marker from Phase 0 research)
├── children: StorageEntry[] | undefined — present only for kind: "directory"
```

## Category

Not a separate stored object — a fixed, known set of ids used as the `category` field on top-level Storage Entries, matching macOS Storage settings' own buckets plus the dev-specific "Reclaimable" grouping the built-in tool doesn't surface:

```text
"documents" | "applications" | "developer" | "photos" | "system-data" | "mail" | "music"
| "reclaimable" | "other"
```

## Cleanup Flag

Not a separate top-level list — an annotation produced by `scanner/reclaim-rules.mjs` at Cleanup view render time, joining a deterministic rule against matching Storage Entries from the current Scan Snapshot:

```text
CleanupFlag
├── path: string — matches a StorageEntry.path in the current snapshot
├── ruleId: string — e.g. "stale-node-modules", "xcode-derived-data", "old-downloads-installer",
│                     "trash-contents", "stale-large-file"
├── reason: string — human-readable explanation shown in the UI
├── confidence: "safe" | "caution"
```

## AI Suggestion

Produced by the optional AI-reasoning layer, only from scanned metadata (never file contents), only for ambiguous items the deterministic rules didn't confidently flag. Always shown in the UI as visually distinct from `CleanupFlag`s, never silently merged into them, and never auto-selected.

```text
AISuggestion
├── path: string — matches a StorageEntry.path in the current snapshot
├── rationale: string — the model's written reasoning, shown to the user verbatim
├── confidence: "worth-a-look" — a single, deliberately lower-trust tier than rule-based
│                                 "safe"/"caution", since this is inference, not a fixed rule
```

## Delete Log

One delete run's full result, written to its own timestamped file under `data/deletes/` (e.g. `data/deletes/2026-09-01T11-02-10.json`), and summarized as one `IndexEntry` in `data/index.json`. Each file is a JSON array of entries:

```text
DeleteLogEntry
├── path: string
├── sizeBytes: number
├── deletedAt: string (ISO 8601)
├── ruleId: string | null — the CleanupFlag ruleId or "ai-suggestion" if it came from that layer,
│                            null if manually selected without either
```

## Relationships

- A `ScanSnapshot` owns exactly one `root` `StorageEntry` tree; every other `StorageEntry` is a descendant of that root.
- `CleanupFlag`s and `AISuggestion`s are computed against a `ScanSnapshot`'s entries at view time — they are not persisted separately, so they're always consistent with whichever snapshot is currently loaded.
- Each delete run's `DeleteLogEntry` array is the only entity type that outlives the `ScanSnapshot` it came from — deleting files makes that snapshot stale (sizes no longer accurate) until the next Refresh, which is why FR-012 requires re-verifying a file still matches before actually deleting it.
- `IndexEntry` rows are the durable trend record — even after old `ScanSnapshot` files are pruned (constitution: only the last 10 full scans kept), their `IndexEntry` summary remains, so disk-usage-over-time stays queryable indefinitely.
