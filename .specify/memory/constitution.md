<!--
Sync Impact Report
- Version change: 1.0.0 → 1.2.0
- Modified principles: I (Safety-First Deletion) expanded to explicitly cover AI-sourced
  suggestions; Technology Constraints expanded (per-run scan/delete files + index; optional
  Claude API dependency for AI-suggested cleanup reasoning)
- Added sections: none (folded into existing Principle I and Technology Constraints)
- Removed sections: none
- Follow-up TODOs: none
-->

# Mac Storage Dashboard Constitution

## Core Principles

### I. Safety-First Deletion (NON-NEGOTIABLE)

The app deletes real files from a real disk. Every deletion MUST move files to `~/.Trash` (recoverable) — permanent deletion (`fs.rm`, `rm -rf`, or equivalent) MUST NOT be used anywhere in the codebase. Every delete confirmation MUST display the full resolved file paths and total size being removed, never a category label alone ("Documents", "Caches") standing in for the actual files. Deletion MUST be hard-blocked outside `$HOME` and explicitly known-safe cache paths, even if a cleanup rule mistakenly flags something outside that boundary. Every completed deletion MUST be appended to an audit log (path, size, timestamp) before the Trash empties on its own schedule.

Rationale: this is a personal tool that will run against Deepak's only working disk; the cost of a false positive is unrecoverable data loss, so every irreversible action gets the maximum available friction and transparency.

This applies identically to AI-sourced suggestions (see Technology Constraints): an AI suggestion is advisory input into the same rule-flag pipeline, never a bypass of it. AI suggestions MUST be labeled distinctly from deterministic rule flags, MUST go through the identical select → path-level confirmation → Trash-move flow, and the AI layer MUST receive only scanned metadata (paths, sizes, ages, categories) — never file contents — to produce them.

### II. Real Data Only

Every number, path, and "last used" date shown in the UI MUST originate from an actual filesystem scan of the real disk. No mocked, sampled, estimated, or placeholder data may reach the rendered dashboard at any point, including during development — a scan that hasn't run yet MUST show an empty/pending state, never fabricated numbers standing in for a real result.

Rationale: the entire value of the tool is trustworthy ground truth about disk usage; a single fabricated figure breaks that trust for every figure the tool ever shows.

### III. Bottom-Up, Explained Build

Implementation proceeds in small, ordered steps starting from the lowest level (filesystem scanning) up through categorization, then the API layer, then the UI. Each step is built, explained, and confirmed understood before the next step begins — no multi-layer "big bang" commits that bundle scanner, API, and UI changes together in one unexplained pass.

Rationale: Deepak explicitly asked for this pace ("I want it done, slowly - bottom up explained to me") — the build doubles as his own understanding of how the tool works, not just a deliverable.

### IV. Reuse the Existing Stack

The implementation MUST use Node.js scripts plus a Next.js dashboard, matching the pattern already established in Deepak's other projects (codephilic analytics puller, content-eval-pipeline, other local dashboards). New frameworks, languages, or runtimes (e.g. Swift/Xcode, Electron, Python) require an explicit, justified exception before use.

Rationale: this ships fast because it reuses skills and patterns Deepak already has; switching stacks trades that speed for unfamiliar tooling with no corresponding benefit here.

### V. Dual Purpose: Personal Tool and Portfolio Artifact

The tool MUST be genuinely useful for cleaning up Deepak's real 250GB MacBook — features are not justified by demo value alone. It MUST also stay clean and legible enough to serve as the video-explainer artifact for his Lyzr Developer & Automations Specialist application. Where these two goals conflict, real usefulness on the actual disk wins; portfolio polish is secondary and must never introduce fake data, hidden mocking, or unshippable shortcuts to look better on camera.

Rationale: a tool that only looks good in a demo but doesn't work is worse for the application than a genuinely working tool explained honestly, since the application itself asks for the thinking behind real work, not a staged one.

### VI. Simplicity (YAGNI)

Start with the simplest version that solves the actual problem: manual "Refresh" rescans on demand, not a live background daemon; a single flat set of cleanup rules, not a rule engine; no multi-user, sync, or cloud features. Add complexity only when a real, encountered need justifies it.

Rationale: this is a single-user, single-machine tool built under a real deadline (Lyzr's rolling close, end of Sep 2026) — speculative generality costs time this project doesn't have and nobody will use.

## Technology Constraints

- Scanner: Node.js (`.mjs`), using `fs`/`fs.promises` for traversal and stat calls, `mdls` (via `child_process`) for Spotlight "last opened" dates where available, and the `trash` npm package (or equivalent Finder-safe move-to-Trash mechanism) for all deletions.
- Dashboard: Next.js (App Router), matching the convention of Deepak's other local dashboards. Treemap visualization via d3-hierarchy's treemap layout.
- No database. Each scan run writes its own timestamped file under `data/scans/`; each delete run writes its own timestamped file under `data/deletes/`; `data/index.json` is a lightweight, append-only list of every run (date, type, file, headline numbers) so history is browsable without loading full snapshots. Only the most recent 10 full scan files are retained on disk (older ones are pruned after being rolled into the index) so scan history doesn't itself become a storage problem; index entries are kept indefinitely since they're small.
- AI-suggested cleanup reasoning is an explicit, optional extra layer (Anthropic Claude API) on top of the deterministic reclaim rules — the only external service/API-key dependency in the project. It MUST degrade gracefully (rule-based flags still work fully) if the API key is absent or the call fails.
- Runs locally only. Not deployed publicly; no auth system needed since it is single-user, local.

## Development Workflow

- Build order follows Principle III: (1) scanner script producing a correct scan file for a real directory, verified by hand before anything else is built, (2) categorization + deterministic "reclaimable" flagging logic on top of that scan output, (3) the delete-to-Trash function with its own manual verification on disposable test files before it is ever pointed at real data, (4) the Next.js API routes wrapping scan and delete, (5) the treemap UI reading real scan output, (6) the drill-down and cleanup-panel UI, (7) the AI-suggestion layer as an explicit extra pass on top of the already-working rule-based Cleanup view.
- Each step is demonstrated working (script output shown, or screenshot/description of UI state) and explained before moving to the next step.
- No automated test suite is required given Principle VI and the single-user nature of the tool; the scanner's `--dry-run` mode (prints what would be flagged/deleted without touching Trash) is the primary verification tool before enabling real deletion, and manual testing against the real disk is the acceptance test.

## Governance

This constitution supersedes ad hoc technical choices for this project. Any amendment requires Deepak's explicit approval in conversation before being written back to this file. Version bumps follow semantic versioning: MAJOR for principle removals or redefinitions, MINOR for new or materially expanded principles/sections, PATCH for wording/clarification only. Compliance with Principle I (Safety-First Deletion) is checked explicitly before the delete function is ever enabled against real (non-test) files — this is the one gate that is never skipped regardless of schedule pressure.

**Version**: 1.0.0 | **Ratified**: 2026-08-31 | **Last Amended**: 2026-08-31
