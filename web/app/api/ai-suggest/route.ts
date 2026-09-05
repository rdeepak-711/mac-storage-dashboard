import { NextResponse } from "next/server";
import { callOpenRouterSuggest, buildHistoryContext, recordSuggestion } from "../../../lib/ai-eval.mjs";

/**
 * POST /api/ai-suggest — User Story 4 (P4, lowest priority; additive
 * only, never load-bearing for the rest of the app — constitution). Per
 * contracts/api.md: takes real candidate metadata the caller already has
 * (this app's UI sources it from `selectedDetails` — the same real
 * scanned size/category/modifiedAt already shown in the list/treemap for
 * whatever's currently selected in Browse mode and not already
 * deterministically flagged, see app/page.tsx's `getAiSuggestions`).
 *
 * Deliberately does NOT re-derive size/age via a fresh `lstat` on the
 * server: `lstat` on a directory only reports the directory inode's own
 * size, not its real recursive size from the scan — that produced
 * nonsense like "0.00 GB, 0 days old" for real multi-GB folders. The
 * scan's own numbers are the honest ones (constitution: no unsourced
 * facts in product-facing output).
 *
 * No API key configured is a fully supported, non-error state (FR-018) —
 * returns `{ suggestions: [], unavailable: true }`, never a failure, so
 * the rest of the Cleanup view is provably unaffected either way.
 *
 * Added 2026-09-02, alongside the eval harness (lib/ai-eval.mjs): every
 * real call is persisted (recordSuggestion) so its outcome can be scored
 * later, and past accepted/rejected outcomes for similarly-named folders
 * are injected into the prompt (buildHistoryContext) so suggestions can
 * actually improve from real usage instead of staying static forever.
 */

const MAX_CANDIDATES = 20;

interface Candidate {
  path: string;
  name: string;
  allocatedBytes: number;
  modifiedAt: string;
  category: string;
}

function isCandidate(c: unknown): c is Candidate {
  if (typeof c !== "object" || c === null) return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.path === "string" &&
    typeof r.name === "string" &&
    typeof r.allocatedBytes === "number" &&
    typeof r.modifiedAt === "string" &&
    typeof r.category === "string"
  );
}

export async function POST(request: Request) {
  let body: { candidates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "no candidates provided" }, { status: 400 });
  }

  const candidates = Array.isArray(body.candidates) ? body.candidates.filter(isCandidate).slice(0, MAX_CANDIDATES) : [];
  if (candidates.length === 0) {
    return NextResponse.json({ error: "no candidates provided" }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    return NextResponse.json({ suggestions: [], unavailable: true });
  }

  const requestedAt = new Date().toISOString();
  const historySnippet = await buildHistoryContext(candidates);

  let suggestions: { path: string; rationale: string; confidence: "worth-a-look" }[];
  try {
    suggestions = await callOpenRouterSuggest(candidates, { apiKey, model, historySnippet });
  } catch (err) {
    return NextResponse.json(
      { error: "AI suggestion request failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  await recordSuggestion({
    requestedAt,
    model,
    candidates,
    suggestions,
    historyContextUsed: historySnippet.length > 0,
  });

  return NextResponse.json({ suggestions });
}
