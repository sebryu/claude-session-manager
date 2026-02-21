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

/**
 * Compute all 21 column widths for the verbose table, fitting into termWidth.
 *
 * 16 fixed cols (ID=8, Date=10, Dur=3, Msgs=4, Tok=6, Sz=6, Files=5, Lines=10,
 * Cmts=4, Err=3, Int=3, Lang=5, Feat=3, Type=5, Out=4, Help=5) = 84 chars.
 * 20 single-space separators = 20 chars. Fixed total = 104.
 * Remaining space is split among 5 flexible cols: Name, Project, WT, Session, Branch.
 *
 * Column order returned:
 * [ID, Name, Project, WT, Session, Branch, Date, Dur, Msgs, Tok, Sz,
 *  Files, Lines, Cmts, Err, Int, Lang, Feat, Type, Out, Help]
 */
export function computeVerboseColWidths(termWidth: number): number[] {
  const FIXED_SUM = 8 + 10 + 3 + 4 + 6 + 6 + 5 + 10 + 4 + 3 + 3 + 5 + 3 + 5 + 4 + 5; // 84
  const SEPARATORS = 20; // 21 cols, 1-space gaps
  const FIXED_TOTAL = FIXED_SUM + SEPARATORS; // 104

  const FLEX_MIN = [6, 8, 6, 14, 6] as const; // name, project, wt, session, branch
  const FLEX_WEIGHTS = [0.10, 0.20, 0.15, 0.40, 0.15] as const;

  const available = Math.max(
    FLEX_MIN.reduce((a, b) => a + b, 0),
    termWidth - FIXED_TOTAL
  );
  const [wName, wProject, wWT, wSession, wBranch] = FLEX_MIN.map((min, i) =>
    Math.max(min, Math.round(FLEX_WEIGHTS[i]! * available))
  );

  return [8, wName!, wProject!, wWT!, wSession!, wBranch!, 10, 3, 4, 6, 6, 5, 10, 4, 3, 3, 5, 3, 5, 4, 5];
}

/** Print a table with column headers and rows */
export function printTable(
  headers: string[],
  rows: string[][],
  colWidths: number[],
  aligns?: ("l" | "r")[],
  gap: number = 2
) {
  const sep = " ".repeat(gap);
  // Header
  const headerLine = headers
    .map((h, i) => {
      const padFn = aligns?.[i] === "r" ? padLeft : padRight;
      return `${c.bold}${padFn(h, colWidths[i]!)}${c.reset}`;
    })
    .join(sep);
  console.log(headerLine);
  console.log(c.dim + "\u2500".repeat(colWidths.reduce((a, b) => a + b + gap, -gap)) + c.reset);

  // Rows
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

/** Format lines added/removed compactly */
export function formatLines(added: number, removed: number): string {
  if (added === 0 && removed === 0) return "-";
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  return `+${fmt(added)}/-${fmt(removed)}`;
}

/** Feature flags as compact 3-char string: T=task, M=mcp, W=web */
export function formatFeatureFlags(meta?: {
  uses_task_agent?: boolean;
  uses_mcp?: boolean;
  uses_web_search?: boolean;
  uses_web_fetch?: boolean;
} | undefined): string {
  if (!meta) return "---";
  return [
    meta.uses_task_agent ? "T" : "-",
    meta.uses_mcp ? "M" : "-",
    (meta.uses_web_search || meta.uses_web_fetch) ? "W" : "-",
  ].join("");
}

/** Abbreviate outcome field */
export function formatOutcome(outcome?: string): string {
  if (!outcome) return "-";
  const l = outcome.toLowerCase();
  if (l.includes("fully")) return "full";
  if (l.includes("partial")) return "part";
  if (l.includes("not") || l.includes("fail")) return "no";
  return outcome.slice(0, 4);
}

/** Abbreviate session_type field */
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

/** Abbreviate claude_helpfulness field */
export function formatHelpfulness(h?: string): string {
  if (!h) return "-";
  const l = h.toLowerCase();
  if (l.startsWith("very")) return "v.hi";
  if (l === "helpful") return "hi";
  if (l.includes("somewhat")) return "mid";
  if (l.includes("not")) return "low";
  return h.slice(0, 4);
}

/** Primary language from languages record */
export function primaryLanguage(languages?: Record<string, number>): string {
  if (!languages) return "-";
  const entries = Object.entries(languages);
  if (entries.length === 0) return "-";
  const [lang] = entries.sort((a, b) => b[1] - a[1])[0]!;
  return lang.slice(0, 5);
}

/** Average of an array, formatted as seconds */
export function avgResponseTime(times?: number[]): string {
  if (!times || times.length === 0) return "-";
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  if (avg < 60) return `${Math.round(avg)}s`;
  return `${Math.round(avg / 60)}m`;
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
