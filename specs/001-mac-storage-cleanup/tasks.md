---

description: "Task list for the Mac Storage Cleanup Dashboard feature implementation"
---

# Tasks: Mac Storage Cleanup Dashboard

**Input**: Design documents from `/specs/001-mac-storage-cleanup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md — all present.

**Tests**: No automated test suite per constitution Principle VI (single-user local tool). Each phase ends with a manual verification task pointing at the matching `quickstart.md` step instead of an automated test task.

**Organization**: Tasks are grouped by user story, in priority order (P1 → P4), matching spec.md. Each story is independently demonstrable — this is also the literal order the bottom-up build happens in per constitution Principle III.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1-US4)

## Phase 1: Setup

- [ ] T001 Initialize the Next.js (App Router, TypeScript) project at the repository root; install `d3-hierarchy` and `trash` as dependencies
- [ ] T002 [P] Create the `data/` directory structure (`data/scans/`, `data/deletes/`, `data/index.json` as an empty JSON array) and add `data/` to `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work begins until this phase is complete — every story reads or writes these shared pieces.

- [ ] T003 Create shared TypeScript types in `lib/scan-types.ts` — `StorageEntry`, `ScanSnapshot`, `Category`, `CleanupFlag`, `AISuggestion`, `DeleteLogEntry`, `IndexEntry` — exactly matching `data-model.md`
- [ ] T004 Create `lib/run-index.mjs` — read/append helpers for `data/index.json`, plus a helper that prunes `data/scans/` down to the most recent 10 files after each new scan (constitution Technology Constraints); shared by the scanner scripts (Phase 3+) and the Next.js API routes

**Checkpoint**: Foundation ready — User Story 1 can now start.

---

## Phase 3: User Story 1 - See where disk space is actually going (Priority: P1) 🎯 MVP

**Goal**: Deepak opens the dashboard and sees a real, categorized treemap of his disk.

**Independent Test**: Run a real scan; the treemap's category totals match Finder/System Settings within 5%.

- [ ] T005 [US1] Implement `scanner/categorize.mjs` — maps a raw path/stat entry to a Category id per `data-model.md`
- [ ] T006 [US1] Implement `scanner/scan.mjs` — recursive walker using `fs.promises.readdir(..., {withFileTypes:true})` and `fs.lstat` (not following symlinks), `(dev,ino)` de-dup for hard links, `allocatedBytes` vs `sizeBytes` comparison for iCloud-optimized flagging, `--root` and `--dry-run` flags; writes a new `data/scans/<timestamp>.json`, appends an `IndexEntry` via `lib/run-index.mjs`, and prunes old scan files — all per `research.md`
- [ ] T007 [US1] Manually verify `scanner/scan.mjs` against the real disk per `quickstart.md` step 1 — cross-check the total against System Settings → Storage within 5% (SC-002), and record the real `durationMs` as the documented performance baseline
- [ ] T008 [US1] Implement `app/api/scan/route.ts` — POST triggers `scanner/scan.mjs` as a child process and returns the Scan Snapshot, per `contracts/api.md`
- [ ] T009 [P] [US1] Implement `lib/treemap.ts` — d3-hierarchy treemap layout helper plus category color mapping
- [ ] T010 [US1] Implement `app/page.tsx` — treemap view: category rectangles sized/labeled per FR-001/FR-002, a "Refresh" button calling `/api/scan` (FR-003), and an explicit empty/pending state before any scan exists (FR-013)
- [ ] T011 [US1] Create `start.command` — double-clickable launcher that starts the Next.js server and opens the browser to the dashboard
- [ ] T012 [US1] Manually verify User Story 1 end-to-end per `quickstart.md` steps 4-5 — real scan renders correctly, Refresh works, empty state shows correctly before the first scan

**Checkpoint**: User Story 1 fully functional and demoable on its own — this is the MVP slice.

---

## Phase 4: User Story 2 - Drill into any category down to individual files (Priority: P2)

**Goal**: Deepak can click into any category and see real files, sizes, and last-used dates down to individual files.

**Independent Test**: Drill into a folder with known contents; every child's size and dates match Finder's Get Info.

- [ ] T013 [US2] Implement `app/api/entry-detail/route.ts` — GET by `path`, runs `mdls -name kMDItemLastUsedDate -raw` for that single path on demand and returns `lastUsedAt`, per `research.md`'s "Last used data" decision; add this route to `contracts/api.md` to keep the contract doc in sync
- [ ] T014 [US2] Implement `app/browse/[...path]/page.tsx` — drill-down view rendering any folder's children as a nested treemap, back-navigation, per-file detail (size, `modifiedAt` immediately, `lastUsedAt` fetched via T013 on click), and a clear "restricted" indicator for permission-denied folders, per FR-004/FR-005 and the spec's Edge Cases
- [ ] T015 [US2] Manually verify User Story 2 per `quickstart.md` step 2 — drill into a known folder, spot-check one file's size and dates against Finder's Get Info

**Checkpoint**: User Stories 1 and 2 both fully functional.

---

## Phase 5: User Story 3 - Find and safely delete reclaimable space (Priority: P3)

**Goal**: Deepak can see flagged reclaimable items and actually delete them, safely, from the app.

**Independent Test**: Delete a controlled set of disposable test files through the app; confirm Trash, freed space, and the delete log.

