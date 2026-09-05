import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, DELETES_DIR } from "./run-index.mjs";
import { readProtectedPaths } from "./protected-paths.mjs";

/**
 * Eval harness for /api/ai-suggest (User Story 4), added 2026-09-02.
 *
 * The one AI feature in this app used to be a black box — a single-shot
 * LLM call with no way to tell if its suggestions were actually good.
 * This file makes that measurable using data the app already produces:
 *
 * - Every suggestion call is persisted (recordSuggestion) so there's a
 *   real history to score against.
 * - scoreRealUsage() cross-references that history against what the user
 *   actually did afterward (data/deletes/, data/protected-paths.json) —
 *   "did it click" (accepted), "no, keep this" (rejected), or nothing
 *   (ignored/pending). No synthetic labels — outcomes are real user
 *   actions already logged by the existing delete/protect flows.
 * - scoreGoldenSet() checks AI suggestions against the deterministic rule
 *   engine's own "safe"/"caution" flags (scanner/reclaim-rules.mjs) —
 *   ground truth the system already trusts, not a hand-guessed list (see
 *   the no-unsourced-facts rule this project already follows for
 *   category overrides).
 * - buildHistoryContext() feeds accepted/rejected outcomes back into the
 *   next suggestion call's prompt, so suggestions can visibly improve
 *   from real usage instead of staying static.
 */

const AI_SUGGESTIONS_DIR = path.join(DATA_DIR, "ai-suggestions");
const PENDING_WINDOW_DAYS = 14;
const GOLDEN_SET_MAX = 15;

/** Persists one /api/ai-suggest call. Called after every real request, win or lose. */
export async function recordSuggestion(entry) {
  await mkdir(AI_SUGGESTIONS_DIR, { recursive: true });
  const file = path.join(AI_SUGGESTIONS_DIR, `${entry.requestedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(entry, null, 2) + "\n", "utf8");
}

/** All persisted suggestion calls, oldest first. [] if none yet — a real, expected state. */
export async function readSuggestionHistory() {
  let files;
  try {
    files = (await readdir(AI_SUGGESTIONS_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  files.sort();
  const entries = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(AI_SUGGESTIONS_DIR, f), "utf8"))),
  );
  return entries;
}

async function readAllDeleteLogEntries() {
  let files;
  try {
    files = (await readdir(DELETES_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const perFile = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(DELETES_DIR, f), "utf8"))),
  );
  return perFile.flat();
}

/**
 * Real-world outcome of every individual suggested path across all
 * persisted suggestion calls — the actual eval, not a synthetic one.
 */
export async function scoreRealUsage() {
  const [history, deleteEntries, protectedPaths] = await Promise.all([
    readSuggestionHistory(),
    readAllDeleteLogEntries(),
    readProtectedPaths(),
  ]);

  const now = Date.now();
  let accepted = 0;
  let rejected = 0;
  let ignored = 0;
  let pending = 0;
  const outcomes = [];

  for (const call of history) {
    const requestedAtMs = new Date(call.requestedAt).getTime();
    for (const s of call.suggestions) {
      const wasDeleted = deleteEntries.some(
        (d) => d.path === s.path && new Date(d.deletedAt).getTime() > requestedAtMs,
      );
      const wasProtected = protectedPaths.some(
        (p) => p.path === s.path && new Date(p.addedAt).getTime() > requestedAtMs,
      );
      let outcome;
      if (wasDeleted) {
        outcome = "accepted";
        accepted++;
      } else if (wasProtected) {
        outcome = "rejected";
        rejected++;
      } else if ((now - requestedAtMs) / (1000 * 60 * 60 * 24) < PENDING_WINDOW_DAYS) {
        outcome = "pending";
        pending++;
      } else {
        outcome = "ignored";
        ignored++;
      }
      outcomes.push({ path: s.path, requestedAt: call.requestedAt, outcome });
    }
  }

  const decided = accepted + rejected + ignored;
  return {
    total: outcomes.length,
    accepted,
    rejected,
    ignored,
    pending,
    acceptanceRate: decided > 0 ? accepted / decided : null,
    outcomes,
  };
}

/**
 * Short natural-language summary of past outcomes for candidates whose
 * NAME (basename) matches something suggested before — single-machine
 * tool, so recurring folder names (node_modules, dev, .old-project) are
 * the transferable signal, not exact paths. Returns "" when there's
 * nothing relevant yet (most of the time, early on).
 */
export async function buildHistoryContext(candidates) {
  const { outcomes } = await scoreRealUsage();
  if (outcomes.length === 0) return "";

  const byName = new Map(); // name -> { accepted, rejected }
  for (const o of outcomes) {
    if (o.outcome !== "accepted" && o.outcome !== "rejected") continue;
    const name = path.basename(o.path);
    const entry = byName.get(name) ?? { accepted: 0, rejected: 0 };
    entry[o.outcome]++;
    byName.set(name, entry);
  }

  const relevantNames = new Set(candidates.map((c) => c.name));
  const lines = [];
  for (const name of relevantNames) {
    const stats = byName.get(name);
    if (!stats) continue;
    if (stats.accepted > 0) {
      lines.push(
        `Folders named "${name}" were suggested before and later deleted ${stats.accepted} time(s) — the user agreed with that suggestion.`,
      );
    }
    if (stats.rejected > 0) {
      lines.push(
        `Folders named "${name}" were suggested before and explicitly protected ${stats.rejected} time(s) — the user disagreed; don't over-flag these.`,
      );
    }
  }

  return lines.join(" ");
}

