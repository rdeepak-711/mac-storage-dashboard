# Feature Specification: Mac Storage Cleanup Dashboard

**Feature Branch**: `001-mac-storage-cleanup`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "A dashboard for Mac storage. Deepak's MacBook is 250GB. Split storage into categories the way macOS Storage settings does (Documents, Applications, Developer, Photos, System Data, etc.), visualized as a treemap (nested rectangles sized by GB, like a stock-market heatmap). Drill down into what's stored where and when it was last used. Show what can be deleted to free up space, and actually delete it from the app with confirmation. Personal cleanup tool that also doubles as a demo artifact for a job application."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See where disk space is actually going (Priority: P1)

Deepak opens the dashboard and immediately sees a visual breakdown of his 250GB disk: how much is Documents, Applications, Developer files, Photos, System Data, and any other major category — sized proportionally, colored by category, in a treemap layout he can scan at a glance instead of reading a list of numbers.

**Why this priority**: This is the entire reason the tool exists — without a trustworthy, at-a-glance picture of where space is going, nothing else in the tool has a foundation. It is also the minimum slice that is independently useful (macOS's own Storage pane does roughly this today) and the minimum slice worth demoing.

**Independent Test**: Can be fully tested by opening the dashboard against a real scan of Deepak's disk and confirming the categories and their sizes match what Finder / macOS Storage settings report for the same disk, within reasonable rounding.

**Acceptance Scenarios**:

1. **Given** a completed scan of the disk, **When** Deepak opens the dashboard, **Then** he sees a treemap where each top-level category is a rectangle sized proportionally to the space it uses, labeled with its name and size in GB.
2. **Given** the dashboard is open, **When** Deepak presses "Refresh", **Then** the tool re-scans the disk and the treemap updates to reflect current sizes.
3. **Given** no scan has ever been run, **When** Deepak opens the dashboard, **Then** he sees a clear empty/pending state (never fabricated or placeholder numbers) prompting him to run a scan.

---

### User Story 2 - Drill into any category down to individual files (Priority: P2)

Deepak clicks into a category (e.g. "Developer") and sees its contents broken down the same way, recursively — folder by folder, down to individual files — with each item's size and when it was last used (last modified, and last opened where the system tracks it).

**Why this priority**: A category total alone doesn't tell Deepak what to actually do — he needs to find the specific large, stale item before he can decide to remove it. This is the step between "seeing the problem" (P1) and "acting on it" (P3).

**Independent Test**: Can be fully tested by drilling into a folder with known contents and confirming every child item, its size, and its last-used date are shown correctly and match what Finder's Get Info reports for the same items.

**Acceptance Scenarios**:

1. **Given** a category rectangle in the treemap, **When** Deepak clicks it, **Then** the view drills into that folder and renders its children as a new treemap, with a way to go back up.
2. **Given** Deepak is viewing any file or folder, **When** he looks at its detail, **Then** he sees its size, last-modified date, and last-opened date if the system has tracked one.
3. **Given** a folder Deepak lacks permission to read, **When** he drills into its parent, **Then** that folder is shown with its size (if determinable) and a clear "restricted" indicator instead of silently omitting it or crashing the scan.

---

### User Story 3 - Find and safely delete reclaimable space (Priority: P3)

Deepak opens a "Cleanup" view that highlights items the tool believes are safe or likely-safe to remove (caches, stale build artifacts, old installers, Trash contents, long-untouched large files), selects the ones he wants gone, sees exactly what will be deleted and how much space it will free, confirms, and the tool removes them.

**Why this priority**: This is the payoff step — it's what actually frees up disk space — but it depends on P1 and P2 existing first, and it is the step with real, irreversible-feeling consequences if built without the safety guarantees the earlier stories establish trust for.

**Independent Test**: Can be fully tested by flagging a controlled set of disposable test files, deleting them through the app, and confirming they moved to Trash (not permanently deleted), the freed space is reflected in a subsequent scan, and the action is recorded in a log Deepak can review.

**Acceptance Scenarios**:

1. **Given** a completed scan, **When** Deepak opens the Cleanup view, **Then** he sees a list of flagged items, each with its path, size, why it was flagged, and a confidence label.
2. **Given** Deepak has selected one or more flagged items, **When** he clicks Delete, **Then** he sees a confirmation showing the exact file paths and total size, and nothing is deleted until he explicitly confirms.
3. **Given** Deepak confirms a deletion, **When** the action completes, **Then** the selected items are moved to Trash (recoverable), the dashboard reflects the freed space, and the action is appended to a persistent log.
4. **Given** a flagged item sits outside the tool's allowed deletion boundary (e.g. inside `/System`), **When** Deepak attempts to delete it, **Then** the tool refuses and explains why, regardless of how the item was flagged.
5. **Given** a selected file no longer exists at delete time (e.g. removed by something else since the scan), **When** the deletion runs, **Then** the tool reports that item as skipped rather than failing the whole batch or misreporting it as deleted.

---

### User Story 4 - Get AI-reasoned suggestions for ambiguous items (Priority: P4)

Deepak opens the Cleanup view and sees a second, visually distinct section — "AI Suggestions" — listing items the deterministic rules weren't confident enough to flag on their own (e.g. a large old folder with no obvious cache/build-artifact pattern), each with a short written rationale explaining why it might be worth reviewing. Nothing in this section is pre-selected.

**Why this priority**: This is a genuine enhancement over the rule-based flagging, not a requirement the tool depends on — the rule-based Cleanup view (P3) already delivers the core value on its own. It comes last because it is additive and must never be the thing an earlier story's safety guarantees rely on.

**Independent Test**: Can be fully tested by pointing the AI-suggestion layer at a real scan, confirming the suggestions shown are grounded in real metadata from that scan (not fabricated), and confirming the rest of the Cleanup view works identically whether or not this layer is available.

**Acceptance Scenarios**:

1. **Given** a completed scan, **When** Deepak opens the Cleanup view with AI suggestions available, **Then** he sees a distinct "AI Suggestions" section separate from the rule-based flagged list, each entry showing its path, size, and a written rationale.
2. **Given** an AI suggestion, **When** Deepak selects it and confirms deletion, **Then** it goes through the exact same path-level confirmation and Trash-move flow as any rule-flagged item — no separate, lighter-weight delete path exists for AI suggestions.
3. **Given** no AI service is configured or the request fails, **When** Deepak opens the Cleanup view, **Then** the rule-based flagged list still renders and works fully, with the AI Suggestions section simply absent or showing an "unavailable" state — nothing else in the view degrades.

---

### Edge Cases

- What happens when the disk changes between scan and delete (a file grows, moves, or is replaced)? The tool must re-verify a file still matches what was scanned before deleting it, not delete blindly by stale path.
- How does the tool handle iCloud-optimized ("dataless") files that show a placeholder size on disk rather than their real size? These must be labeled distinctly, not counted as if fully local.
- How does the tool handle symlinks and hard-linked files so the same physical data isn't double-counted across categories?
- What happens if a scan is interrupted (app closed mid-scan)? The dashboard must fall back to the last completed scan rather than showing a half-finished, misleading picture.
- What happens if Deepak selects items whose combined deletion would remove more data than currently exists in Trash capacity or otherwise seems unusually large? The confirmation must make the total size impossible to miss before he confirms.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST scan Deepak's disk and produce a categorized breakdown matching the categories macOS Storage settings uses (Documents, Applications, Developer, Photos, System Data, etc.), plus any additional categories needed to account for all used space.
- **FR-002**: System MUST display the breakdown as a treemap: rectangles sized proportionally to space used, colored by category, labeled with name and size.
- **FR-003**: Users MUST be able to trigger a fresh scan on demand ("Refresh") and see the dashboard update to the new results.
- **FR-004**: System MUST allow drilling into any category or folder to see its contents as a nested breakdown, down to individual files, with a way to navigate back up.
- **FR-005**: System MUST show, for any file or folder, its size, last-modified date, and last-opened date where the operating system has tracked one.
- **FR-006**: System MUST identify and flag likely-reclaimable items (e.g. caches, stale build artifacts, old installers, Trash contents, long-untouched large files), each with a stated reason and confidence level.
- **FR-007**: Users MUST be able to select one or more flagged (or manually chosen) items for deletion.
- **FR-008**: System MUST show a confirmation step before any deletion that lists the exact file paths and total size to be removed, and MUST NOT delete anything without explicit confirmation.
- **FR-009**: System MUST perform all deletions by moving files to Trash — permanent, unrecoverable deletion MUST NOT be possible through the app.
- **FR-010**: System MUST refuse to delete anything outside an explicitly allowed boundary (the user's home directory plus known-safe cache locations), even if such an item was flagged.
- **FR-011**: System MUST record every completed deletion (paths, sizes, timestamp) in a log Deepak can review later.
- **FR-012**: System MUST re-verify that a file selected for deletion still exists and still matches what was scanned, and MUST report — not silently skip or misreport — any item that no longer matches at delete time.
- **FR-013**: System MUST clearly distinguish an empty/no-scan-yet state from real data, and MUST NOT display fabricated, sampled, or placeholder figures at any point.
- **FR-014**: System MUST label iCloud-optimized ("dataless") files distinctly from fully-local files of the same nominal size.
- **FR-015**: System MUST avoid double-counting the same physical data reached via symlinks or hard links within a single scan's totals.
- **FR-016**: System MUST offer an AI-reasoned suggestions section, computed only from scanned metadata (paths, sizes, ages, categories — never file contents), for items the deterministic rules did not confidently flag.
- **FR-017**: AI suggestions MUST be visually distinct from rule-based Cleanup Flags, MUST NOT be pre-selected, and MUST go through the identical path-level confirmation and Trash-move deletion flow as any other item — no separate or lighter-weight delete path may exist for them.
- **FR-018**: The rest of the Cleanup view MUST function fully and normally when the AI-suggestion layer is unavailable (no service configured, or the request fails) — its absence MUST NOT block or degrade the rule-based flagging.

### Key Entities

- **Scan Snapshot**: The result of one completed disk scan — a timestamp plus a tree of entries covering everything counted in that scan. The dashboard always renders from the latest snapshot, never live disk state.
- **Storage Entry**: A single file or folder node in the scan tree — path, size, category, last modified date, last opened date (if known), and flags such as "restricted" or "iCloud-optimized".
- **Category**: A top-level grouping (Documents, Applications, Developer, Photos, System Data, etc.) that every Storage Entry rolls up into, matching macOS's own storage categorization.
- **Cleanup Flag**: An association between a Storage Entry and a reason it was identified as reclaimable, including a confidence level ("safe" vs. "caution").
- **AI Suggestion**: An association between a Storage Entry and an AI-written rationale for why it might be worth reviewing, distinct from a Cleanup Flag and carrying its own, deliberately lower-trust confidence tier.
- **Delete Log Entry**: A permanent record of one completed deletion — path, size, and timestamp — independent of the Scan Snapshot it originated from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Deepak can identify the single largest reclaimable opportunity on his disk within 2 minutes of opening the dashboard.
- **SC-002**: The total space reported by the dashboard matches macOS's own Storage settings total within 5%, accounting for the categorization differences between the two.
- **SC-003**: Deepak can go from opening the Cleanup view to freed disk space, confirmed and reflected in the dashboard, in under 5 minutes for a typical cleanup session.
- **SC-004**: Zero unintended or permanent deletions occur — every deletion in normal use is recoverable from Trash, and every deletion is traceable afterward via the delete log.
- **SC-005**: A person unfamiliar with the tool can understand what it does and why a given item was flagged for cleanup within a 2-3 minute walkthrough, without needing implementation detail.

## Assumptions

- Single user, single machine (Deepak's own MacBook), run locally — no multi-user accounts, no authentication, no remote/cloud access to the tool.
- The scan covers Deepak's home directory plus the same system-managed areas macOS Storage settings reports on (Applications, System Data, etc.) — it does not need to enumerate every file on the entire root filesystem to satisfy the categorization macOS itself uses.
- "Refresh" is a manual, on-demand action — there is no requirement for a live-updating background scan or file-system watcher in this version.
- External/removable volumes are out of scope for this version; only the internal boot disk is scanned.
- The tool runs directly on Deepak's own machine with his own user permissions — it is not expected to gain elevated/root access to read or delete anything a standard user account cannot already reach.
- The AI-suggestion layer (User Story 4) requires an Anthropic API key Deepak provides himself; the tool does not ship with one, and its complete absence is a supported, fully-functional state, not an error condition.
