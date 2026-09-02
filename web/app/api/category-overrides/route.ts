import { NextResponse } from "next/server";
import {
  readCategoryOverrides,
  addCategoryOverride,
  removeCategoryOverride,
} from "../../../lib/category-overrides.mjs";

const VALID_CATEGORIES = new Set([
  "documents",
  "applications",
  "developer",
  "photos",
  "system-data",
  "mail",
  "music",
  "reclaimable",
  "other",
]);

/**
 * GET/POST/DELETE /api/category-overrides — thin wrappers around
 * lib/category-overrides.mjs, same pattern as /api/protected-paths.
 * The real effect (a corrected category) only shows up after the next
 * scan — scanner/scan.mjs reads this same file once per scan and passes
 * it into categorize().
 */

export async function GET() {
  const overrides = await readCategoryOverrides();
  return NextResponse.json({ overrides });
}

export async function POST(request: Request) {
  let body: { path?: unknown; category?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no path/category provided" }, { status: 400 });
  }

  if (typeof body.path !== "string" || body.path.length === 0) {
    return NextResponse.json({ error: "no path provided" }, { status: 400 });
  }
  if (typeof body.category !== "string" || !VALID_CATEGORIES.has(body.category)) {
    return NextResponse.json({ error: "invalid category" }, { status: 400 });
  }

  const overrides = await addCategoryOverride(body.path, body.category);
  return NextResponse.json({ overrides });
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

  const overrides = await removeCategoryOverride(body.path);
  return NextResponse.json({ overrides });
}