- [ ] T016 [US3] Implement `scanner/reclaim-rules.mjs` — deterministic flagging rules (stale `node_modules`, Xcode DerivedData, old Downloads installers, Trash contents, long-untouched large files), each producing a `CleanupFlag` with `ruleId`/`reason`/`confidence` per `data-model.md`
- [ ] T017 [US3] Implement `scanner/delete.mjs` — re-verifies each requested path still exists and still matches its scanned state, enforces the `$HOME`-plus-known-safe-caches boundary (refusing anything outside it regardless of how it was flagged), moves matching paths to Trash via the `trash` package (never `fs.rm`/`fs.unlink`), writes a new `data/deletes/<timestamp>.json` batch file, and appends the matching `IndexEntry`
- [ ] T018 [US3] Manually verify `scanner/delete.mjs` against **disposable test files only**, per `quickstart.md` step 3 — this MUST pass before T019 wires deletion to real data (Constitution Principle I gate, never skipped)
- [ ] T019 [US3] Implement `app/api/delete/route.ts` — POST re-verifies and calls `scanner/delete.mjs`, returns `deleted`/`skipped` per `contracts/api.md`, enforcing FR-010 and FR-012
- [ ] T020 [US3] Implement `app/cleanup/page.tsx` — flagged items list (path, size, reason, confidence), multi-select, a confirmation step showing the exact file paths and total size before anything is removed (FR-008), calling `/api/delete`, and reflecting freed space after the next Refresh
- [ ] T021 [US3] Manually verify User Story 3 end-to-end per `quickstart.md` step 6 and the Full End-to-End Acceptance section — delete one real, low-risk flagged item through the UI, confirm it lands in Trash, confirm the delete log recorded it, confirm a subsequent Refresh shows the freed space

**Checkpoint**: User Stories 1-3 fully functional — this is the complete core tool.

---

## Phase 6: User Story 4 - Get AI-reasoned suggestions for ambiguous items (Priority: P4)

**Goal**: An optional AI-reasoning layer surfaces ambiguous items the deterministic rules didn't confidently flag.

**Independent Test**: Suggestions are grounded in real scanned metadata; the rest of the Cleanup view works identically with or without this layer available.

- [ ] T022 [US4] Implement `app/api/ai-suggest/route.ts` — sends only scanned metadata (paths, sizes, ages, categories; never file contents) for candidate items to the Claude API, returns `AISuggestion[]` with confidence `"worth-a-look"`; returns `{ suggestions: [], unavailable: true }` (never an error) when no API key is configured or the call fails, per `contracts/api.md` and FR-016/FR-018
- [ ] T023 [US4] Extend `app/cleanup/page.tsx` with a visually distinct "AI Suggestions" section — nothing pre-selected, routed through the exact same select → path-level confirmation → Trash-move flow as rule-based flags (FR-017), absent or showing an "unavailable" state gracefully when the layer isn't available
- [ ] T024 [US4] Manually verify User Story 4 per `quickstart.md` step 7 — with an API key configured and without one, confirming graceful degradation in both directions and that an AI-suggested delete goes through the identical safety flow as T021 verified for rule-based flags

**Checkpoint**: All four user stories independently functional. Full feature complete.

---

## Final Phase: Polish & Cross-Cutting

- [ ] T025 Run the complete `quickstart.md` "Full end-to-end acceptance" checklist against the real disk, start to finish
- [ ] T026 [P] Note the `start.command` launch flow and where `data/` lives in a short `README.md`, for future-you and for the Lyzr video walkthrough

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → **Foundational (Phase 2)**: strictly sequential, blocks everything else.
- **US1 (Phase 3)**: depends only on Foundational. This is the MVP — stop and validate here before continuing if time gets tight.
- **US2 (Phase 4)**: depends on Foundational and on US1's Scan Snapshot existing (drilling into something that was scanned), but its own code (T013-T015) doesn't modify US1's files — independently testable once US1 works.
- **US3 (Phase 5)**: depends on Foundational and on US1's Scan Snapshot (to know what to flag); does not depend on US2's code.
- **US4 (Phase 6)**: depends on US3's Cleanup view existing (T020) — the AI Suggestions section is added to the same page — otherwise independent of US2.
- **Polish (Final Phase)**: depends on all four stories being complete.

Within each story, tasks run in the listed order except where marked `[P]` — those can run alongside the task immediately before them since they touch different files.

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 → Phase 2 → Phase 3 (T001-T012).
2. **STOP and validate**: real scan, real treemap, matches System Settings within 5%.
3. This alone is already a legitimate first cut of the Lyzr demo artifact if time runs out — a working, real-data treemap beats an unfinished delete flow.

### Incremental delivery from there

Each subsequent phase (US2 → US3 → US4) adds a complete, independently demoable increment without breaking the previous ones — stop after any phase and the tool is still fully honest about what it does and doesn't do yet.

## Notes

- No task ever wires real deletion (T019, US3) before its disposable-file verification (T018) has passed — this ordering is load-bearing, not incidental.
- `[P]` tasks touch different files from the task immediately preceding them and can be done in either order or in parallel.
- Given the bottom-up, explained-as-we-go approach (constitution Principle III), each task should be built, shown, and understood before starting the next — even the `[P]`-marked ones.
