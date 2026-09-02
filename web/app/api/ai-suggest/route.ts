import { NextResponse } from "next/server";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { categorize } from "../../../scanner/categorize.mjs";
import { readCategoryOverrides } from "../../../lib/category-overrides.mjs";

/**
 * POST /api/ai-suggest — User Story 4 (P4, lowest priority; additive
 * only, never load-bearing for the rest of the app — constitution). Per
 * contracts/api.md: takes real candidate paths the caller already chose
 * (this app's UI sources them from whatever's currently selected in
 * Browse mode and not already deterministically flagged — see
 * app/page.tsx's `getAiSuggestions`), looks up each one's real metadata
 * fresh (size, age, category — never file contents, FR-016), and asks
 * Claude for a short rationale on why it might be worth a look.
 *
 * No API key configured is a fully supported, non-error state (FR-018) —
 * returns `{ suggestions: [], unavailable: true }`, never a failure, so
 * the rest of the Cleanup view is provably unaffected either way.
 */

const MAX_CANDIDATES = 20;

async function describeCandidate(candidatePath: string, homeDir: string, overrides: { path: string; category: string }[]) {
  try {
    const stat = await lstat(candidatePath);
    const ageDays = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));
    return {
      path: candidatePath,
      name: path.basename(candidatePath),
      allocatedBytes: stat.blocks * 512,
      ageDays,
      category: categorize(candidatePath, homeDir, overrides),
    };
  } catch {
    return null; // vanished since being selected — silently dropped, not a hard error
  }
}

export async function POST(request: Request) {
  let body: { candidatePaths?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no candidatePaths provided" }, { status: 400 });
  }

  const candidatePaths = Array.isArray(body.candidatePaths)
    ? body.candidatePaths.filter((p): p is string => typeof p === "string").slice(0, MAX_CANDIDATES)
    : [];
  if (candidatePaths.length === 0) {
    return NextResponse.json({ error: "no candidatePaths provided" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: [], unavailable: true });
  }

  const homeDir = process.env.HOME ?? "";
  const overrides = await readCategoryOverrides();
  const described = (
    await Promise.all(candidatePaths.map((p) => describeCandidate(p, homeDir, overrides)))
  ).filter((d): d is NonNullable<typeof d> => d !== null);

  if (described.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const prompt = [
    "You are helping a Mac user decide which folders/files might be worth reviewing for deletion.",
    "You are given ONLY metadata — never file contents. For each item, write one short, honest sentence",
    "explaining why it might be worth a look (or say briefly why it's probably fine to keep, if nothing stands out).",
    "Respond with ONLY a JSON array, no other text, in this exact shape:",
    '[{"path": "...", "rationale": "..."}]',
    "",
    "Items:",
    JSON.stringify(
      described.map((d) => ({
        path: d.path,
        name: d.name,
        sizeGB: (d.allocatedBytes / 1_000_000_000).toFixed(2),
        ageDays: d.ageDays,
        category: d.category,
      })),
      null,
      2,
    ),
  ].join("\n");

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "AI suggestion request failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ error: "AI suggestion request failed", detail }, { status: 502 });
  }

  try {
    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? "[]";
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { path: string; rationale: string }[];
    const validPaths = new Set(described.map((d) => d.path));
    const suggestions = parsed
      .filter((s) => validPaths.has(s.path))
      .map((s) => ({ path: s.path, rationale: s.rationale, confidence: "worth-a-look" as const }));
    return NextResponse.json({ suggestions });
  } catch (err) {
    return NextResponse.json(
      { error: "AI suggestion request failed", detail: `could not parse response: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
