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

export function padRight(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - str.length));
}

export function padLeft(str: string, width: number): string {
  return " ".repeat(Math.max(0, width - str.length)) + str;
}

// ── Table layout ──────────────────────────────────────────────

/** Column definition: single source of truth for header, alignment, and sizing. */
export interface ColSpec {
  header: string;
  align: "l" | "r";
  /** Minimum (and fixed, when no weight) column width in chars. */
  min: number;
  /**
   * When set, the column is flexible and receives a share of available space
   * proportional to its weight. All weights across flexible columns should sum to 1.
   */
  weight?: number;
}

/**
 * Compute column widths from a ColSpec array, fitting within termWidth.
 *
 * Fixed columns (no weight) always render at their `min` width.
 * Flex columns (with weight) share the remaining terminal space proportionally,
 * each guaranteed at least their `min` width.
 */
export function computeColWidths(termWidth: number, cols: ColSpec[], gap: number): number[] {
  const separators = (cols.length - 1) * gap;
  const fixedSum = cols.reduce((a, col) => a + (col.weight ? 0 : col.min), 0);
  const flexMinSum = cols.reduce((a, col) => a + (col.weight ? col.min : 0), 0);
  const available = Math.max(flexMinSum, termWidth - fixedSum - separators);
  const totalWeight = cols.reduce((a, col) => a + (col.weight ?? 0), 0);
  return cols.map((col) =>
    col.weight ? Math.max(col.min, Math.round(available * col.weight / totalWeight)) : col.min
  );
}

/** Print a table with column headers and rows. */
export function printTable(
  headers: string[],
  rows: string[][],
  colWidths: number[],
  aligns?: ("l" | "r")[],
  gap: number = 2
) {
  const sep = " ".repeat(gap);
  const headerLine = headers
    .map((h, i) => {
      const padFn = aligns?.[i] === "r" ? padLeft : padRight;
      return `${c.bold}${padFn(h, colWidths[i]!)}${c.reset}`;
    })
    .join(sep);
  console.log(headerLine);
  console.log(c.dim + "\u2500".repeat(colWidths.reduce((a, b) => a + b + gap, -gap)) + c.reset);

  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const padFn = aligns?.[i] === "r" ? padLeft : padRight;
        return padFn(cell, colWidths[i]!);
      })
      .join(sep);
    console.log(line);
  }
}

// ── Path helpers ──────────────────────────────────────────────

export function projectName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? path;
  if (last.length < 4 && parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return last;
}

const WORKTREE_MARKER = "/.claude/worktrees/";

/** Split a project path into base project name and optional worktree name. */
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

// ── Verbose-table cell formatters ─────────────────────────────

/** Format lines added/removed compactly, e.g. `+716/-29` or `+1k/-0`. */
export function formatLines(added: number, removed: number): string {
  if (added === 0 && removed === 0) return "-";
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  return `+${fmt(added)}/-${fmt(removed)}`;
}

/** Feature flags as a compact 3-char string: T=task agent, M=MCP, W=web. */
export function formatFeatureFlags(meta?: {
  uses_task_agent?: boolean;
  uses_mcp?: boolean;
  uses_web_search?: boolean;
  uses_web_fetch?: boolean;
}): string {
  if (!meta) return "---";
  return [
    meta.uses_task_agent ? "T" : "-",
    meta.uses_mcp ? "M" : "-",
    (meta.uses_web_search || meta.uses_web_fetch) ? "W" : "-",
  ].join("");
}

/** Abbreviate `facets.outcome` to 4 chars. */
export function formatOutcome(outcome?: string): string {
  if (!outcome) return "-";
  const l = outcome.toLowerCase();
  if (l.includes("fully")) return "full";
  if (l.includes("partial")) return "part";
  if (l.includes("not") || l.includes("fail")) return "no";
  return outcome.slice(0, 4);
}

/** Abbreviate `facets.session_type` to 5 chars. */
export function formatSessionType(type?: string): string {
  if (!type) return "-";
  const map: Record<string, string> = {
    coding: "code",
    debugging: "debug",
    analysis: "anlys",
    planning: "plan",
    review: "rev",
    documentation: "docs",
    research: "rsrch",
    iterative_refinement: "iter",
    configuration: "cfg",
    troubleshooting: "trbl",
  };
  return (map[type.toLowerCase()] ?? type).slice(0, 5);
}

/** Abbreviate `facets.claude_helpfulness` to 4 chars. */
export function formatHelpfulness(h?: string): string {
  if (!h) return "-";
  const l = h.toLowerCase();
  if (l.startsWith("very")) return "v.hi";
  if (l === "helpful") return "hi";
  if (l.includes("somewhat")) return "mid";
  if (l.includes("not")) return "low";
  return h.slice(0, 4);
}

/** Top language from `meta.languages`, truncated to 5 chars. */
export function primaryLanguage(languages?: Record<string, number>): string {
  if (!languages) return "-";
  const entries = Object.entries(languages);
  if (entries.length === 0) return "-";
  const [lang] = entries.sort((a, b) => b[1] - a[1])[0]!;
  return lang.slice(0, 5);
}
