import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * GET /api/entry-detail?path=<path> — per contracts/api.md, T013.
 *
 * On-demand only, per research.md's "Last used data" decision: `mtime`
 * (already known from the scan) is the primary signal and costs nothing
 * extra; `kMDItemLastUsedDate` via `mdls` is a real Spotlight lookup, one
 * process spawn per call — too slow to run for every file in a bulk scan,
 * so it's deferred to here, called only when a user actually drills into
 * one specific file's detail.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get("path");
  if (!targetPath) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync("mdls", ["-name", "kMDItemLastUsedDate", "-raw", targetPath]);
    const raw = stdout.trim();
    // mdls prints the literal string "(null)" when Spotlight has no value
    // for this attribute on this file — a real, valid "we don't know", not
    // an error.
    const lastUsedAt = raw === "(null)" ? null : new Date(raw).toISOString();
    return NextResponse.json({ lastUsedAt });
  } catch (err) {
    // mdls exits non-zero when the path doesn't exist at all.
    return NextResponse.json(
      { error: "could not read metadata for this path", detail: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
