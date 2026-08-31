# API Contracts: Mac Storage Cleanup Dashboard

Three internal Next.js API routes. All are called only by this app's own frontend — there is no external consumer — but the shapes are documented here so the UI (Phase 1 later) and the routes (Phase 1 earlier) can be built against a fixed agreement.

## `POST /api/scan`

Triggers `scanner/scan.mjs`, waits for it to finish, writes a new timestamped file under `data/scans/` plus a matching row in `data/index.json`, and returns the resulting Scan Snapshot.

**Request body**: none.

**Response 200**:

```json
{
  "scannedAt": "2026-08-31T10:15:00.000Z",
  "durationMs": 41230,
  "root": {
    "path": "/Users/deepak",
    "name": "deepak",
    "kind": "directory",
    "sizeBytes": 0,
    "allocatedBytes": 0,
    "category": "other",
    "modifiedAt": "...",
    "lastUsedAt": null,
    "flags": [],
    "children": []
  }
}
```

**Response 500**: `{ "error": "scan failed", "detail": "..." }` — scanner process exited non-zero or crashed; the most recent file already in `data/scans/` is left untouched so the dashboard can still show the last good snapshot instead of nothing.

## `POST /api/delete`

Re-verifies and deletes (moves to Trash) a set of paths the user confirmed in the UI.

**Request body**:

```json
{
  "paths": [
    "/Users/deepak/Library/Caches/some-app",
    "/Users/deepak/Downloads/old-installer.dmg"
  ]
}
```

**Response 200**:

```json
{
  "deleted": [
    { "path": "/Users/deepak/Library/Caches/some-app", "sizeBytes": 1048576 }
  ],
  "skipped": [
    {
      "path": "/Users/deepak/Downloads/old-installer.dmg",
      "reason": "no longer exists"
    }
  ]
}
```

Every path in the request is independently re-verified (still exists, still matches the boundary rule) before being moved to Trash — a boundary violation or a vanished file produces an entry in `skipped` with a reason, never a silent omission and never a failure of the whole batch (FR-012).

**Response 403**: `{ "error": "path outside allowed boundary", "path": "..." }` — returned instead of a 200 only when every requested path is out of bounds; if some paths are valid and some are not, the valid ones still proceed and the invalid ones appear in `skipped` with reason `"outside allowed boundary"` (this keeps FR-010's refusal per-item, not per-request).

**Response 400**: `{ "error": "no paths provided" }` — empty `paths` array.

Every successful deletion also writes a new timestamped file under `data/deletes/` (one `DeleteLogEntry` per deleted path) plus a matching row in `data/index.json`, before the response is returned (FR-011).

## `POST /api/ai-suggest`

Optional extra pass, built after the rule-based Cleanup view already works. Sends only scanned metadata for a set of ambiguous Storage Entries (paths, sizes, ages, categories — never file contents) to the Claude API and returns written suggestions.

**Request body**:

```json
{
  "candidatePaths": ["/Users/deepak/Documents/old-export-2024"]
}
```

**Response 200**:

```json
{
  "suggestions": [
    {
      "path": "/Users/deepak/Documents/old-export-2024",
      "rationale": "Large folder, last modified 14 months ago, named like a one-time export — likely safe to archive or remove if you no longer need it.",
      "confidence": "worth-a-look"
    }
  ]
}
```

**Response 200 (no API key configured)**: `{ "suggestions": [], "unavailable": true }` — never an error; the Cleanup view's rule-based flags are unaffected either way (constitution: AI layer must degrade gracefully).

**Response 502**: `{ "error": "AI suggestion request failed", "detail": "..." }` — the Claude API call itself failed; same graceful-degradation rule applies, the rest of the Cleanup view still renders normally.
