# Design Brief: Mac Storage Cleanup Dashboard

Companion to `spec.md` / `plan.md` — this is the visual/UX direction for the frontend (Phase 3+ of `tasks.md`), produced via the `shape` skill using the context in `.impeccable.md`.

## 1. Feature Summary

A local dashboard that shows Deepak exactly where his 250GB disk's space is going, lets him drill into any folder down to individual files, and lets him safely delete reclaimable space — with real scanned data throughout and an irreversible-feeling action (delete) that earns real visual weight.

## 2. Primary User Action

See the largest reclaimable opportunity at a glance, then act on it with confidence that nothing is deleted by accident.

## 3. Design Direction

Precise, calm, technical — a diagnostic tool, not a consumer app. Dark theme. The treemap's real proportions and category colors are the interface's visual center of gravity; everything else (nav, labels, the Cleanup list) stays quiet and gets out of its way. The one deliberate exception is the delete confirmation, which is allowed to be the most visually assertive moment in the whole app, precisely because it's the one moment that matters most to get right.

## 4. Layout Strategy

- **Treemap view (`/`)**: the treemap fills nearly the whole viewport — it IS the page, not a widget on a page. A slim header above it carries the total size, last-scan timestamp, and the Refresh action — small, out of the way, present when needed.
- **Drill-down (`/browse/[...path]`)**: same treemap component, re-rendered for the current folder's children, with a breadcrumb trail (not a "back" button alone) so depth is always legible. Selecting a leaf file swaps a thin detail rail in rather than opening a modal.
- **Cleanup (`/cleanup`)**: two visually distinct zones stacked, not tabbed — rule-based flags first (higher trust, denser list), AI Suggestions section below it with a visibly different register (see Design Principle 4). No card-per-item; a dense, scannable list with inline size/reason/confidence, closer to a file listing than a dashboard widget grid.
- General rhythm: tight spacing within a list, generous spacing between the header/treemap/footer zones — hierarchy through spacing contrast, not boxes.

## 5. Key States

- **No scan yet (first launch)**: empty state that explains what to do (press Refresh) rather than showing a blank treemap — teaches the interface per Design Principle in `.impeccable.md`.
- **Scanning in progress**: the Refresh action shows real progress feedback (elapsed time at minimum, since a full scan can take real time) — never a generic spinner with no information.
- **Loaded treemap**: the default/primary state — real proportions, real labels, real GB.
- **Drilled into a folder**: same treemap logic, breadcrumb shows depth, a restricted-folder state shown inline (not hidden) when permission is denied.
- **Cleanup — flagged list loaded**: rule-based items with reason + confidence; AI Suggestions section either populated, empty ("no suggestions this pass"), or absent/"unavailable" when no API key is set — three distinct, honest states, never a fake-empty placeholder.
- **Delete confirmation**: the highest-weight moment in the app — exact paths, exact total size, explicit confirm action, easy to cancel.
- **Delete result**: per-item success/skip feedback (a skipped item — e.g. "no longer exists" — must be visible, not swallowed), plus the freed-space number once the next Refresh runs.

## 6. Interaction Model

- Refresh is an explicit, deliberate action (button, not automatic) — matches the tool's manual-refresh philosophy (constitution Principle VI) and gives the "precise, calm" feeling of a tool that does exactly what you asked, when you asked.
- Clicking a treemap rectangle drills in; clicking a file (leaf node) opens the detail rail, not a modal (per the impeccable "avoid modals unless necessary" rule) — the delete confirmation is the one deliberate exception, because that specific interruption is earned.
- Selecting Cleanup items is additive (checkbox-style multi-select), with a persistent, always-visible running total of size selected — so the user always knows what they're about to commit to before reaching the confirmation step at all.
- Hover/focus states on treemap rectangles surface the exact GB figure and category — the treemap communicates through direct manipulation, not a separate legend the user has to cross-reference.

## 7. Content Requirements

- Empty state copy: teaches, doesn't just say "no data" (e.g., "Run your first scan to see where your space is going").
- Cleanup reason text comes straight from each rule's `reason` field (data-model.md) — written to be understood without jargon (e.g., "Build cache from Xcode, safe to remove and will be regenerated" rather than "DerivedData artifact").
- AI Suggestion rationale is shown verbatim (per FR-016/FR-017) but visually framed as a suggestion, not a fact — copy around it should say "worth a look," never "should delete."
- Delete confirmation copy states the total size and item count as the first thing read, before the path list itself.
- Skipped-item messaging must be specific ("no longer exists" / "outside allowed location"), never a generic "failed."

## 8. Recommended References

For implementation (T009-T010, T014, T020, T023): `spatial-design.md` (the treemap and drill-down are genuinely complex layout problems), `interaction-design.md` (the Cleanup selection + confirmation flow is the most interaction-heavy part of the app), `motion-design.md` (sparingly — the drill-down transition and the delete-confirmation entrance are the two moments that earn motion).

## 9. Open Questions

- Exact color palette and type pairing are deliberately left to build time (T009/T010) per `.impeccable.md`, rather than pre-decided here — to be chosen fresh against the impeccable font/color procedure, not defaulted.
- Whether the detail rail (file click) is a slide-in panel or an inline expansion is an implementation-time call, not a product decision — resolve during T014.
