# Quickstart: Mac Storage Cleanup Dashboard

How to prove each bottom-up build step actually works, in the order the plan builds them. This is a validation guide, not implementation code — see `tasks.md` (once `/speckit-tasks` runs) for that.

## 1. Scanner (standalone, no UI yet)

```bash
node scanner/scan.mjs --root ~ --dry-run
```

**Prerequisites**: Node LTS installed, repo cloned, `npm install` run once for `trash` / `d3-hierarchy` (not needed for this step specifically, but for the repo as a whole).

**Expected outcome**: Prints a summary (total size, per-category breakdown, scan duration) to stdout and writes a new timestamped file under `data/scans/`, plus one new row in `data/index.json`. Cross-check the top-level total against System Settings → General → Storage on the same Mac — should match within the 5% tolerance from SC-002. This run also produces the real `durationMs` figure that becomes the documented performance baseline (research.md's "Scan performance target" — no number is assumed before this step runs for real).

## 2. Categorization + reclaim flagging (standalone)

```bash
node scanner/reclaim-rules.mjs --scan data/scans/<latest-file>.json
```

**Expected outcome**: Prints the list of flagged items (path, rule, reason, confidence) without touching any files. Manually verify a handful of the flagged items by eye in Finder — do they look like things that are actually safe to remove?

## 3. Delete function (against disposable test files ONLY)

```bash
mkdir -p /tmp/mac-storage-dashboard-test && touch /tmp/mac-storage-dashboard-test/{a,b,c}.txt
node scanner/delete.mjs --paths /tmp/mac-storage-dashboard-test/a.txt
```

**Expected outcome**: `a.txt` disappears from `/tmp/...` and appears in `~/.Trash` (or Finder's Trash, same thing). A new timestamped file appears under `data/deletes/` with one entry, and `data/index.json` gets a matching row. `b.txt` and `c.txt` are untouched. This step MUST be verified against disposable files before `/api/delete` is ever wired to the real Cleanup UI (Constitution Principle I).

## 4. API routes

```bash
npm run dev
curl -X POST http://localhost:3000/api/scan
curl -X POST http://localhost:3000/api/delete -H 'Content-Type: application/json' -d '{"paths":["/tmp/mac-storage-dashboard-test/b.txt"]}'
```

**Expected outcome**: Same results as steps 1 and 3, now reachable over HTTP, matching the shapes in `contracts/api.md`.

## 5. Treemap UI

```bash
./start.command
```

**Expected outcome**: Browser opens to the dashboard; the treemap renders real category rectangles sized to match the numbers from step 1. No mock data anywhere (Constitution Principle II) — if no scan has run yet, the empty state appears instead.

## 6. Drill-down + Cleanup UI

**Expected outcome**: Clicking any category rectangle navigates into its contents; clicking a flagged item in the Cleanup view, selecting it, and confirming shows the exact path + size, then actually removes it (verified the same way as step 3, but now through the real UI) and the dashboard reflects the freed space after the next Refresh.

## 7. AI-suggestion layer (extra pass, after 1-6 already work)

**Expected outcome**: With an Anthropic API key set, the Cleanup view gains a visually separate "AI Suggestions" section listing ambiguous items with written rationale, none pre-selected. Selecting one and confirming goes through the exact same path-level confirmation and delete flow as a rule-based flag (Constitution Principle I). With no API key set (or the call failing), the rule-based Cleanup view still works exactly as in step 6 — nothing about it breaks or blocks on the AI layer being unavailable.

## Full end-to-end acceptance (matches spec.md's Independent Test for each user story)

1. Run a real scan of the full disk. Total matches System Settings within 5% (SC-002).
2. Drill into at least one folder several levels deep; spot-check one file's size and dates against Finder's Get Info.
3. Pick one low-risk flagged item (e.g. a known stale cache), delete it through the UI, confirm it landed in Trash and the delete log recorded it, and confirm a subsequent Refresh shows the freed space.
