import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { latestEntry, DATA_DIR } from "../../../lib/run-index.mjs";
import { scoreRealUsage, scoreGoldenSet } from "../../../lib/ai-eval.mjs";

/**
 * GET /api/ai-eval — added 2026-09-02 alongside the eval harness. The
 * measurable half of User Story 4: how good the AI suggestions actually
 * are, using data this app already produces (see lib/ai-eval.mjs).
 *
 * `realUsage` never calls the model — it's pure cross-referencing of
 * already-persisted files. `goldenSet` does need one live model call
 * (re-run against the current scan's rule-flagged paths), so like
 * /api/ai-suggest this degrades to `{ unavailable: true }` when no
 * OPENROUTER_API_KEY/OPENROUTER_MODEL is configured — never an error.
 */
export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  const realUsage = await scoreRealUsage();

  if (!apiKey || !model) {
    return NextResponse.json({ realUsage, goldenSet: null, unavailable: true });
  }

  const latestScan = await latestEntry("scan");
  if (!latestScan) {
    return NextResponse.json({ realUsage, goldenSet: { total: 0, matched: 0, recall: null } });
  }
  const meta = JSON.parse(await readFile(path.join(DATA_DIR, latestScan.file), "utf8"));

  try {
    const goldenSet = await scoreGoldenSet(meta.cleanupFlags ?? [], { apiKey, model });
    return NextResponse.json({ realUsage, goldenSet });
  } catch (err) {
    return NextResponse.json(
      { error: "AI eval request failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
