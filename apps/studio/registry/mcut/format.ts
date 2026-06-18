/** 90500 → "1:30.5" (minutes:seconds.tenths). */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** Ruler label: 90000 → "1:30". */
export function formatRulerLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 90500 → "1:31" rounded duration for badges. */
export function formatDurationBadge(ms: number): string {
  return formatRulerLabel(Math.round(ms / 1000) * 1000);
}
