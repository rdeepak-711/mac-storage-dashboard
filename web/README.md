# Mac Storage Cleanup Dashboard — app

The Next.js app itself. See the repo root `README.md` and `specs/001-mac-storage-cleanup/` for the full spec, plan, and design brief this is built from.

## Stack

Next.js (App Router) + TypeScript + Tailwind, `d3-hierarchy` for the treemap layout, `trash` for safe Finder-style deletion. No database — real disk data lives under `data/` (gitignored) as timestamped JSON files, one per scan/delete run.

## Running it

```bash
npm run dev
```

Then open http://localhost:3000. (A double-click `start.command` launcher gets added once T011 is built — for now, run it from the terminal.)

## Status

Boilerplate only — default Next.js starter page, no features yet. Build proceeds task-by-task per `../specs/001-mac-storage-cleanup/tasks.md`, starting with the scanner (T005-T007).
