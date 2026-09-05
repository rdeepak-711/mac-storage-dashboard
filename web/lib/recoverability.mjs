import path from "node:path";
import { isSensitive } from "./sensitive-paths.mjs";

/**
 * How a thing comes back if you delete it, how long since you touched
 * it, and what that costs you — the three facts that replaced the single
 * word "safe" on 2026-09-03.
 *
 * WHY THIS EXISTS. scanner/reclaim-rules.mjs used to tag every flag
 * `confidence: "safe" | "caution"`. "Safe" was doing two different jobs
 * at once — *nothing is lost* and *nothing that matters is lost* — and
 * those come apart badly. Accepting one "safe" flag on ~/.cache deleted
 * 5.6 GB of HuggingFace models untouched since 17 July: nothing is
 * permanently lost, and it still costs an hour of re-downloading. Deepak
 * spotted this from the other direction ("even the google sign in and
 * passwords from 1 year are important") and he was right that one word
 * cannot carry the distinction.
 *
 * THE SAFETY INVERSION. The default tier is `irreplaceable`. A path is
 * only `instant` or `redownload` if a table below proves it so by name.
 * Before this change an unrecognised directory fell through to whichever
 * rule matched loosest; now an unrecognised directory is never
 * suggested. Unknown means untouchable. Adding a new tool's cache to
 * this file is a deliberate act, and forgetting to do it fails safe.
 *
 * See docs/superpowers/specs/2026-09-03-recoverability-and-never-suggest-design.md
 */

export const ACTIVE_DAYS = 30;
export const STALE_DAYS = 90;

/** Below this, an item isn't worth a decision at all. */
export const SUGGEST_MIN_BYTES = 100 * 1_000_000; // 100 MB
/** Below this, an unprovable item isn't worth putting in front of you. */
export const REVIEW_MIN_BYTES = 500 * 1_000_000; // 500 MB

/**
 * Regenerated locally from files already on disk. No network, seconds to
 * minutes. Matched on directory basename.
 */
const INSTANT_BASENAMES = new Map([
  ["DerivedData", "Xcode rebuilds this on your next build"],
  ["__pycache__", "Python regenerates this the next time it imports"],
  ["next-swc", "Next.js regenerates this on the next build"],
  [".next", "Next.js regenerates this on the next build"],
  ["tsconfig.tsbuildinfo", "TypeScript regenerates this on the next build"],
]);

/**
 * `dist`, `build` and `target` were in the list above until the first
 * real full-disk run on 2026-09-03 and have been REMOVED. They are only
 * build output at a PROJECT ROOT, and the scanner cannot cheaply tell a
 * project root from the insides of an installed package. The real
 * failure they produced:
 * ~/.vscode/extensions/ms-python.vscode-pylance-2026.3.1/dist was tagged
 * `instant` — "rebuilt locally in seconds" — when it is shipped code
 * inside a downloaded extension that nothing on this machine can
 * rebuild. Site-packages, node_modules (guarded separately) and every
 * vendored dependency have the same shape. Claiming a rebuild that
 * cannot happen is precisely the lie this whole change exists to remove,
 * so the generic names are gone rather than special-cased.
 */


/**
 * Regenerated only by fetching over the network. Every size figure in
 * the comments is real, measured on Deepak's disk 2026-09-03 — they are
 * why this tier exists rather than being folded into "safe".
 *
 * `gated` means "a recent mtime here really does mean you are using
 * this, so don't suggest it". That is true of node_modules and Pods: a
 * fresh mtime means you are working in that project right now, and
 * deleting its dependencies mid-work is hostile even though they
 * reinstall.
 *
 * It is FALSE for every pure download cache, and getting this wrong was
 * a real bug caught on 2026-09-03 during the first real-data run of this
 * file. A cache directory's mtime bumps when ANY single entry is added,
 * so one `npx` invocation last week marked all 3.6 GB of ~/.npm/_npx
 * "active", and one `uv` run marked all 3.1 GB of ~/.cache/uv the same
 * way — 6.7 GB hidden because of one recent file each. That is the
 * identical mistake this whole change exists to fix: judging a container
 * by one fact about the container instead of by its contents. For these,
 * activity is reported to the user as information, never used as a gate.
 */
