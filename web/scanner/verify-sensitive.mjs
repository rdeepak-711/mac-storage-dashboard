#!/usr/bin/env node
import path from "node:path";
import { readdir } from "node:fs/promises";
import { isSensitive, sensitiveRoots } from "../lib/sensitive-paths.mjs";
import { evaluateEntry } from "./reclaim-rules.mjs";
import { deletePaths } from "./delete.mjs";

/**
 * Proves the never-suggest registry actually holds, against the REAL
 * disk — not a fixture. Constitution Principle II: this project has no
 * test framework and verification is done against real data.
 *
 * Two independent assertions, because the registry's whole value is that
 * it is enforced twice:
 *
 *   1. No sensitive path can be produced as a flag by the rule engine.
 *   2. No sensitive path can be deleted, even if a flag somehow reached
 *      the delete call anyway. This is the one that matters — layer 1 is
 *      a bug away from failing.
 *
 * Assertion 2 calls the real deletePaths() on real credential
 * directories. That is intentional and safe: if the guard works, nothing
 * is touched, and if it does NOT work this script is how we find out
 * rather than a user finding out. It is the adversarial test, so it must
 * use the real function, not a copy of its logic.
 *
 * Usage: node scanner/verify-sensitive.mjs
 */

const HOME = process.env.HOME;
let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

/** Every registry root, plus a real child of each that exists. */
async function sensitiveSamples() {
  const samples = [];
  for (const root of sensitiveRoots()) {
    samples.push(root);
    try {
      const children = await readdir(root);
      if (children[0]) samples.push(path.join(root, children[0]));
    } catch {
      // Not present on this machine, or unreadable — the root itself is
      // still a valid sample. Never a failure: the registry is allowed to
      // name paths that don't exist here.
    }
  }
  samples.push(path.join(HOME, "Library", "Application Support", "BraveSoftware"));
  samples.push(
    path.join(HOME, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "Default", "Login Data"),
  );
  return samples;
}

console.log("1. Rule engine never flags a sensitive path\n");

const samples = await sensitiveSamples();
const now = new Date();
for (const sample of samples) {
  // Present it the way the walk would, and make it maximally temping to
  // flag: huge, and untouched for years. If anything can produce a flag
  // for a credential store, this is the input that does it.
  const entry = {
    path: sample,
    kind: "directory",
    allocatedBytes: 50_000_000_000,
    modifiedAt: new Date("2020-01-01").toISOString(),
  };
  const flag = evaluateEntry(entry, { now });
  check(flag === null, `no flag for ${sample.replace(HOME, "~")}`);
}

console.log(`\n   ${samples.length} sensitive paths tested\n`);

console.log("2. Real top-level paths still classify correctly (no over-blocking)\n");

// The registry must not swallow the things we DO want to suggest — an
// over-broad guard that blocks everything would pass test 1 trivially.
const mustNotBeSensitive = [
  path.join(HOME, ".cache", "huggingface"),
  path.join(HOME, ".npm", "_cacache"),
  path.join(HOME, "Library", "Caches", "BraveSoftware"),
  path.join(HOME, "Library", "Caches", "ms-playwright"),
  path.join(HOME, "Desktop"),
  path.join(HOME, "Downloads"),
];
for (const p of mustNotBeSensitive) {
  check(!isSensitive(p), `not blocked: ${p.replace(HOME, "~")}`);
}

console.log("\n3. Delete guard refuses every sensitive path (the real guarantee)\n");

const { deleted, skipped } = await deletePaths(samples);
check(deleted.length === 0, `deletePaths() deleted nothing (${deleted.length} deleted)`);
check(skipped.length === samples.length, `all ${samples.length} refused`);
if (deleted.length > 0) {
  console.log("\n  *** GUARD BREACHED — these were moved to Trash: ***");
  for (const d of deleted) console.log("      " + d.path);
}

console.log(failures === 0 ? "\nPASS — registry holds\n" : `\n${failures} FAILURE(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
