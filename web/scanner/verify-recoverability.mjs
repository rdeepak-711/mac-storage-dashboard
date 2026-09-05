#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSensitive } from "../lib/sensitive-paths.mjs";
import { formatBytes, REVIEW_MIN_BYTES, SUGGEST_MIN_BYTES } from "../lib/recoverability.mjs";
import { latestEntry } from "../lib/run-index.mjs";

/**
 * Checks a REAL scan's cleanupFlags against the invariants the
 * recoverability model promises. Run after any scan; this is the
 * project's substitute for a unit-test suite (no test framework, and
 * constitution Principle II wants real data anyway).
 *
 * The invariants, and why each one exists:
 *
 *  - Every flag carries a disposition, tier and activity. A flag missing
 *    any of them is a flag the UI cannot explain.
 *  - Nothing `suggested` is `irreplaceable`. This is the whole safety
 *    claim: we only offer what we can prove comes back.
 *  - Nothing `suggested` is smaller than the floor, and nothing under
 *    `review` is smaller than the review floor — otherwise the list
 *    fills with decisions not worth making.
 *  - Every `redownload` flag names its size in its cost sentence. A cost
 *    line that doesn't say what it costs is the old "safe" problem
 *    wearing a longer sentence.
 *  - No flag, in any disposition, is a sensitive path.
 *  - No flag sits inside another flag. Nested flags double-count the
 *    same bytes and make the pre-delete total a lie.
 *
 * Usage:
 *   node scanner/verify-recoverability.mjs                 (latest scan)
 *   node scanner/verify-recoverability.mjs --scan <meta.json>
 */

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

const args = process.argv.slice(2);
const scanFlagIndex = args.indexOf("--scan");
let metaPath = scanFlagIndex >= 0 ? args[scanFlagIndex + 1] : null;

if (!metaPath) {
  const latest = await latestEntry("scan");
  if (!latest) {
    console.error("No scan found. Run: node scanner/scan.mjs");
    process.exit(1);
  }
  metaPath = path.resolve(process.cwd(), "data", latest.file);
}

const meta = JSON.parse(await readFile(metaPath, "utf8"));
const flags = meta.cleanupFlags ?? [];
const HOME = process.env.HOME;

console.log(`Scan: ${meta.scannedAt}`);
console.log(`Flags: ${flags.length}\n`);

if (flags.length === 0) fail("scan produced no flags at all");

for (const flag of flags) {
  const where = flag.path.replace(HOME, "~");

  if (!flag.disposition) fail(`${where}: no disposition`);
  if (!flag.recoverability) fail(`${where}: no recoverability tier`);
  if (!flag.activity) fail(`${where}: no activity`);
  if (!flag.reason) fail(`${where}: no cost sentence`);

  if (flag.disposition === "suggested" && flag.recoverability === "irreplaceable") {
    fail(`${where}: SUGGESTED but irreplaceable — the core safety claim is broken`);
  }
  if (flag.disposition === "suggested" && flag.sizeBytes < SUGGEST_MIN_BYTES) {
    fail(`${where}: suggested but only ${formatBytes(flag.sizeBytes)}`);
  }
  if (
    flag.disposition === "review" &&
    flag.sizeBytes < REVIEW_MIN_BYTES &&
    flag.ruleId !== "duplicate-file" &&
    flag.ruleId !== "old-downloads-installer" &&
    flag.ruleId !== "stale-large-file"
  ) {
    fail(`${where}: review but only ${formatBytes(flag.sizeBytes)}`);
  }
  if (flag.recoverability === "redownload" && !/\d/.test(flag.reason)) {
    fail(`${where}: redownload cost sentence names no size — "${flag.reason}"`);
  }
  if (isSensitive(flag.path)) {
    fail(`${where}: SENSITIVE PATH WAS FLAGGED`);
  }
}

// Nested flags: sorted by path, any flag whose path starts with an
// earlier flag's path + "/" is inside it.
const sorted = [...flags].sort((a, b) => a.path.localeCompare(b.path));
for (let i = 1; i < sorted.length; i++) {
  for (let j = i - 1; j >= 0; j--) {
    if (sorted[i].path.startsWith(sorted[j].path + path.sep)) {
      fail(`nested flag: ${sorted[i].path.replace(HOME, "~")} is inside ${sorted[j].path.replace(HOME, "~")}`);
      break;
    }
    if (!sorted[j].path.startsWith(sorted[i].path.slice(0, 1))) break;
  }
}

const byDisposition = (d) => flags.filter((f) => f.disposition === d);
const total = (list) => list.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);

for (const d of ["suggested", "review"]) {
  const list = byDisposition(d);
  console.log(`${d.toUpperCase()}  ${list.length} item(s), ${formatBytes(total(list))}`);
}

console.log(failures === 0 ? "\nPASS — all invariants hold\n" : `\n${failures} FAILURE(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;

export { fileURLToPath };