const REDOWNLOAD_BASENAMES = new Map([
  ["node_modules", { what: "JavaScript dependencies", restore: "npm install", gated: true }],
  ["Pods", { what: "CocoaPods dependencies", restore: "pod install", gated: true }],
  ["_cacache", { what: "npm's package download cache", restore: "npm cache clean --force", gated: false }], // 7.6 GB
  ["_npx", { what: "cached one-off npx packages", restore: null, gated: false }], // 3.6 GB
  ["_prebuilds", { what: "prebuilt native npm binaries", restore: null, gated: false }],
  ["huggingface", { what: "downloaded ML models", restore: null, gated: false }], // 5.6 GB
  ["uv", { what: "uv's Python package cache", restore: "uv cache clean", gated: false }], // 3.1 GB
  ["pip", { what: "pip's Python package cache", restore: "pip cache purge", gated: false }],
  ["puppeteer", { what: "a downloaded headless Chromium", restore: null, gated: false }], // 539 MB
  ["ms-playwright", { what: "downloaded Playwright browsers", restore: null, gated: false }], // 1.5 GB
  ["ms-playwright-mcp", { what: "downloaded Playwright browsers", restore: null, gated: false }], // 2.5 GB
  ["whisper", { what: "downloaded Whisper speech models", restore: null, gated: false }], // 704 MB
  ["Homebrew", { what: "Homebrew's downloaded package archives", restore: "brew cleanup", gated: false }],
  ["pnpm", { what: "pnpm's package store", restore: "pnpm store prune", gated: false }],
  ["node-gyp", { what: "downloaded Node headers for native builds", restore: null, gated: false }],
  ["vscode-ripgrep", { what: "a downloaded ripgrep binary", restore: null, gated: false }],
  ["prisma", { what: "downloaded Prisma engine binaries", restore: null, gated: false }],
  ["chroma", { what: "downloaded Chroma model files", restore: null, gated: false }],
  ["yt-dlp", { what: "yt-dlp's cache", restore: null, gated: false }],
]);

/**
 * True if any ANCESTOR of this path is itself a recoverable container —
 * i.e. something we would flag in its own right.
 *
 * Necessary because scanner/scan.mjs walks every directory on the disk
 * with no depth limit, and evaluates each one. Without this guard,
 * `.../node_modules/some-pkg/dist` matches the `instant` tier and
 * `~/.cache/huggingface/blobs` matches nothing but its siblings do —
 * producing thousands of nested flags for space already counted by the
 * one flag on the container above them. Deleting the container deletes
 * them; listing them separately is noise and double-counting.
 *
 * Pure string logic on the path's own segments, so it needs no state
 * threaded through the walk and cannot get out of step with the tables.
 */
/**
 * True if any segment of absPath is `.Trash`.
 *
 * BUG, found 2026-09-04 via a real screenshot review before recording a
 * demo video: the Clean Up list showed `~/.Trash/huggingface` and
 * `~/.Trash/uv` as freshly SUGGESTED, the same day they'd already been
 * moved to Trash. reclaim-rules.mjs has a comment explaining Trash
 * contents should never be flagged ("calling delete on something already
 * IN Trash doesn't empty it, and emptying Trash means permanent
 * deletion, which is banned") — but nothing in evaluate() actually
 * enforced it. A basename like `huggingface` inside `.Trash` still
 * matched REDOWNLOAD_BASENAMES same as it would anywhere else. The
 * comment described an intent that was never wired to a guard.
 */
export function isInsideTrash(absPath) {
  return absPath.split(path.sep).includes(".Trash");
}

export function hasRecoverableAncestor(absPath) {
  const segments = absPath.split(path.sep).slice(0, -1);
  return segments.some(
    (seg) => INSTANT_BASENAMES.has(seg) || REDOWNLOAD_BASENAMES.has(seg),
  );
}

/**
 * macOS's own home-directory folders. These are never `review` items:
 * "your Desktop is 4.2 GB" is not a finding, and ~/Library is macOS's
 * to manage, not something Deepak installed and forgot.
 */
