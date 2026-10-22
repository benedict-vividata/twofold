export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${String(days)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${String(seconds)}s`;
  if (minutes < 60) return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

export function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@\s]+@/, "//***@");
}
