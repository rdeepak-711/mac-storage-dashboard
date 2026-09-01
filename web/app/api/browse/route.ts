import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { latestEntry, listingFilename, DATA_DIR } from "@/lib/run-index.mjs";

/**
 * GET /api/browse?path=<path> — per contracts/api.md.
 *
 * Added 2026-08-31 alongside the Scan Snapshot storage redesign: /api/scan
 * never returns a folder's children (see data-model.md), so the treemap UI
 * needs this route to fetch any single directory's one-level listing —
 * including the synthetic "__root__" for the top level.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get("path");
  if (!targetPath) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }

  const latest = await latestEntry("scan");
  if (!latest) {
    return NextResponse.json({ error: "no scan has been run yet" }, { status: 404 });
  }

  const scanDir = path.dirname(path.join(DATA_DIR, latest.file));
  const listingPath = path.join(scanDir, listingFilename(targetPath));

  try {
    const content = await readFile(listingPath, "utf8");
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json(
      { error: "no listing for this path in the latest scan" },
      { status: 404 },
    );
  }
}