/**
 * Calls the same OpenRouter chat-completions endpoint /api/ai-suggest
 * uses, given already-known candidate metadata (never re-derives via
 * lstat — see the 2026-09-02 fix in contracts/api.md). Shared by
 * /api/ai-suggest and scoreGoldenSet so there's one place that talks to
 * the model.
 */
export async function callOpenRouterSuggest(candidates, { apiKey, model, historySnippet }) {
  const prompt = [
    "You are helping a Mac user decide which folders/files might be worth reviewing for deletion.",
    "You are given ONLY metadata — never file contents. For each item, write one short, honest sentence",
    "explaining why it might be worth a look (or say briefly why it's probably fine to keep, if nothing stands out).",
    historySnippet ? `\n${historySnippet}` : "",
    "Respond with ONLY a JSON array, no other text, in this exact shape:",
    '[{"path": "...", "rationale": "..."}]',
    "",
    "Items:",
    JSON.stringify(
      candidates.map((c) => ({
        path: c.path,
        name: c.name,
        sizeGB: (c.allocatedBytes / 1_000_000_000).toFixed(2),
        ageDays: c.modifiedAt ? Math.floor((Date.now() - new Date(c.modifiedAt).getTime()) / (1000 * 60 * 60 * 24)) : null,
        category: c.category,
      })),
      null,
      2,
    ),
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Mac Storage Cleanup Dashboard",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are helping a Mac user decide which folders/files might be worth reviewing for deletion. Respond with ONLY a JSON array, no other text.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI suggestion request failed: ${detail}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "[]";
  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const validPaths = new Set(candidates.map((c) => c.path));
  return parsed.filter((s) => validPaths.has(s.path)).map((s) => ({ path: s.path, rationale: s.rationale, confidence: "worth-a-look" }));
}

/**
 * Golden-set recall: of the paths the DETERMINISTIC rule engine already
 * flagged safe/caution in the current scan, how many does the model
 * independently also flag? Ground truth comes from scanner/reclaim-rules.mjs
 * output already stored in the scan's meta.json — never a hand-guessed
 * list, per this project's no-unsourced-facts rule.
 */
export async function scoreGoldenSet(cleanupFlags, { apiKey, model }) {
  const goldenCandidates = cleanupFlags
    // Ground truth is every flag the deterministic engine produced, in
    // either disposition. Was `confidence === "safe" || "caution"` before
    // 2026-09-03 — the same "every real flag" intent, expressed against
    // the fields that replaced confidence.
    .filter((f) => f.disposition === "suggested" || f.disposition === "review")
    .slice(0, GOLDEN_SET_MAX)
    .map((f) => ({
      path: f.path,
      name: path.basename(f.path),
      allocatedBytes: f.sizeBytes,
      category: "reclaimable",
      modifiedAt: null,
    }));

  if (goldenCandidates.length === 0) {
    return { total: 0, matched: 0, recall: null };
  }

  const suggestions = await callOpenRouterSuggest(goldenCandidates, { apiKey, model, historySnippet: "" });
  const suggestedPaths = new Set(suggestions.map((s) => s.path));
  const matched = goldenCandidates.filter((c) => suggestedPaths.has(c.path)).length;

  return { total: goldenCandidates.length, matched, recall: matched / goldenCandidates.length };
}

export { AI_SUGGESTIONS_DIR };
