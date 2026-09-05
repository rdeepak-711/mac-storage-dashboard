# Decisions

Rationale log. Not a changelog — git already records what changed; this records *why*, what else was considered, and what it costs. Never delete a superseded entry: mark it reversed and say what changed.

---

## 2026-09-04 — Trash contents are now actually excluded from flagging, not just documented as excluded

**What was decided.** `scanner/reclaim-rules.mjs` already had a comment stating that items inside `~/.Trash` must never be flagged as cleanup candidates (moving something already in Trash to Trash again doesn't empty it, and emptying Trash is the one thing this codebase bans everywhere). That comment described intent with no code enforcing it. New `lib/recoverability.mjs:isInsideTrash()` closes the gap, called at the same point as the existing `hasRecoverableAncestor()` check, plus the same two-layer pattern used for the sensitive-path bug: the duplicate-candidate gate in `scan.mjs` and the final choke point in `boundFlags()` both now also exclude Trash paths.

**What else was considered.** Nothing — found and fixed in one pass, same as the `isInsidePackage()` bug from the day before.

**Why this won.** Found by a real Playwright walkthrough of the live app while prepping a demo recording: `~/.Trash/huggingface` and `~/.Trash/uv` — both moved to Trash the day before — showed up as freshly "SUGGESTED," because a basename like `huggingface` inside `.Trash` still matched the `redownload` tier same as it would anywhere else. Nothing in `evaluate()` ever checked whether a path was already inside Trash.

**What it costs.** Nothing measurable — these were never legitimate candidates; a comment describing safety that the code doesn't implement is arguably worse than no comment, since it invites trusting a guarantee that isn't there. This is the second time review-by-actually-running-it (this bug, plus the sensitive-path bypass and the package/dist bugs from 2026-09-03) caught something a design review and unit-level check both missed.

---

## 2026-09-03 — Replaced `confidence: "safe" | "caution"` with a three-field recoverability model

**What was decided.** Every cleanup flag used to carry one word, `confidence`, either `"safe"` or `"caution"`. That's gone. A flag now carries three independent facts: `recoverability` (`instant` / `redownload` / `irreplaceable` — how it comes back), `activity` (`active` / `idle` / `stale` — when it was last touched), and `disposition` (`suggested` / `review` — whether the tool will bulk-offer it, or only show it for a human decision). The `reason` shown to the user is generated from these, never hand-written per rule.

**What else was considered.** Keeping `confidence` and just tightening the age gate on the two rules that abused it (`.cache`, `.npm`). Rejected: the problem wasn't a missing age gate, it was that "safe" was answering two different questions at once — *is anything permanently lost* and *is this cheap to get back* — and no single word can carry both without lying about one of them.

**Why this won.** Deepak asked for a distinction between disposable cache and important data, using Brave's passwords as the example. Investigating found that specific danger didn't exist in this codebase (`~/.cache` had no browser data; Brave's passwords were never flagged by anything). But a real defect of the identical shape did: `~/.cache` and `~/.npm` were each flagged wholesale as `confidence: "safe"` with no age gate — accepting one flag would have deleted 5.6 GB of HuggingFace models. The three-field model says the true thing in both directions: `suggested` items are provably regenerable and safe to bulk-delete; `review` items (added specifically because the old model had no way to say "I don't know, but this is big and old") surface ~19 GB of abandoned tooling — `.vscode` untouched since 2025-09-28, `.cursor`, `.kiro` — that the old model would have stayed completely silent about, because it could only say "safe" or "caution," never "I can't tell, you decide."

**What it costs.** More surface area: three fields and a disposition instead of one word, a `review` list to also render in the UI (never pre-selected, never bulk-deletable — see the constitution amendment), and a `costSentence()` function instead of a static string. Every existing consumer of `confidence` (`ListLevel.tsx`, `TreemapLevel.tsx`, `cleanup-flags.ts`, `ai-eval.mjs`) had to be updated in the same change, since there was no way to keep both fields meaningfully in sync.

**See also:** `docs/superpowers/specs/2026-09-03-recoverability-and-never-suggest-design.md`, constitution v1.4.0 → v1.5.0.

---

## 2026-09-03 — Added a built-in never-suggest registry, separate from Protected Paths

**What was decided.** A new file, `lib/sensitive-paths.mjs`, hard-codes paths the tool must never flag or delete: SSH/GPG/AWS keys, saved auth tokens, the macOS Keychain, and every app profile directory (where browsers keep logins, cookies and passwords). It's checked at two points — flag generation and the delete guard — and the delete guard is the one that actually matters, since flag generation is one bug away from failing (and, on the first real scan, did: the `duplicate-file` rule bypassed it entirely and offered Brave's IndexedDB and VS Code's workspace state as duplicates before this was caught).

**What else was considered.** Just relying on the existing Protected Paths feature — ask Deepak to manually protect `~/.ssh`, `~/Library/Application Support/BraveSoftware`, etc. Rejected: Protected Paths is empty by default and depends on the user having thought to add something. The whole point here was a guarantee that doesn't depend on that — including on a future machine where nobody has protected anything yet.

**Why this won.** Same guarantee, but built into the tool rather than into the user's diligence. Protected Paths stays for exactly what it's good at: Deepak's own judgment calls about specific paths he wants walled off. The registry covers the class of thing no one should ever have to remember to protect.

**What it costs.** ~46 GB of `Application Support` / `Containers` / `Group Containers` is now permanently un-suggestable, even the genuinely disposable parts of it, because the registry can't cheaply tell an app's cache from its credential store within those directories — it walls off the whole profile root. Broad on purpose: the cost of losing that ground is smaller than the cost of being clever near passwords.

---

## 2026-09-03 — Deferred the Places view (top-level regrouping) to a later milestone

**What was decided.** Not building, this round: renaming the dashboard's top level from the real folder tree to synthetic groupings like "Projects" / "App Data" / "Rebuildable" / "macOS System."

**What else was considered.** Building it now, since it was the more interesting half of the original design conversation and directly answers "I can't tell what `~/Library` even is."

**Why this won.** Three reasons. It's synthetic data layered over real data, which sits in tension with Constitution Principle II (Real Data Only) in a way that needs its own careful design, not a rushed one. The version sketched during design review contained an unresolved contradiction — it moved `firestormInternet` and `portfolio` out of Desktop into a "Projects" place while simultaneously arguing `node_modules` must stay physically inside its project, i.e. the same physical-vs-lens question answered two different ways in the same design. And it's roughly a week of work against a hard end-of-September deadline for the Lyzr application artifact, versus the ~1 day the recoverability fix actually took.

**What it costs.** The dashboard's top level still shows `~/Library` as one 90 GB row that means nothing to Deepak at a glance, which was half of the original complaint. That half is unaddressed until this milestone is picked up.

---

## 2026-09-03 — `dist` / `build` / `target` removed from the instant-recoverability table

**What was decided.** These three generic build-output names were in the `instant` tier (rebuilt locally, no network) until the first real full-disk scan. Removed.

**What else was considered.** Keeping them and special-casing "but not inside node_modules / an installed package." Rejected for this round as unnecessary complexity — YAGNI — when simply removing the generic names costs almost nothing (a handful of real project `dist`/`build` folders go unflagged rather than flagged) and removes the failure mode entirely.

**Why this won.** The real scan found `~/.vscode/extensions/ms-python.vscode-pylance-2026.3.1/dist` tagged `instant` — "rebuilt locally in seconds, no download." It is shipped code inside a downloaded VS Code extension; nothing on the machine can rebuild it. The scanner has no cheap way to tell a project root's build output from a vendored package's internals, so the names that only mean "build output" *at a project root* were removed rather than guessed at.

**What it costs.** A stale `dist` or `build` folder at the root of one of Deepak's own projects no longer gets suggested automatically; it would need to clear the `stale-large-file` review bar on its own merits (500 MB+, 90+ days) to surface at all.

---

## 2026-09-03 — `stale-large-file` excludes anything inside an installed package

**What was decided.** New check, `isInsidePackage()`: a file inside a `.app` bundle, `.framework`, `node_modules`, `.venv`/`venv`, `site-packages`, `Pods`, or similar is never eligible for the "large file untouched for 90+ days" rule, regardless of size or age.

**What else was considered.** Nothing — this was found and fixed in one pass, not weighed against an alternative. The bug was severe enough that the fix was obviously correct once seen.

**Why this won.** The rule's premise — "old and untouched means probably forgotten" — is true for a user's own files and false for anything an installer wrote once and never touches again. The real scan's output before this fix included `/Applications/Docker.app/Contents/Resources/linuxkit/boot.img` (600 MB, "untouched for 300+ days"), three separate Electron Framework binaries, and a Playwright driver binary inside a project's own `.venv`. A file's mtime being its build date is not evidence of disuse.

**What it costs.** Nothing measurable — the files this excludes were never legitimate cleanup candidates in the first place; this closes a false positive, not a real capability.
