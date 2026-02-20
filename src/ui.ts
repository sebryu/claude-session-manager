// ANSI color helpers
export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) return "-";
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDurationShort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function relativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Pad string to width, right-aligned */
export function padRight(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - str.length));
}

export function padLeft(str: string, width: number): string {
  return " ".repeat(Math.max(0, width - str.length)) + str;
}

/** Print a table with column headers and rows */
export function printTable(
  headers: string[],
  rows: string[][],
  colWidths: number[],
  aligns?: ("l" | "r")[]
) {
  // Header
  const headerLine = headers
    .map((h, i) => {
      const padFn = aligns?.[i] === "r" ? padLeft : padRight;
      return `${c.bold}${padFn(h, colWidths[i]!)}${c.reset}`;
    })
    .join("  ");
  console.log(headerLine);
  console.log(c.dim + "\u2500".repeat(colWidths.reduce((a, b) => a + b + 2, -2)) + c.reset);

  // Rows
  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const padFn = aligns?.[i] === "r" ? padLeft : padRight;
        return padFn(cell, colWidths[i]!);
      })
      .join("  ");
    console.log(line);
  }
}

export function projectName(path: string): string {
  const parts = path.split("/");
  // Return last 2 segments for context
  return parts.slice(-2).join("/");
}
