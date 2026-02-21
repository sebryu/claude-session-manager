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
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  // Show time for sessions from last 5 dates
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.floor((todayStart.getTime() - sessionDay.getTime()) / (1000 * 60 * 60 * 24));

  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `yest ${time}`;
  if (dayDiff < 5) {
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday} ${time}`;
  }
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

/**
 * Compute the 5 flexible column widths [name, project, worktree, session, branch] for
 * the session list table given the available terminal width.
 *
 * Fixed columns (ID=36, Date=11, Dur=5, Msgs=5, Tokens=7, Size=7) plus the
 * 10 two-space separators between 11 columns sum to 91 chars. The remainder
 * is distributed proportionally among the flexible columns.
 */
export function computeListColWidths(termWidth: number): [number, number, number, number, number] {
  const FIXED_TOTAL = 36 + 11 + 5 + 5 + 7 + 7 + 10 * 2; // 91
  const MIN: [number, number, number, number, number] = [8, 12, 10, 18, 8]; // name, project, worktree, session, branch
  const WEIGHTS: [number, number, number, number, number] = [0.10, 0.20, 0.13, 0.37, 0.20]; // sum = 1.00

  const available = termWidth - FIXED_TOTAL;
  const minTotal = MIN.reduce((a, b) => a + b, 0);
  const flexSpace = Math.max(minTotal, available);

  return MIN.map((min, i) =>
    Math.max(min, Math.round(WEIGHTS[i]! * flexSpace))
  ) as [number, number, number, number, number];
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
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? path;
  // Use last 2 segments if the last one is too short to be meaningful
  if (last.length < 4 && parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return last;
}

const WORKTREE_MARKER = "/.claude/worktrees/";

/** Parse a project path into base project name and optional worktree name */
export function parseProjectPath(path: string): { project: string; worktree?: string } {
  const idx = path.indexOf(WORKTREE_MARKER);
  if (idx !== -1) {
    return {
      project: projectName(path.slice(0, idx)),
      worktree: path.slice(idx + WORKTREE_MARKER.length),
    };
  }
  return { project: projectName(path) };
}
