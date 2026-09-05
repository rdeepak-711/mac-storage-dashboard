"use client";

/**
 * Small eval readout for the AI Suggestions feature (User Story 4),
 * added 2026-09-02 alongside lib/ai-eval.mjs. Shows two real numbers,
 * neither mocked:
 *
 * - Real usage: what actually happened to past suggestions (accepted =
 *   the user deleted what was suggested, rejected = explicitly
 *   protected instead, ignored/pending = neither yet).
 * - Golden-set recall: of the paths the deterministic rule engine
 *   already flags, how many does the model independently agree with —
 *   see lib/ai-eval.mjs's scoreGoldenSet for why this is grounded in
 *   real rule output, not a guessed list.
 */

export interface AiEvalReport {
  realUsage: {
    total: number;
    accepted: number;
    rejected: number;
    ignored: number;
    pending: number;
    acceptanceRate: number | null;
  };
  goldenSet: { total: number; matched: number; recall: number | null } | null;
  unavailable?: boolean;
}

function pct(n: number | null) {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export function AiEvalPanel({ report, onClose }: { report: AiEvalReport; onClose: () => void }) {
  const { realUsage, goldenSet, unavailable } = report;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--accent)]">
            AI Suggestions eval — measured against real usage, not vibes
          </span>
          <button onClick={onClose} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Dismiss
          </button>
        </div>

        {unavailable && (
          <p className="text-xs text-[var(--text-secondary)]">
            No OpenRouter key configured — golden-set recall unavailable. Real-usage numbers below still work (they never call the model).
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <div className="text-xs font-semibold text-[var(--text-primary)]">Real usage</div>
            {realUsage.total === 0 ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">No AI suggestions made yet.</p>
            ) : (
              <>
                <div className="font-[family-name:var(--font-data)] mt-1 text-xs text-[var(--text-secondary)]">
                  {realUsage.total} suggestions · {realUsage.accepted} accepted · {realUsage.rejected} rejected ·{" "}
                  {realUsage.ignored} ignored · {realUsage.pending} pending
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  Acceptance rate: <span className="text-[var(--text-primary)]">{pct(realUsage.acceptanceRate)}</span>
                </div>
              </>
            )}
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <div className="text-xs font-semibold text-[var(--text-primary)]">Golden-set recall</div>
            {!goldenSet || goldenSet.total === 0 ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                No rule-flagged items in the current scan to compare against.
              </p>
            ) : (
              <div className="font-[family-name:var(--font-data)] mt-1 text-xs text-[var(--text-secondary)]">
                {goldenSet.matched}/{goldenSet.total} rule-flagged items agreed with (
                {pct(goldenSet.recall)})
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
