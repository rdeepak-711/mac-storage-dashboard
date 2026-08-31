# Implementation Plan: Mac Storage Cleanup Dashboard

**Branch**: `001-mac-storage-cleanup` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-mac-storage-cleanup/spec.md`

## Summary

A local, single-user tool that scans Deepak's Mac, shows a treemap breakdown of disk usage by category (matching macOS Storage settings' own categories), lets him drill down to individual files with size and last-used dates, flags likely-reclaimable items (deterministic rules plus an optional AI-reasoning layer for ambiguous cases), and deletes selected items to Trash with an explicit path-level confirmation. Built bottom-up: scanner script first (verified by hand), then categorization/flagging logic, then the delete function (verified against disposable test files before ever touching real data), then the Next.js API routes, then the treemap UI, then drill-down and the cleanup panel, then the AI-suggestion layer as a final extra pass.

## Technical Context

**Language/Version**: Node.js (current LTS), TypeScript for the Next.js app, plain `.mjs` for the standalone scanner script.

**Primary Dependencies**: Next.js (App Router), `d3-hierarchy` (treemap layout), `trash` npm package (Finder-safe move-to-Trash), Node's built-in `fs`/`fs.promises` and `child_process` (for `mdls`), `@anthropic-ai/sdk` (optional, only for the AI-suggestion layer).

**Storage**: Flat JSON files on local disk, one file per run — `data/scans/<timestamp>.json` per scan, `data/deletes/<timestamp>.json` per delete batch — plus `data/index.json`, a small append-only summary of every run (date, type, file, headline numbers) kept indefinitely so history stays browsable after old scan files are pruned. No database.

**Testing**: No automated test suite (per constitution Principle VI / Development Workflow — single-user local tool). The scanner ships a `--dry-run` mode as the primary verification tool; each build step is manually verified against real (or disposable test) data before moving on.

**Target Platform**: macOS (Deepak's own MacBook), launched via `start.command` (double-click, no manual `npm run dev` needed) — not deployed.

**Project Type**: Local web application (Next.js frontend + API routes) with a standalone companion CLI script (the scanner) — single repo, no separate backend service.

**Performance Goals**: A full scan of a 250GB / ~250k-file disk completes in a time Deepak is willing to wait for a manual "Refresh" (target: well under 2 minutes; exact figure to be measured against the real disk in Phase 0 of the build, not assumed).

**Constraints**: Must never permanently delete a file (Trash-only). Must never fabricate data. Must stay within Deepak's own user permissions — no elevated/root access. The AI-suggestion layer must degrade gracefully (rule-based flags still fully work) if no API key is configured or the call fails.

**Scale/Scope**: Single user, single machine, one disk (~250GB, internal only). No concurrency, no multi-session concerns.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Safety-First Deletion | Plan uses Trash-only deletion (`trash` package), path-level confirmation, `$HOME`-only boundary, audit log; AI suggestions go through the identical confirm-then-delete flow, never a bypass | PASS |
| II. Real Data Only | Plan has no mock/sample data path anywhere; empty state is explicit; AI layer reasons only over real scanned metadata | PASS |
| III. Bottom-Up, Explained Build | Build order below is scanner → categorization/flagging → delete function → API → UI → AI-suggestion layer, each verified before the next | PASS |
| IV. Reuse Existing Stack | Node.js + Next.js, no new language/runtime introduced; Claude API is an additive, optional dependency, not a stack change | PASS |
| V. Dual Purpose | Plan targets Deepak's real disk first; no feature exists purely for demo polish | PASS |
| VI. Simplicity (YAGNI) | Manual refresh, flat per-run JSON storage, no rule engine beyond a flat rule list, no auth, no multi-user | PASS |

No violations. Complexity Tracking section below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-mac-storage-cleanup/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── api.md            # Phase 1 output — the three internal API routes
└── tasks.md               # Phase 2 output (/speckit-tasks — not yet created)
```

### Source Code (repository root)

```text
scanner/
├── scan.mjs              # Standalone recursive filesystem walker → writes data/scans/<ts>.json
├── categorize.mjs        # Maps raw scan entries to macOS-style categories
├── reclaim-rules.mjs     # Deterministic flagging: caches, stale build artifacts, old installers,
│                          # Trash, stale large files
└── delete.mjs            # Trash-move + verification, callable standalone or from the API route

app/                       # Next.js App Router
├── page.tsx               # Treemap view (top-level categories)
├── browse/[...path]/page.tsx  # Drill-down view for any folder
├── cleanup/page.tsx       # Flagged items list + AI Suggestions section + delete flow
└── api/
    ├── scan/route.ts       # POST — triggers scanner/scan.mjs, returns fresh Scan Snapshot
    ├── delete/route.ts     # POST — re-verifies + moves selected paths to Trash
    └── ai-suggest/route.ts # POST — optional Claude API call for ambiguous-item reasoning

lib/
├── treemap.ts             # d3-hierarchy layout helpers shared by page.tsx and browse/
└── scan-types.ts          # Shared TypeScript types for Storage Entry / Category / Cleanup Flag /
                            # AI Suggestion

data/
├── index.json              # Append-only run index (small, kept indefinitely)
├── scans/                  # One timestamped Scan Snapshot file per run (gitignored — real disk
│                            # data; only the most recent 10 are retained)
└── deletes/                 # One timestamped Delete Log file per delete batch (gitignored)

start.command                # Double-clickable launcher (Finder-executable shell script):
                              # starts the Next.js server and opens the browser to it — no
                              # manual `npm run dev` needed after the initial build
```

**Structure Decision**: Single Next.js project with a standalone `scanner/` directory of plain Node scripts the API routes shell out to. This matches Principle IV (reuse existing stack, same shape as Deepak's other local dashboards) and keeps the scanner independently runnable/testable from the command line during the bottom-up build (Principle III) before any UI exists.

## Complexity Tracking

*No constitution violations — table intentionally empty.*