const STANDARD_HOME_DIRS = new Set([
  "Library", "Desktop", "Documents", "Downloads", "Pictures", "Movies",
  "Music", "Applications", "Public", "Sites", "Movies", ".Trash",
]);

/**
 * Is this a candidate for the `review` disposition?
 *
 * Review exists for ONE thing: tool and app data you installed at some
 * point and then abandoned — ~/.vscode, ~/.local, ~/.npm-global, old
 * editor profiles. All of that lives exactly one level below $HOME.
 *
 * ADDED 2026-09-03 after the first real full-disk run, which is the only
 * reason this constraint exists. Without it, review had no depth limit
 * and claimed 194.7 GB of a 245 GB disk: ~/Library (90 GB) qualified,
 * then ~/Library/Metadata, then
 * .../CoreSpotlight/SpotlightKnowledge/index.V2/DocumentProcessing/
 * PipelineStorage/Embedding/Journals — every level of the tree flagging
 * itself and counting the same bytes over and over. ~/Library/CloudStorage,
 * which holds every project on this machine, was in there too.
 *
 * hasRecoverableAncestor() could not catch this: it suppresses children
 * of KNOWN containers, and a review item is by definition one we know
 * nothing about.
 */
export function isReviewCandidate(absPath, home = process.env.HOME ?? "") {
  const parent = path.dirname(absPath);
  if (path.resolve(parent) !== path.resolve(home)) return false;
  return !STANDARD_HOME_DIRS.has(path.basename(absPath));
}

/**
 * Directory names that mean "everything below me is one installed thing,
 * not a set of independent decisions".
 */
const PACKAGE_CONTAINER_NAMES = new Set([
  "site-packages", "node_modules", ".venv", "venv", "Frameworks",
  "vendor", "Pods", "dist-packages", "wheels",
]);

/**
 * True if this path is a constituent PART of an installed application,
 * framework or package, rather than a thing in its own right.
 *
 * ADDED 2026-09-03, third real bug found by running on the real disk.
 * The `stale-large-file` rule flags any file over 100 MB untouched for
 * 90+ days, which sounds reasonable and is catastrophic in practice: a
 * binary inside an .app bundle or site-packages is NEVER touched — its
 * mtime is its build date — so every installed application's largest
 * binary qualified automatically. The real output included
 * /Applications/Docker.app/Contents/Resources/linuxkit/boot.img (600 MB),
 * three Electron Framework binaries, Playwright's driver node binary and
 * llvmlite's dylib. Deleting Docker's boot.img breaks Docker.
 *
 * The /Applications ones would have been refused by delete.mjs's $HOME
 * boundary, but the site-packages ones live inside Deepak's own projects
 * and would not have been.
 *
 * "Old" is only evidence of disuse for something a person creates and
 * opens. It is meaningless for something an installer wrote once.
 */
export function isInsidePackage(absPath) {
  const segments = absPath.split(path.sep);
  return segments.some(
    (seg, i) =>
      i < segments.length - 1 &&
      (seg.endsWith(".app") || seg.endsWith(".framework") || PACKAGE_CONTAINER_NAMES.has(seg)),
  );
}

