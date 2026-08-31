import path from "node:path";

/**
 * Maps an absolute path to one of the 9 Category ids from
 * specs/001-mac-storage-cleanup/data-model.md. Pure function — no fs
 * access — so it's cheap to call once per top-level entry during the scan
 * (scan.mjs) and easy to verify in isolation (see the manual check in T007).
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
 * would be miscategorized as "system-data". We detect the CloudStorage
 * mount, skip past the provider + sync-root segments (e.g.
 * "GoogleDrive-me@x.com/My Drive"), and categorize what's inside using
 * the same rules as a normal home directory.
 */

const RECLAIMABLE_BASENAMES = new Set(["node_modules", "DerivedData", ".Trash"]);
const CLOUD_SYNC_ROOT_NAMES = new Set(["My Drive", "iCloud Drive"]);

function categorizeBySegments(segments) {
  if (segments[0] === "Documents") return "documents";
  if (segments[0] === "Applications") return "applications";
  if (segments[0] === "Pictures") return "photos";
  if (segments[0] === "Music") return "music";
  if (segments[0] === "Library" && segments[1] === "Mail") return "mail";

  if (
    segments[0] === "Developer" ||
    segments[0] === "Projects" ||
    segments[0] === "projects" ||
    segments[0] === "code" ||
    (segments[0] === "Library" && segments[1] === "Developer")
  ) {
    return "developer";
  }

  if (segments[0] === "Library") return "system-data";

  return "other";
}

export function categorize(absolutePath, homeDir = process.env.HOME ?? "") {
  const allSegments = absolutePath.split(path.sep);

  // Check every path segment, not just the basename — a reclaimable
  // directory's own contents (e.g. everything under .../DerivedData/App-abc)
  // must inherit the same category as the directory itself.
  if (allSegments.some((seg) => RECLAIMABLE_BASENAMES.has(seg))) return "reclaimable";

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
