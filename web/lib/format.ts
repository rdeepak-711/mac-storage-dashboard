/**
 * Shared display formatting — extracted 2026-09-01 after a real bug:
 * a genuinely tiny but real category (Documents+Music+Photos combined,
 * 4.97 MB) displayed as "0.00 GB", reading as broken/zero rather than
 * small. Switches units the way macOS's own Storage settings does
 * (real reference: "50 MB", "1.1 MB", "914.7 MB" for its small
 * categories) instead of always truncating to 2-decimal GB.
 */
export function formatBytes(bytes: number): string {
  const GB = 1_000_000_000;
  const MB = 1_000_000;
  const KB = 1_000;
  if (bytes >= 0.01 * GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function categoryLabel(category: string): string {
  return category.replace("-", " ");
}
