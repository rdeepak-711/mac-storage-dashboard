import type { Activity, Disposition, Recoverability } from "../lib/scan-types";

/**
 * The badge that replaced the single word "safe" on 2026-09-03.
 *
 * Extracted into its own component because it is now rendered
 * identically in two places (ListLevel and TreemapLevel) and carries
 * real meaning rather than a colour: a green "safe" pill trained the eye
 * to click without reading, which is exactly how one click could have
 * deleted 5.6 GB of ML models. What's shown now is what the user
 * actually needs to decide — how it comes back, and when they last
 * touched it.
 */

const RECOVERABILITY_LABEL: Record<Recoverability, string> = {
  instant: "rebuilt locally",
  redownload: "re-downloads",
  irreplaceable: "not recoverable",
};

/**
 * Deliberately NOT a green/amber pair. Suggested items are calm and
 * neutral, review items are amber. Nothing here is green: green reads as
 * "approved, go ahead", and no item in this tool has earned that.
 */
const DISPOSITION_STYLE: Record<Disposition, string> = {
  suggested: "bg-[color-mix(in_oklch,oklch(0.64_0.09_230)_25%,var(--bg))] text-[oklch(0.82_0.09_230)]",
  review: "bg-[color-mix(in_oklch,oklch(0.64_0.15_60)_25%,var(--bg))] text-[oklch(0.8_0.15_60)]",
};

function daysAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, "");
  return `${years}y ago`;
}

export function FlagBadge({
  disposition,
  recoverability,
  activity,
  lastTouchedAt,
}: {
  disposition: Disposition;
  recoverability: Recoverability;
  activity: Activity;
  lastTouchedAt: string | null;
}) {
  const touched = daysAgo(lastTouchedAt);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${DISPOSITION_STYLE[disposition]}`}
      >
        {disposition === "review" ? "your call" : "suggested"}
      </span>
      <span className="rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
        {RECOVERABILITY_LABEL[recoverability]}
      </span>
      {touched && (
        <span
          className="rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
          title={`Last modified ${lastTouchedAt} (${activity})`}
        >
          {touched}
        </span>
      )}
    </span>
  );
}
