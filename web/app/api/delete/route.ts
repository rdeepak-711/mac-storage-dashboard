import { NextResponse } from "next/server";
import { deletePaths } from "../../../scanner/delete.mjs";

/**
 * POST /api/delete — per contracts/api.md.
 *
 * A thin wrapper: all the real safety logic (Protected Paths, $HOME
 * boundary, re-verification, Trash-move, audit log) lives in
 * scanner/delete.mjs (T017), imported directly rather than spawned as a
 * subprocess — unlike /api/scan, a delete is cheap and needs to return
 * structured deleted/skipped data, not console output.
 */
export async function POST(request: Request) {
  let body: { paths?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no paths provided" }, { status: 400 });
  }

  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "no paths provided" }, { status: 400 });
  }

  const { deleted, skipped } = await deletePaths(paths);

  // 403 only when EVERY requested path was refused for being outside the
  // allowed boundary — if some paths are valid and some aren't, the valid
  // ones still proceed and the invalid ones surface in `skipped` with a
  // reason (FR-010's refusal is per-item, not per-request).
  if (deleted.length === 0 && skipped.length > 0 && skipped.every((s) => s.reason === "outside allowed boundary")) {
    return NextResponse.json(
      { error: "path outside allowed boundary", path: skipped[0].path },
      { status: 403 },
    );
  }

  return NextResponse.json({ deleted, skipped });
}
