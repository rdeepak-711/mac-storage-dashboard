import path from "node:path";
import os from "node:os";

/**
 * The never-suggest registry — a BUILT-IN, permanent denylist of paths
 * this tool must never flag, never select, and never delete, no matter
 * what any rule, any user click, or any AI suggestion says.
 *
 * Added 2026-09-03. This is deliberately SEPARATE from
 * lib/protected-paths.mjs, and both stay:
 *
 *   - Protected Paths is Deepak's own list. He adds and removes entries
 *     at will through the UI. It is per-machine, mutable, and can be
 *     empty.
 *   - This registry ships with the tool. It is not editable from the UI,
 *     not stored in data/, and not overridable. It exists so a mistaken
 *     rule, a bad AI suggestion, or a careless click can never reach a
 *     credential store — including on a machine where nobody has
 *     protected anything yet.
 *
 * Origin: Deepak asked for a distinction between disposable cache and
 * important data ("even the google sign in and passwords from 1 year are
 * important"). The specific case he named turned out not to exist here —
 * ~/.cache holds no browser data, and Brave's passwords live in
 * ~/Library/Application Support/BraveSoftware/, which no rule ever
 * touched. But the instinct was right and deserved a real guarantee
 * rather than the accident of no rule happening to match. That guarantee
 * is this file, enforced twice: flags are never generated for these
 * paths (scanner/reclaim-rules.mjs), and deletion is refused for them
 * unconditionally (scanner/delete.mjs). The second check is the actual
 * guarantee; the first is a bug away from failing.
 *
 * See docs/superpowers/specs/2026-09-03-recoverability-and-never-suggest-design.md
 * and constitution Principle I.
 */

/**
 * Paths relative to $HOME that are never touchable. Each entry protects
 * itself AND everything beneath it.
 */
const HOME_RELATIVE = [
  ".ssh", // SSH private keys
  ".aws", // AWS credentials
  ".gnupg", // GPG private keys
  ".mcp-auth", // saved MCP OAuth tokens
  ".npmrc", // may hold an npm auth token
  ".git-credentials", // git HTTPS credentials, stored in plaintext
  ".mylogin.cnf", // MySQL login path file (obfuscated, not encrypted)
  ".config/gh", // GitHub CLI OAuth token
  ".gdrive-excluded", // Deepak's own out-of-Drive secrets store (API keys, .env files)
  "Desktop/.secrets",
  "Library/Keychains", // macOS Keychain itself
];

/**
 * Directory NAMES that mark an app profile root. Any directory with one
 * of these as its immediate parent is a per-app profile — the place
 * browsers and Electron apps keep logins, cookies, bookmarks and
 * extensions. Real example on this disk:
 * ~/Library/Application Support/BraveSoftware (4.27 GB) holds Brave's
 * Login Data and Cookies. Caches live elsewhere (~/Library/Caches) and
 * are NOT protected by this — clearing a cache is a supported action;
 * clearing a profile is not.
 */
const PROFILE_PARENT_DIRS = [
  path.join("Library", "Application Support"),
  path.join("Library", "Group Containers"),
  path.join("Library", "Containers"),
];

/**
 * Credential store FILENAMES, protected at any depth anywhere on the
 * disk. These are Chromium's real on-disk names, shared by Brave,
 * Chrome, Edge and every Electron app that embeds Chromium — so this
 * covers browsers we have never heard of, without a per-browser list.
 */
const CREDENTIAL_BASENAMES = new Set([
  "Login Data",
  "Login Data For Account",
  "Cookies",
  "Local State",
  "Web Data",
  "Affiliation Database",
  "id_rsa",
  "id_ed25519",
  "credentials",
  ".netrc",
]);

function homeDir() {
  return process.env.HOME || os.homedir();
}

/**
 * Every absolute path in the registry, resolved against $HOME. Exported
 * so the verification script can assert each one is genuinely refused
 * rather than trusting that isSensitive() agrees with itself.
 */
export function sensitiveRoots(home = homeDir()) {
  return HOME_RELATIVE.map((rel) => path.resolve(home, rel));
}

/**
 * True if candidatePath is in the never-suggest registry — because it IS
 * a registry root, is INSIDE one, is an app profile root, or is a
 * credential file at any depth.
 *
 * Path-boundary logic mirrors lib/protected-paths.mjs deliberately:
 * resolved absolute paths compared segment-wise, so "/a/bcd" never
 * matches a protected "/a/b" the way a bare string prefix check would.
 */
export function isSensitive(candidatePath, home = homeDir()) {
  const candidate = path.resolve(candidatePath);

  for (const root of sensitiveRoots(home)) {
    if (candidate === root || candidate.startsWith(root + path.sep)) return true;
  }

  if (CREDENTIAL_BASENAMES.has(path.basename(candidate))) return true;

  // An app profile root is a direct child of one of the profile parent
  // dirs — e.g. ".../Application Support/BraveSoftware". Anything deeper
  // inside it is covered too, since we protect the root and everything
  // under it.
  for (const parentRel of PROFILE_PARENT_DIRS) {
    const parentAbs = path.resolve(home, parentRel);
    if (candidate === parentAbs) return true;
    if (candidate.startsWith(parentAbs + path.sep)) return true;
  }

  return false;
}

/**
 * The human-readable reason a path is refused, for the UI and for the
 * delete-guard's error message. Never returns a vague "not allowed" —
 * the user should always learn WHY something is walled off.
 */
export function sensitiveReason(candidatePath, home = homeDir()) {
  const candidate = path.resolve(candidatePath);

  if (CREDENTIAL_BASENAMES.has(path.basename(candidate))) {
    return "Credential store — holds saved logins, passwords or keys";
  }
  for (const root of sensitiveRoots(home)) {
    if (candidate === root || candidate.startsWith(root + path.sep)) {
      return `Inside ${path.basename(root)} — keys, tokens or credentials`;
    }
  }
  for (const parentRel of PROFILE_PARENT_DIRS) {
    const parentAbs = path.resolve(home, parentRel);
    if (candidate === parentAbs || candidate.startsWith(parentAbs + path.sep)) {
      return "App profile data — logins, cookies, bookmarks and extensions live here, not cache";
    }
  }
  return null;
}

export { HOME_RELATIVE, PROFILE_PARENT_DIRS, CREDENTIAL_BASENAMES };
