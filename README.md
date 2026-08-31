# Mac Storage Cleanup Dashboard

A local, single-user dashboard that shows where a Mac's disk space is actually going — a treemap breakdown by category (matching macOS Storage settings), drill-down to individual files with size and last-used dates, and safe, confirmed, real deletion of reclaimable space.

Built for personal use on a 250GB MacBook, and doubles as a demo artifact for a job application (Lyzr AI, Developer & Automations Specialist).

## Project process

This project is built with [Spec Kit](https://github.com/github/spec-kit) — spec-driven development. The full process lives in `specs/001-mac-storage-cleanup/`:

- `spec.md` — what the tool does, in plain language (4 user stories, functional requirements, success criteria)
- `plan.md` — the technical plan (stack, project structure, constitution compliance)
- `research.md` — the technical decisions and why (scan strategy, last-used data, iCloud detection, dedup, deletion mechanism)
- `data-model.md` — the data shapes
- `contracts/api.md` — the internal API routes
- `design-brief.md` — the UX/visual direction
- `tasks.md` — the ordered, bottom-up build plan

The project's non-negotiable rules (Trash-only deletion, real data only, bottom-up explained build, etc.) live in `.specify/memory/constitution.md`.

## Status

Boilerplate stage — Next.js app scaffolded, no features built yet. Build proceeds task-by-task per `tasks.md`, starting with the scanner.

## App

The actual application lives in `web/` — see `web/README.md` once scaffolded for how to run it.
