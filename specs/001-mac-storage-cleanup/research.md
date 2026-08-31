# Phase 0 Research: Mac Storage Cleanup Dashboard

## Scan traversal strategy

**Decision**: Use `fs.promises.readdir(dir, { withFileTypes: true })` recursively in plain Node, not shelling out to `du` for the full walk.

**Rationale**: `withFileTypes` avoids a separate `fs.stat` call just to know if an entry is a directory, which is the main cost in a large recursive walk. Shelling out to `du -sh` per directory is fast for a handful of top-level folders (used later, see below) but spawning a process per directory across hundreds of thousands of files is far slower than an in-process walk. Doing the walk in Node also means the exact same code path can build the full Storage Entry tree (path, size, category, dates) in one pass instead of parsing `du` text output and then re-stat-ing everything anyway.

**Alternatives considered**: Shell out to `du` for everything — rejected, process-spawn overhead dominates at scale. Use a native/compiled walker (e.g. a Rust helper) — rejected by Constitution Principle IV (reuse existing stack); not justified for a single-user tool.

## "Last used" data

**Decision**: `fs.stat().mtime` (modified date) is always read and shown as the primary signal. `mdls -name kMDItemLastUsedDate -raw <path>` is queried as a secondary, best-effort signal, shown alongside when present.

**Rationale**: `mtime` is available for every file with zero extra cost since `stat` already ran. Spotlight's `kMDItemLastUsedDate` is the closest thing macOS has to real "last opened," but it's only populated for files Spotlight has indexed being opened through normal app/Finder flows, and querying it means one `mdls` process spawn per file — too slow to run for every single file in a 250k-file scan. `mdls` lookups are deferred to on-demand, per-file calls made only when the user drills into a specific file's detail (User Story 2), not during the bulk scan.

**Alternatives considered**: Bulk-querying Spotlight's metadata store — rejected, no stable public bulk API for this from Node without extra native tooling. Skipping `kMDItemLastUsedDate` entirely — rejected, the spec (FR-005) requires showing it where available.

## iCloud-optimized ("dataless") file detection

**Decision**: Compare `fs.stat().size` (logical/nominal size) against `fs.stat().blocks * 512` (actual bytes allocated on disk). When allocated bytes are near-zero for a nonzero nominal size, flag the entry as iCloud-optimized/dataless.

**Rationale**: This uses only the standard `stat` struct fields Node's `fs.stat` already exposes — no extra syscalls, no dependency on `brctl` or private APIs. It directly reflects the real thing the spec cares about (FR-014): a file that claims space it isn't actually using on this disk.

**Alternatives considered**: Calling `brctl status` — rejected, undocumented/unstable CLI not meant for scripting. Reading Spotlight's `kMDItemFSHasCustomIcon`/ubiquity keys — rejected, adds an `mdls` call per file, same cost problem as above.

## Symlink / hard-link de-duplication

**Decision**: Track `(dev, ino)` pairs seen during the walk in a `Set`. A file whose `(dev, ino)` was already counted is recorded in the tree for display (so it's not silently missing) but excluded from category size totals.

**Rationale**: `dev` + `ino` uniquely identifies the physical data a hard link points to; symlinks are simply not followed for size purposes (`fs.lstat`, not `fs.stat`, on the walk itself, so a symlink is sized as the tiny symlink object, not recursed into). This satisfies FR-015 without needing any external dependency.

**Alternatives considered**: Following symlinks and using a path-based dedup — rejected, path-based dedup doesn't catch hard links (different paths, same inode) and following symlinks risks infinite loops or scanning outside the intended boundary.

## Deletion mechanism

**Decision**: Use the `trash` npm package, which shells out to `osascript`/Finder's own move-to-Trash on macOS.

**Rationale**: This is the same mechanism Finder itself uses, so files land in the real Trash, are recoverable the same way any Finder-deleted file is, and nothing in the app needs to reimplement Trash semantics (naming collisions, `.Trash` folder structure, etc.). Directly satisfies Constitution Principle I.

**Alternatives considered**: `fs.rm`/`fs.unlink` — explicitly forbidden by the constitution (permanent, unrecoverable). Hand-rolling a move-to-`~/.Trash` — rejected, reinvents something the OS already does correctly and risks subtly wrong behavior (name collisions, permissions) that a maintained package already handles.

## Scan performance target

**Decision**: No fixed number is assumed up front. The first working version of `scanner/scan.mjs` (Phase 1 of the bottom-up build, see plan.md) is timed against Deepak's real disk, and that measured number becomes the documented performance baseline in `quickstart.md`.

**Rationale**: Guessing a performance target before the first real scan runs would violate Constitution Principle II in spirit (no fabricated numbers) even though this is a target, not a result — better to measure once real code exists than commit to an invented figure.

**Alternatives considered**: Assuming a target from generic benchmarks — rejected, disk contents (file count, average file size, external factors like Spotlight indexing load) vary enough that a generic number wouldn't be trustworthy anyway.
