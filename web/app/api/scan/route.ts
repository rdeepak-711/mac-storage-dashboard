import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { latestEntry, DATA_DIR } from "@/lib/run-index.mjs";

const execFileAsync = promisify(execFile);

async function readLatestMeta() {
  const latest = await latestEntry("scan");
  if (!latest) return null;
  const metaPath = path.join(DATA_DIR, latest.file);
  return JSON.parse(await readFile(metaPath, "utf8"));
}

/**
 * GET /api/scan — added 2026-09-01, alongside T010.
 *
 * Reads the most recent scan's meta.json WITHOUT running a new scan.
 * The treemap page needs this: opening the page should show whatever
 * data already exists, not force a fresh multi-minute scan on every
 * visit — that's what the "Refresh" button (POST) is explicitly for.
 * Returns `{ scan: null }` (200, not an error) when no scan has ever
 * run — constitution Principle II: an empty/pending state, not a
 * fabricated result.
 */
export async function GET() {
  const meta = await readLatestMeta();
  return NextResponse.json({ scan: meta });
}

/**
 * POST /api/scan — per contracts/api.md.
 *
 * A full scan of $HOME + /Applications takes real minutes (recorded
 * baseline in quickstart.md: 4:12), not seconds. This route intentionally
 * has no artificial timeout — fine for a local, single-user tool that is
 * never deployed publicly (plan.md), but would need rethinking for
 * anything served over a network with a request time limit.
 */
export async function POST() {
  const scriptPath = path.resolve(process.cwd(), "scanner/scan.mjs");

  try {
    await execFileAsync("node", [scriptPath], { maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    return NextResponse.json(
      { error: "scan failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const meta = await readLatestMeta();
  if (!meta) {
    return NextResponse.json(
      { error: "scan failed", detail: "scanner exited cleanly but recorded no scan" },
      { status: 500 },
    );
  }

  return NextResponse.json(meta);
}
