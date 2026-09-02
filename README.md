# Mac Storage Cleanup Dashboard

A local, single-user dashboard that shows where a Mac's disk space is actually going — a real, recursive folder browser (treemap or list) sized by real disk usage, inline cleanup flags on anything the deterministic rules think is safe to remove, and safe, confirmed, real deletion (Trash-only, never permanent).

Built for personal use on Deepak's MacBook, and doubles as a demo artifact for a job application (Lyzr AI, Developer & Automations Specialist).

## Running it

**Double-click `start.command`** at the repo root. It starts the dev server and opens the dashboard in your browser automatically — no terminal needed.

To run it manually instead:

```bash
cd web
npx next dev --webpack
```

(`--webpack`, not the default Turbopack — this project lives on a Google Drive-mounted path, which breaks Turbopack.)

The **first scan** takes several minutes (a real recursive walk of `$HOME` + `/Applications`) — the app shows an empty state until it's run once, and a "Refresh" button to re-scan on demand afterward.

**Full Disk Access**: without it, folders like `~/Library/Mail`, Messages, Photos, and Safari silently read as 0 bytes. If the app shows a restricted-folders banner, it names the exact app to grant access to (it walks the real process tree to find out) — follow that link, add the named app under System Settings → Privacy & Security → Full Disk Access, then fully quit and reopen that app before scanning again.

## How it works

One page, two modes (a tab, not a drill level):

- **Browse** — real folders only, starting from your home directory. Every click drills into a real folder's real children, however deep. Category (Documents, Developer, System Data, etc.) is shown as a color tint on each item — computed from real disk data, but purely a color hint, never something you click through. If a folder's category looks wrong, fix it with the dropdown next to Protect — it sticks on every future scan.
- **Clean up** — the flagged list: stale `node_modules`, old Xcode build caches, forgotten Downloads installers, duplicate files, and large files nobody's touched in months. Each item shows why it was flagged and a Safe/Caution confidence tag.

Selecting items works the same way in both modes and persists as you navigate — pick something while browsing, switch to Clean up, pick something else, then delete both at once. Nothing is ever removed without an explicit confirmation showing the exact paths and total size, and everything goes to Trash, never a permanent delete.

**Protect** marks a path as never-touchable, permanently. **AI Suggestions** (optional, needs an `ANTHROPIC_API_KEY` environment variable — absent by default) offers a second opinion on anything you've selected that the deterministic rules didn't already flag; the rest of the app works identically with or without it configured.

## Where the data lives

Everything real this tool produces stays in `web/data/` (gitignored):

- `data/scans/<timestamp>/` — one folder per scan: a `meta.json` summary plus one small listing file per directory visited (never one giant tree file)
- `data/deletes/<timestamp>.json` — an audit log entry per completed deletion (path, size, when)
- `data/protected-paths.json` — paths marked Protect
- `data/category-overrides.json` — paths whose category was fixed manually via the dropdown
- `data/index.json` — a running index of every scan and delete, newest last
- `data/scheduled-check-state.json` — only present if the opt-in scheduled check (see below) has run at least once

Only the 10 most recent scans are kept; older ones are pruned automatically.

## Optional: scheduled background check

`scanner/install-schedule.sh` installs a `launchd` job (default: weekly) that re-scans in the background and sends a macOS notification only if newly-reclaimable space crosses a threshold (default 1 GB) since the last check. **Opt-in only** — never installed automatically. Run `scanner/uninstall-schedule.sh` to remove it. Note: the background job runs under its own process identity, so it needs its own Full Disk Access grant separate from whatever app you normally launch the dashboard from.

## Project process

This project is built with [Spec Kit](https://github.com/github/spec-kit) — spec-driven development. The full process lives in `specs/001-mac-storage-cleanup/`:

- `spec.md` — what the tool does, in plain language (4 user stories, functional requirements, success criteria)
- `plan.md` — the technical plan (stack, project structure, constitution compliance)
- `research.md` — the technical decisions and why (scan strategy, last-used data, iCloud detection, dedup, deletion mechanism)
- `data-model.md` — the data shapes
- `contracts/api.md` — the internal API routes
- `design-brief.md` — the UX/visual direction
- `tasks.md` — the ordered build log — every task, what was actually built, every real bug found and how it was fixed, kept up to date as the source of truth for project status

The project's non-negotiable rules (Trash-only deletion, real data only, bottom-up explained build, etc.) live in `.specify/memory/constitution.md`.

## Status

All 4 user stories (see spec.md) are built. See `specs/001-mac-storage-cleanup/tasks.md` for the exact task-by-task state and history — including two real design corrections (the interaction model was rebuilt twice in one day after live review) and every real bug found through actual testing on this Mac, not just code review.

## App

The actual application lives in `web/`.
