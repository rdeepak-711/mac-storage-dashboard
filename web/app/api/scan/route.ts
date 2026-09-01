import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { latestEntry, DATA_DIR } from "@/lib/run-index.mjs";

const execFileAsync = promisify(execFile);

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

  const latest = await latestEntry("scan");
  if (!latest) {
    return NextResponse.json(
      { error: "scan failed", detail: "scanner exited cleanly but recorded no scan" },
      { status: 500 },
    );
  }

  const metaPath = path.join(DATA_DIR, latest.file);
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  return NextResponse.json(meta);
}
