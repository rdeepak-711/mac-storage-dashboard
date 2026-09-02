import { NextResponse } from "next/server";
import { readProtectedPaths, addProtectedPath, removeProtectedPath } from "../../../lib/protected-paths.mjs";

/**
 * GET/POST/DELETE /api/protected-paths — per contracts/api.md, added
 * 2026-09-01 alongside the Cleanup view (T020), backing FR-010a. Thin
 * wrappers around lib/protected-paths.mjs — the real safety enforcement
 * (refusing to delete a protected path) lives in scanner/delete.mjs,
 * which reads the same data/protected-paths.json file directly. These
 * routes only ever touch that one JSON file, never the target path
 * itself.
 */

export async function GET() {
  const protectedPaths = await readProtectedPaths();
  return NextResponse.json({ protected: protectedPaths });
}

export async function POST(request: Request) {
  let body: { path?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no path provided" }, { status: 400 });
  }

  if (typeof body.path !== "string" || body.path.length === 0) {
    return NextResponse.json({ error: "no path provided" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note : undefined;
  const protectedPaths = await addProtectedPath(body.path, note);
  return NextResponse.json({ protected: protectedPaths });
}

export async function DELETE(request: Request) {
  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no path provided" }, { status: 400 });
  }

  if (typeof body.path !== "string" || body.path.length === 0) {
    return NextResponse.json({ error: "no path provided" }, { status: 400 });
  }

  const protectedPaths = await removeProtectedPath(body.path);
  return NextResponse.json({ protected: protectedPaths });
}
