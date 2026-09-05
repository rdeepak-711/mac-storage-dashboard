import path from "node:path";
import { findOverrideCategory } from "../lib/category-overrides.mjs";

/**
 * Maps an absolute path to one of the Category ids from
 * specs/001-mac-storage-cleanup/data-model.md. Pure function — no fs
 * access — so it's cheap to call once per top-level entry during the scan
 * (scan.mjs) and easy to verify in isolation (see the manual check in T007).
 *
 * Simplified 2026-09-03 from 9 categories down to the ones Deepak said
 * actually map to how he navigates his own disk: Documents, Downloads,
 * Desktop, Applications, Developer, plus the functional catch-alls
 * Reclaimable and Other. See Category's doc comment in scan-types.ts.
 *
 * "reclaimable" is deliberately narrow here: only locations that are
 * unambiguously junk regardless of contents (Trash, caches, build
 * artifacts). Anything merely *old* or *large* is a judgment call for
 * scanner/reclaim-rules.mjs (T016) at Cleanup-view time, not a scan-time
 * category — the scan should never guess about content, only location.
 *
 * CloudStorage special case: on this machine (and commonly), Google
 * Drive / iCloud Drive Desktop mount synced folders under
 * ~/Library/CloudStorage/<Provider>-<account>/<sync-root>/... — meaning a
 * user's real Documents/Developer/etc. content can physically live inside
 * ~/Library. Without unwrapping this, everything synced through Drive
 * would be miscategorized as "other". We detect the CloudStorage mount,
 * skip past the provider + sync-root segments (e.g.
 * "GoogleDrive-me@x.com/My Drive"), and categorize what's inside using
 * the same rules as a normal home directory. (A dedicated "Google Drive"
 * category — treating the whole sync root as its own bucket rather than
 * unwrapping it — is explicitly a "later, maybe" per Deepak, not built here.)
 */

// ".cache"/".npm" added 2026-09-03 — Deepak pointed out these are a real,
// large (24.5GB combined on his disk) chunk of "unused chunk data" that
// was invisible both as a category (buried in "other") and as a Clean Up
// tab flag (scanner/reclaim-rules.mjs never looked at them as whole
// folders, only individual large/duplicate files that happened to be
// inside). Same treatment as node_modules/DerivedData: purely
// regenerable download/build caches, safe to recolor as reclaimable and
// flag wholesale — see reclaim-rules.mjs's matching rule.
const RECLAIMABLE_BASENAMES = new Set(["node_modules", "DerivedData", ".Trash", ".cache", ".npm"]);
const CLOUD_SYNC_ROOT_NAMES = new Set(["My Drive", "iCloud Drive"]);

function categorizeBySegments(segments) {
  if (segments[0] === "Documents") return "documents";
  if (segments[0] === "Downloads") return "downloads";
  if (segments[0] === "Desktop") return "desktop";
  if (segments[0] === "Applications") return "applications";

  if (
    segments[0] === "Developer" ||
    segments[0] === "Projects" ||
    segments[0] === "projects" ||
    segments[0] === "code" ||
    (segments[0] === "Library" && segments[1] === "Developer")
  ) {
    return "developer";
  }

  // Library (system/app-managed data), Pictures, Music, Mail and
  // everything else all fold into "other" — simplified 2026-09-03, see
  // Category's doc comment in scan-types.ts for why.
  return "other";
}

export function categorize(absolutePath, homeDir = process.env.HOME ?? "", overrides = []) {
  const allSegments = absolutePath.split(path.sep);

  // Check every path segment, not just the basename — a reclaimable
  // directory's own contents (e.g. everything under .../DerivedData/App-abc)
  // must inherit the same category as the directory itself.
  if (allSegments.some((seg) => RECLAIMABLE_BASENAMES.has(seg))) return "reclaimable";

  // A user-fixed category (data/category-overrides.json) wins over every
  // heuristic below — added 2026-09-01 after real data showed the
  // heuristics failing for 93% of Deepak's real top-level folders (none
  // named `Developer`/`Projects`/`code`, the only names the rules below
  // recognize). Checked after reclaimable (a safety-relevant signal tied
  // to the cleanup rules, not just cosmetic) but before everything else.
  if (overrides.length > 0) {
    const override = findOverrideCategory(absolutePath, overrides);
    if (override) return override;
  }

  // Applications can live at the top level ("/Applications/Safari.app")
  // as well as under $HOME ("~/Applications/...") — check before anything
  // else claims "/Applications" via the broader system-data rule.
  if (absolutePath.startsWith("/Applications" + path.sep) || absolutePath === "/Applications") {
    return "applications";
  }

  const rel = homeDir && absolutePath.startsWith(homeDir)
    ? path.relative(homeDir, absolutePath)
    : null;
  const segments = rel !== null ? rel.split(path.sep) : [];

  if (segments[0] === "Library" && segments[1] === "Caches") return "reclaimable";

  if (segments[0] === "Library" && segments[1] === "CloudStorage") {
    // segments[2] is the provider+account dir (e.g. "GoogleDrive-me@x.com");
    // segments[3] is usually the sync-root folder name ("My Drive").
    const syncRootIdx = CLOUD_SYNC_ROOT_NAMES.has(segments[3]) ? 4 : 3;
    return categorizeBySegments(segments.slice(syncRootIdx));
  }

  return categorizeBySegments(segments);
}