export function formatBytes(bytes) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export function daysSince(isoDate, now = new Date()) {
  return (now.getTime() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * `active` (<30d) | `idle` (30-90d) | `stale` (>90d), from the entry's
 * mtime.
 *
 * macOS `lastUsedAt` is deliberately NOT used: it came back null for
 * every single entry in the 2026-09-03 full scan, so on this machine it
 * is not available data. Constitution Principle II forbids substituting
 * a guess for a real number, and "we don't have it" is the honest
 * answer — mtime is a real filesystem fact even if it's a weaker signal.
 */
export function classifyActivity(modifiedAt, now = new Date()) {
  const age = daysSince(modifiedAt, now);
  if (age < ACTIVE_DAYS) return "active";
  if (age <= STALE_DAYS) return "idle";
  return "stale";
}

/**
 * The tier for a real path. Returns { tier, what, restore } — `what` and
 * `restore` are null for `irreplaceable`, which is the default for
 * anything not proven otherwise.
 */
export function classifyRecoverability(absPath) {
  const basename = path.basename(absPath);

  const instant = INSTANT_BASENAMES.get(basename);
  if (instant) return { tier: "instant", what: instant, restore: null, gated: true };

  const redownload = REDOWNLOAD_BASENAMES.get(basename);
  if (redownload) {
    return {
      tier: "redownload",
      what: redownload.what,
      restore: redownload.restore,
      gated: redownload.gated,
    };
  }

  // Unknown: irreplaceable, and gated — an unrecognised thing that was
  // touched recently is doubly a thing we say nothing about.
  return { tier: "irreplaceable", what: null, restore: null, gated: true };
}

/**
 * The sentence shown to the user. DERIVED from tier and size, never
 * hand-written per rule — an earlier draft of this design gave every
 * rule its own prose `reason` string, which is maintenance nobody keeps
 * up with and which drifts out of step with the real numbers. The only
 * per-entry string anywhere in this file is `restore`, and that is a
 * real command, not copy.
 */
export function costSentence({ tier, what, restore }, sizeBytes) {
  if (tier === "instant") {
    return `Rebuilt locally in seconds — ${what}. No download.`;
  }
  if (tier === "redownload") {
    const base = `Re-downloads ~${formatBytes(sizeBytes)} over the network — ${what}.`;
    return restore ? `${base} Restore with \`${restore}\`.` : base;
  }
  return "Cannot be regenerated automatically — only you know if this still matters.";
}

/**
 * The single decision function. Returns one of three dispositions plus
 * everything the UI needs to explain it.
 *
 *   suggested — provably regenerable, not touched recently, big enough
 *               to matter. Selectable and safe to bulk-delete.
 *   review    — big and not recently touched, but NOT provably
 *               regenerable. Surfaced with its real size and date,
 *               never pre-selected, never bulk-deletable. This is the
 *               answer to "old ones, unused ones" for everything the
 *               tool cannot honestly vouch for: ~19 GB of abandoned
 *               tooling on this disk (.vscode 3.5 GB untouched since
 *               2025-09-28, .local, .npm-global, old Codex profiles).
 *               Without this tier the tool would say nothing at all
 *               about any of it, which is safe and useless.
 *   never     — sensitive, protected, in active use, or too small to be
 *               worth a decision. Absent from the cleanup list; still
 *               fully visible in Browse, as everything always is.
 *
 * `isProtectedFn` is injected rather than imported so this stays a pure
 * function of its inputs and the verification scripts can drive it
 * without touching data/protected-paths.json.
 */
export function evaluate(entry, { now = new Date(), isProtectedFn = () => false } = {}) {
  const recoverability = classifyRecoverability(entry.path);
  const activity = classifyActivity(entry.modifiedAt, now);
  const sizeBytes = entry.allocatedBytes ?? 0;
  const cost = costSentence(recoverability, sizeBytes);

  const base = {
    path: entry.path,
    sizeBytes,
    recoverability: recoverability.tier,
    activity,
    cost,
    restoreCommand: recoverability.restore,
    lastTouchedAt: entry.modifiedAt,
  };

  if (isSensitive(entry.path)) {
    return { ...base, disposition: "never", blockedBecause: "sensitive" };
  }
  if (isProtectedFn(entry.path)) {
    return { ...base, disposition: "never", blockedBecause: "protected" };
  }
  // Only gated things are suppressed for being recently touched. A pure
  // download cache is never "in use" in a way that should hide it — see
  // REDOWNLOAD_BASENAMES's `gated` note for the 6.7 GB this used to hide.
  if (activity === "active" && recoverability.gated) {
    return { ...base, disposition: "never", blockedBecause: "in-use" };
  }
  if (recoverability.tier !== "irreplaceable" && sizeBytes >= SUGGEST_MIN_BYTES) {
    return { ...base, disposition: "suggested" };
  }
  if (sizeBytes >= REVIEW_MIN_BYTES && isReviewCandidate(entry.path)) {
    return { ...base, disposition: "review" };
  }
  return {
    ...base,
    disposition: "never",
    blockedBecause: sizeBytes < REVIEW_MIN_BYTES ? "too-small" : "not-review-scope",
  };
}

export { INSTANT_BASENAMES, REDOWNLOAD_BASENAMES };
