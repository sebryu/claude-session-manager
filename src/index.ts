#!/usr/bin/env bun

import { select, checkbox, confirm, Separator } from "@inquirer/prompts";
import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getAllSessions,
  getSessionLabel,
  searchSessions,
  deleteSession,
  setDebug,
  getClaudeDir,
  type EnrichedSession,
} from "./sessions.ts";
import {
  c,
  initColor,
  formatBytes,
  formatTokens,
  formatDurationShort,
  truncate,
  formatDate,
  formatDuration,
  relativeDate,
  printTable,
  projectName,
  parseProjectPath,
  computeColWidths,
  formatLines,
  formatFeatureFlags,
  formatOutcome,
  formatSessionType,
  formatHelpfulness,
  primaryLanguage,
  padRight,
  padLeft,
  type ColSpec,
} from "./ui.ts";

// ── Constants ────────────────────────────────────────────────

const FALLBACK_TERM_WIDTH = 120;
export const FALLBACK_TERM_HEIGHT = 24;
/** Compute pageSize for inquirer prompts so they fill the terminal height. Reserve lines for prompt chrome / header. */
export const termPageSize = (reserved = 4) =>
  Math.max(5, (process.stdout.rows ?? FALLBACK_TERM_HEIGHT) - reserved);
const VALID_SORT_KEYS = ["date", "size", "tokens", "duration", "messages", "files-changed", "commits"];

// ── Arg parsing ──────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "help";

function getFlag(long: string, short?: string): string | undefined {
  const longIdx = args.indexOf(`--${long}`);
  if (longIdx !== -1) return args[longIdx + 1];
  if (short) {
    const shortIdx = args.indexOf(`-${short}`);
    if (shortIdx !== -1) return args[shortIdx + 1];
  }
  return undefined;
}

function hasFlag(long: string, short?: string): boolean {
  if (args.includes(`--${long}`)) return true;
  if (short && args.includes(`-${short}`)) return true;
  return false;
}

function getFlagValue(long: string, short?: string): string | undefined {
  // Support --flag=value syntax too
  for (const arg of args) {
    if (arg.startsWith(`--${long}=`)) return arg.slice(long.length + 3);
  }
  return getFlag(long, short);
}

function getVerbosityLevel(): number {
  let level = 0;
  for (const arg of args) {
    if (arg === "--verbose") level += 1;
    else if (/^-v+$/.test(arg)) level += arg.length - 1;
  }
  return level;
}

// ── Color / debug init ────────────────────────────────────────

const colorFlag = getFlagValue("color") as "always" | "auto" | "never" | undefined;
initColor(colorFlag ?? (process.env["NO_COLOR"] !== undefined ? "never" : "auto"));

setDebug(hasFlag("debug"));

// ── Config file + env var defaults ────────────────────────────

interface CsmConfig {
  sort?: string;
  limit?: number;
  project?: string;
}

async function loadConfig(): Promise<CsmConfig> {
  const configPath = join(homedir(), ".csm.config.json");
  try {
    const content = await import("node:fs/promises").then(m => m.readFile(configPath, "utf-8"));
    try {
      return JSON.parse(content) as CsmConfig;
    } catch {
      process.stderr.write(`[warn] could not parse ~/.csm.config.json\n`);
      return {};
    }
  } catch {
    return {};
  }
}

const config = await loadConfig();

function getConfigSort(): string {
  return getFlag("sort", "s") ?? process.env["CSM_SORT"] ?? config.sort ?? "date";
}
function getConfigProject(): string | undefined {
  return getFlag("project", "p") ?? process.env["CSM_PROJECT"] ?? config.project;
}
function getConfigLimit(): number | undefined {
  const str = getFlag("limit", "n") ?? process.env["CSM_LIMIT"];
  if (!str) return config.limit;
  const n = parseInt(str, 10);
  if (isNaN(n) || n <= 0) {
    process.stderr.write(`[error] --limit must be a positive integer, got: ${str}\n`);
    process.exit(1);
  }
  return n;
}

const verbosityLevel = getVerbosityLevel();

// ── Parse size strings ────────────────────────────────────────

export function parseSizeString(s: string): number | undefined {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!m) return undefined;
  const val = parseFloat(m[1] ?? "0");
  const unit = (m[2] ?? "B").toUpperCase();
  const multiplier: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return val * (multiplier[unit] ?? 1);
}

// ── Session helpers ───────────────────────────────────────────

export function sessionTokens(s: EnrichedSession): number {
  return (s.meta?.input_tokens ?? 0) + (s.meta?.output_tokens ?? 0)
    || (s.computedInputTokens ?? 0) + (s.computedOutputTokens ?? 0);
}

export function sessionDuration(s: EnrichedSession): number | undefined {
  return s.meta?.duration_minutes ?? s.computedDurationMinutes;
}

// ── Column definitions ────────────────────────────────────────
// Single source of truth for header label, alignment, and sizing.
// See docs/columns.md for full documentation of each column.

const MINIMAL_COLS: ColSpec[] = [
  { header: "ID",      align: "l", min: 8  },
  { header: "Project", align: "l", min: 10, weight: 0.25 },
  { header: "Session", align: "l", min: 16, weight: 0.60 },
  { header: "Date",    align: "l", min: 11 },
  { header: "Msgs",    align: "r", min: 4  },
];

const LIST_COLS: ColSpec[] = [
  { header: "ID",       align: "l", min: 36 },
  { header: "Name",     align: "l", min: 8,  weight: 0.10 },
  { header: "Project",  align: "l", min: 12, weight: 0.20 },
  { header: "Worktree", align: "l", min: 10, weight: 0.13 },
  { header: "Session",  align: "l", min: 18, weight: 0.37 },
  { header: "Branch",   align: "l", min: 8,  weight: 0.20 },
  { header: "Date",     align: "l", min: 11 },
  { header: "Dur",      align: "r", min: 5  },
  { header: "Msgs",     align: "r", min: 5  },
  { header: "Tokens",   align: "r", min: 7  },
  { header: "Size",     align: "r", min: 7  },
];

const VERBOSE_COLS: ColSpec[] = [
  { header: "ID",      align: "l", min: 8  },
  { header: "Name",    align: "l", min: 6,  weight: 0.10 },
  { header: "Project", align: "l", min: 8,  weight: 0.20 },
  { header: "WT",      align: "l", min: 6,  weight: 0.15 },
  { header: "Session", align: "l", min: 14, weight: 0.40 },
  { header: "Branch",  align: "l", min: 6,  weight: 0.15 },
  { header: "Date",    align: "l", min: 10 },
  { header: "Dur",     align: "r", min: 3  },
  { header: "Msgs",    align: "r", min: 4  },
  { header: "Tok",     align: "r", min: 6  },
  { header: "Sz",      align: "r", min: 6  },
  { header: "Files",   align: "r", min: 5  },
  { header: "Lines",   align: "r", min: 10 },
  { header: "Cmts",    align: "r", min: 4  },
  { header: "Err",     align: "r", min: 3  },
  { header: "Int",     align: "r", min: 3  },
  { header: "Lang",    align: "l", min: 5  },
  { header: "Feat",    align: "l", min: 3  },
  { header: "Type",    align: "l", min: 5  },
  { header: "Out",     align: "l", min: 4  },
  { header: "Help",    align: "l", min: 5  },
];

const VERBOSE_COL_LEGEND =
  "WT=Worktree  Cmts=Commits  Int=Interruptions  Out=Outcome  Type=SessionType  Lang=Language  Feat=Features(T/M/W)  Err=ToolErrors";

// ── Interactive row formatting ────────────────────────────────

/** Pick the column spec and gap for a given verbosity level. */
function browseColSpec(level: number): { cols: ColSpec[]; gap: number } {
  if (level >= 2) return { cols: VERBOSE_COLS, gap: 1 };
  if (level >= 1) return { cols: LIST_COLS, gap: 2 };
  return { cols: MINIMAL_COLS, gap: 2 };
}

/** Build a single row string for an interactive choice. */
function formatInteractiveRow(
  s: EnrichedSession,
  cols: ColSpec[],
  widths: number[],
  gap: number,
  level: number,
): string {
  const sep = " ".repeat(gap);
  let cells: string[];

  if (level >= 2) {
    // Verbose table cells (mirrors printVerboseTable)
    const { project, worktree } = parseProjectPath(s.entry.projectPath);
    const dur = sessionDuration(s);
    const tok = sessionTokens(s);
    const m = s.meta;
    const f = s.facets;
    cells = [
      s.entry.sessionId.slice(0, 8),
      truncate(s.entry.customTitle ?? "-", widths[1] ?? 6),
      truncate(project, widths[2] ?? 8),
      truncate(worktree ?? "-", widths[3] ?? 6),
      truncate(getSessionLabel(s), widths[4] ?? 14),
      truncate(s.entry.gitBranch ?? "-", widths[5] ?? 6),
      relativeDate(s.entry.modified),
      dur != null && dur > 0 ? formatDurationShort(dur) : "-",
      String(s.entry.messageCount),
      tok > 0 ? formatTokens(tok) : "-",
      formatBytes(s.totalSizeBytes),
      m ? String(m.files_modified) : "-",
      m ? formatLines(m.lines_added, m.lines_removed) : "-",
      m?.git_commits != null ? String(m.git_commits) : "-",
      m?.tool_errors != null ? String(m.tool_errors) : "-",
      m?.user_interruptions != null ? String(m.user_interruptions) : "-",
      primaryLanguage(m?.languages),
      formatFeatureFlags(m ?? undefined),
      formatSessionType(f?.session_type),
      formatOutcome(f?.outcome),
      formatHelpfulness(f?.claude_helpfulness),
    ];
  } else if (level >= 1) {
    // Standard table cells (mirrors printListTable)
    const { project, worktree } = parseProjectPath(s.entry.projectPath);
    const dur = sessionDuration(s);
    const tok = sessionTokens(s);
    cells = [
      s.entry.sessionId,
      truncate(s.entry.customTitle ?? "-", widths[1] ?? 8),
      truncate(project, widths[2] ?? 12),
      truncate(worktree ?? "-", widths[3] ?? 10),
      truncate(getSessionLabel(s), widths[4] ?? 18),
      truncate(s.entry.gitBranch ?? "-", widths[5] ?? 8),
      relativeDate(s.entry.modified),
      dur != null && dur > 0 ? formatDurationShort(dur) : "-",
      String(s.entry.messageCount),
      tok > 0 ? formatTokens(tok) : "-",
      formatBytes(s.totalSizeBytes),
    ];
  } else {
    // Minimal table cells (mirrors printMinimalTable)
    const { project } = parseProjectPath(s.entry.projectPath);
    cells = [
      s.entry.sessionId.slice(0, 8),
      truncate(project, widths[1] ?? 10),
      truncate(getSessionLabel(s), widths[2] ?? 16),
      relativeDate(s.entry.modified),
      String(s.entry.messageCount),
    ];
  }

  return cells
    .map((cell, i) => {
      const padFn = cols[i]?.align === "r" ? padLeft : padRight;
      return padFn(cell, widths[i] ?? 0);
    })
    .join(sep);
}

/** Print a header + divider for interactive lists. */
function printInteractiveHeader(
  cols: ColSpec[],
  widths: number[],
  gap: number,
  indent: number,
): void {
  const sep = " ".repeat(gap);
  const prefix = " ".repeat(indent);
  const headerLine = cols
    .map((col, i) => `${c.bold}${padRight(col.header, widths[i] ?? 0)}${c.reset}`)
    .join(sep);
  const totalWidth = widths.reduce((a, b) => a + b + gap, -gap);
  const divider = "\u2500".repeat(totalWidth);
  console.log(`${prefix}${headerLine}`);
  console.log(`${prefix}${c.dim}${divider}${c.reset}`);
}

// ── Progress display ──────────────────────────────────────────

function makeProgressCallback(): (loaded: number, total: number) => void {
  return (loaded, total) => {
    process.stderr.write(`\rLoading sessions... ${loaded}/${total}  `);
    if (loaded >= total) process.stderr.write("\r\x1b[K");
  };
}

// ── Commands ─────────────────────────────────────────────────

async function cmdList() {
  const projectFilter = getConfigProject();
  const sortBy = getConfigSort();
  const limit = getConfigLimit();
  const outputJson = hasFlag("json");
  const outputIds = hasFlag("ids-only");
  const reverse = hasFlag("reverse", "r");
  const exitOnEmpty = hasFlag("exit-2-on-empty");

  // Validate sort key
  if (!VALID_SORT_KEYS.includes(sortBy)) {
    process.stderr.write(`[error] --sort must be one of: ${VALID_SORT_KEYS.join(", ")}\n`);
    process.exit(1);
  }

  // Parse additional filters
  const afterStr = getFlag("after");
  const beforeStr = getFlag("before");
  const minSizeStr = getFlag("min-size");
  const maxSizeStr = getFlag("max-size");
  const minTokensStr = getFlag("min-tokens");
  const outcomeFilter = getFlag("outcome");

  let afterDate: Date | undefined;
  let beforeDate: Date | undefined;
  if (afterStr) {
    afterDate = new Date(afterStr);
    if (isNaN(afterDate.getTime())) {
      process.stderr.write(`[error] --after: invalid date "${afterStr}"\n`);
      process.exit(1);
    }
  }
  if (beforeStr) {
    beforeDate = new Date(beforeStr);
    if (isNaN(beforeDate.getTime())) {
      process.stderr.write(`[error] --before: invalid date "${beforeStr}"\n`);
      process.exit(1);
    }
  }
  let minSizeBytes: number | undefined;
  let maxSizeBytes: number | undefined;
  if (minSizeStr) {
    minSizeBytes = parseSizeString(minSizeStr);
    if (minSizeBytes === undefined) {
      process.stderr.write(`[error] --min-size: invalid size "${minSizeStr}" (example: 50MB)\n`);
      process.exit(1);
    }
  }
  if (maxSizeStr) {
    maxSizeBytes = parseSizeString(maxSizeStr);
    if (maxSizeBytes === undefined) {
      process.stderr.write(`[error] --max-size: invalid size "${maxSizeStr}" (example: 500MB)\n`);
      process.exit(1);
    }
  }
  let minTokens: number | undefined;
  if (minTokensStr) {
    minTokens = parseInt(minTokensStr, 10);
    if (isNaN(minTokens)) {
      process.stderr.write(`[error] --min-tokens must be a number, got: ${minTokensStr}\n`);
      process.exit(1);
    }
  }

  if (!outputJson && !outputIds) {
    console.log(`${c.cyan}${c.bold}Claude Session Manager${c.reset}\n`);
    console.log(`${c.dim}Loading sessions...${c.reset}`);
  }

  let sessions = await getAllSessions(makeProgressCallback());

  // Apply filters
  if (projectFilter) {
    const filter = projectFilter.toLowerCase();
    sessions = sessions.filter((s) =>
      s.entry.projectPath.toLowerCase().includes(filter)
    );
  }
  if (afterDate) {
    sessions = sessions.filter((s) => new Date(s.entry.modified) >= afterDate!);
  }
  if (beforeDate) {
    sessions = sessions.filter((s) => new Date(s.entry.modified) <= beforeDate!);
  }
  if (minSizeBytes !== undefined) {
    sessions = sessions.filter((s) => s.totalSizeBytes >= minSizeBytes!);
  }
  if (maxSizeBytes !== undefined) {
    sessions = sessions.filter((s) => s.totalSizeBytes <= maxSizeBytes!);
  }
  if (minTokens !== undefined) {
    sessions = sessions.filter((s) => sessionTokens(s) >= minTokens!);
  }
  if (outcomeFilter) {
    const of = outcomeFilter.toLowerCase();
    sessions = sessions.filter((s) =>
      (s.facets?.outcome ?? "").toLowerCase().includes(of)
    );
  }

  // Sort
  sessions.sort(getSortFn(sortBy));
  if (reverse) sessions.reverse();

  if (sessions.length === 0) {
    if (!outputJson && !outputIds) {
      console.log(`${c.yellow}No sessions found.${c.reset}`);
    }
    if (exitOnEmpty) process.exit(2);
    return;
  }

  // Machine-readable output modes
  if (outputJson) {
    const displayed = limit ? sessions.slice(0, limit) : sessions;
    console.log(JSON.stringify(displayed, null, 2));
    return;
  }
  if (outputIds) {
    const displayed = limit ? sessions.slice(0, limit) : sessions;
    for (const s of displayed) console.log(s.entry.sessionId);
    return;
  }

  // Compute totals before limiting
  const totalCount = sessions.length;
  const totalSize = sessions.reduce((a, s) => a + s.totalSizeBytes, 0);
  const totalTokens = sessions.reduce((a, s) => a + sessionTokens(s), 0);
  const totalDuration = sessions.reduce(
    (a, s) => a + (sessionDuration(s) ?? 0),
    0
  );

  console.log(
    `${c.dim}Found ${c.white}${totalCount}${c.dim} sessions (${formatBytes(totalSize)} total)${c.reset}\n`
  );

  const displayed = limit ? sessions.slice(0, limit) : sessions;

  if (verbosityLevel >= 3) {
    printVerboseList(displayed);
  } else if (verbosityLevel >= 2) {
    printVerboseTable(displayed);
  } else if (verbosityLevel >= 1) {
    printListTable(displayed);
  } else {
    printMinimalTable(displayed);
  }

  if (limit && limit < totalCount) {
    console.log(
      `\n${c.dim}Showing ${displayed.length} of ${totalCount} sessions${c.reset}`
    );
  }

  const totalHours = Math.round(totalDuration / 60);
  console.log(
    `\n${c.dim}${totalCount} sessions \u00b7 ${formatBytes(totalSize)} \u00b7 ${formatTokens(totalTokens)} tokens \u00b7 ${totalHours}h total${c.reset}`
  );
}

function printMinimalTable(sessions: EnrichedSession[]) {
  const termWidth = process.stdout.columns ?? FALLBACK_TERM_WIDTH;
  const widths = computeColWidths(termWidth, MINIMAL_COLS, 2);

  const rows = sessions.map((s) => {
    const { project } = parseProjectPath(s.entry.projectPath);
    return [
      s.entry.sessionId.slice(0, 8),
      truncate(project, widths[1] ?? 10),
      truncate(getSessionLabel(s), widths[2] ?? 16),
      relativeDate(s.entry.modified),
      String(s.entry.messageCount),
    ];
  });

  printTable(
    MINIMAL_COLS.map((col) => col.header),
    rows,
    widths,
    MINIMAL_COLS.map((col) => col.align)
  );
}

function printListTable(sessions: EnrichedSession[]) {
  const termWidth = process.stdout.columns ?? 160;
  const widths = computeColWidths(termWidth, LIST_COLS, 2);

  const rows = sessions.map((s) => {
    const { project, worktree } = parseProjectPath(s.entry.projectPath);
    const dur = sessionDuration(s);
    const tok = sessionTokens(s);
    return [
      s.entry.sessionId,
      truncate(s.entry.customTitle ?? "-", widths[1] ?? 8),
      truncate(project, widths[2] ?? 12),
      truncate(worktree ?? "-", widths[3] ?? 10),
      truncate(getSessionLabel(s), widths[4] ?? 18),
      truncate(s.entry.gitBranch ?? "-", widths[5] ?? 8),
      relativeDate(s.entry.modified),
      dur != null && dur > 0 ? formatDurationShort(dur) : "-",
      String(s.entry.messageCount),
      tok > 0 ? formatTokens(tok) : "-",
      formatBytes(s.totalSizeBytes),
    ];
  });

  printTable(
    LIST_COLS.map((col) => col.header),
    rows,
    widths,
    LIST_COLS.map((col) => col.align)
  );
}

function printVerboseTable(sessions: EnrichedSession[]) {
  const termWidth = process.stdout.columns ?? 160;
  const widths = computeColWidths(termWidth, VERBOSE_COLS, 1);

  const rows = sessions.map((s) => {
    const { project, worktree } = parseProjectPath(s.entry.projectPath);
    const dur = sessionDuration(s);
    const tok = sessionTokens(s);
    const m = s.meta;
    const f = s.facets;
    return [
      s.entry.sessionId.slice(0, 8),
      truncate(s.entry.customTitle ?? "-", widths[1] ?? 6),
      truncate(project, widths[2] ?? 8),
      truncate(worktree ?? "-", widths[3] ?? 6),
      truncate(getSessionLabel(s), widths[4] ?? 14),
      truncate(s.entry.gitBranch ?? "-", widths[5] ?? 6),
      relativeDate(s.entry.modified),
      dur != null && dur > 0 ? formatDurationShort(dur) : "-",
      String(s.entry.messageCount),
      tok > 0 ? formatTokens(tok) : "-",
      formatBytes(s.totalSizeBytes),
      m ? String(m.files_modified) : "-",
      m ? formatLines(m.lines_added, m.lines_removed) : "-",
      m?.git_commits != null ? String(m.git_commits) : "-",
      m?.tool_errors != null ? String(m.tool_errors) : "-",
      m?.user_interruptions != null ? String(m.user_interruptions) : "-",
      primaryLanguage(m?.languages),
      formatFeatureFlags(m ?? undefined),
      formatSessionType(f?.session_type),
      formatOutcome(f?.outcome),
      formatHelpfulness(f?.claude_helpfulness),
    ];
  });

  printTable(
    VERBOSE_COLS.map((col) => col.header),
    rows,
    widths,
    VERBOSE_COLS.map((col) => col.align),
    1
  );
  console.log(`\n${c.dim}${VERBOSE_COL_LEGEND}${c.reset}`);
}

function printVerboseList(sessions: EnrichedSession[]) {
  for (const s of sessions) {
    const { entry, meta, facets, totalSizeBytes } = s;
    const sep = c.dim + "\u2500".repeat(80) + c.reset;
    console.log(sep);

    console.log(`  ${c.cyan}${c.bold}${entry.sessionId}${c.reset}`);

    const name = entry.customTitle ?? "-";
    console.log(
      `  ${c.bold}Name:${c.reset} ${c.white}${name}${c.reset}` +
      `     ${c.bold}Project:${c.reset} ${entry.projectPath}`
    );

    const label = getSessionLabel(s);
    console.log(
      `  ${c.bold}Label:${c.reset} ${c.green}${truncate(label, 60)}${c.reset}` +
      (entry.gitBranch ? `     ${c.bold}Branch:${c.reset} ${entry.gitBranch}` : "")
    );

    console.log(
      `  ${c.bold}Created:${c.reset} ${formatDate(entry.created)}` +
      `     ${c.bold}Modified:${c.reset} ${formatDate(entry.modified)} (${relativeDate(entry.modified)})` +
      (meta?.duration_minutes != null
        ? `     ${c.bold}Duration:${c.reset} ${formatDuration(meta.duration_minutes)}`
        : "")
    );

    const userMsgs = meta?.user_message_count ?? "?";
    const asstMsgs = meta?.assistant_message_count ?? "?";
    const inTok = meta?.input_tokens ?? 0;
    const outTok = meta?.output_tokens ?? 0;
    console.log(
      `  ${c.bold}Messages:${c.reset} ${entry.messageCount} (${userMsgs} user / ${asstMsgs} asst)` +
      `     ${c.bold}Size:${c.reset} ${formatBytes(totalSizeBytes)}` +
      (inTok + outTok > 0
        ? `     ${c.bold}Tokens:${c.reset} ${formatTokens(inTok)} in / ${formatTokens(outTok)} out`
        : "")
    );

    if (meta) {
      const parts: string[] = [];
      if (meta.files_modified > 0)
        parts.push(`${c.bold}Files:${c.reset} ${meta.files_modified} modified`);
      if (meta.lines_added > 0 || meta.lines_removed > 0)
        parts.push(`${c.bold}Lines:${c.reset} ${c.green}+${meta.lines_added}${c.reset} / ${c.red}-${meta.lines_removed}${c.reset}`);
      if (meta.git_commits)
        parts.push(`${c.bold}Git:${c.reset} ${meta.git_commits} commit${meta.git_commits !== 1 ? "s" : ""}${meta.git_pushes ? `, ${meta.git_pushes} push${meta.git_pushes !== 1 ? "es" : ""}` : ""}`);
      if (meta.user_interruptions)
        parts.push(`${c.bold}Interruptions:${c.reset} ${meta.user_interruptions}`);
      if (meta.tool_errors)
        parts.push(`${c.bold}Errors:${c.reset} ${meta.tool_errors}`);
      if (parts.length > 0) console.log(`  ${parts.join("     ")}`);

      if (Object.keys(meta.tool_counts).length > 0) {
        const tools = Object.entries(meta.tool_counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}(${v})`)
          .join(", ");
        console.log(`  ${c.bold}Tools:${c.reset} ${tools}`);
      }

      if (Object.keys(meta.languages).length > 0) {
        const langs = Object.entries(meta.languages)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}(${v})`)
          .join(", ");
        console.log(`  ${c.bold}Languages:${c.reset} ${langs}`);
      }

      const features = [
        meta.uses_task_agent && "Task Agent",
        meta.uses_mcp && "MCP",
        meta.uses_web_search && "Web Search",
        meta.uses_web_fetch && "Web Fetch",
      ].filter(Boolean) as string[];
      if (features.length > 0)
        console.log(`  ${c.bold}Features:${c.reset} ${features.join(", ")}`);
    }

    if (facets) {
      const facetParts: string[] = [];
      if (facets.session_type)
        facetParts.push(`${c.bold}Type:${c.reset} ${facets.session_type}`);
      if (facets.outcome)
        facetParts.push(`${c.bold}Outcome:${c.reset} ${facets.outcome}`);
      if (facets.claude_helpfulness)
        facetParts.push(`${c.bold}Helpfulness:${c.reset} ${facets.claude_helpfulness}`);
      if (facets.primary_success)
        facetParts.push(`${c.bold}Success:${c.reset} ${facets.primary_success}`);
      if (facetParts.length > 0) console.log(`  ${facetParts.join("     ")}`);

      if (facets.brief_summary)
        console.log(`  ${c.bold}Summary:${c.reset} ${facets.brief_summary}`);
      if (facets.underlying_goal)
        console.log(`  ${c.bold}Goal:${c.reset} ${facets.underlying_goal}`);
      if (facets.friction_detail)
        console.log(`  ${c.bold}Friction:${c.reset} ${c.yellow}${facets.friction_detail}${c.reset}`);
    }

    if (entry.firstPrompt && entry.firstPrompt !== "No prompt") {
      const cleaned = truncate(entry.firstPrompt.replace(/\n/g, " "), 120);
      console.log(`  ${c.bold}First Prompt:${c.reset} ${c.dim}${cleaned}${c.reset}`);
    }

    console.log();
  }
}

async function cmdFind() {
  const query = args.slice(1).filter((a) => !a.startsWith("-")).join(" ");
  const outputJson = hasFlag("json");
  const outputIds = hasFlag("ids-only");
  const reverse = hasFlag("reverse", "r");
  const exitOnEmpty = hasFlag("exit-2-on-empty");
  const limit = getConfigLimit();

  if (!query) {
    console.error(`${c.red}Usage: csm find <search query>${c.reset}`);
    console.error(`${c.dim}Example: csm find "expo upgrade"${c.reset}`);
    process.exit(1);
  }

  if (!outputJson && !outputIds) {
    console.log(
      `${c.cyan}${c.bold}Searching for:${c.reset} ${c.white}${query}${c.reset}\n`
    );
  }

  const allSessions = await getAllSessions(makeProgressCallback());
  let results = searchSessions(allSessions, query);
  if (reverse) results.reverse();

  if (results.length === 0) {
    if (!outputJson && !outputIds) {
      console.log(`${c.yellow}No sessions matching "${query}".${c.reset}`);
    }
    if (exitOnEmpty) process.exit(2);
    return;
  }

  if (outputJson) {
    console.log(JSON.stringify(results.slice(0, limit), null, 2));
    return;
  }
  if (outputIds) {
    for (const s of results.slice(0, limit)) console.log(s.entry.sessionId);
    return;
  }

  console.log(
    `${c.dim}Found ${c.white}${results.length}${c.dim} matching session(s)${c.reset}\n`
  );

  if (verbosityLevel >= 3) {
    printVerboseList(results.slice(0, limit));
  } else if (verbosityLevel >= 2) {
    printVerboseTable(results.slice(0, limit));
  } else if (verbosityLevel >= 1) {
    printListTable(results.slice(0, limit));
  } else {
    for (const s of results.slice(0, limit)) {
      const label = getSessionLabel(s);
      const proj = projectName(s.entry.projectPath);
      const tok = sessionTokens(s);
      const namePart = s.entry.customTitle
        ? `  ${c.magenta}[${s.entry.customTitle}]${c.reset}`
        : "";
      console.log(
        `  ${c.cyan}${s.entry.sessionId}${c.reset}${namePart}  ${c.green}${label}${c.reset}`
      );
      const pad = " ".repeat(38);
      const details = [
        proj,
        relativeDate(s.entry.modified),
        `${s.entry.messageCount} msgs`,
        formatBytes(s.totalSizeBytes),
        tok > 0 ? `${formatTokens(tok)} tokens` : null,
        s.entry.gitBranch ?? null,
      ].filter(Boolean).join(" | ");
      console.log(`${pad}${c.dim}${details}${c.reset}`);
      if (s.facets?.brief_summary) {
        console.log(`${pad}${c.dim}${truncate(s.facets.brief_summary, 80)}${c.reset}`);
      }
      console.log();
    }
  }

  if (results.length > 15) {
    console.log(
      `${c.dim}...and ${results.length - 15} more results${c.reset}`
    );
  }
}

async function cmdInfo() {
  const sessionId = args[1];
  const outputJson = hasFlag("json");
  const exitOnEmpty = hasFlag("exit-2-on-empty");

  if (!sessionId) {
    process.stderr.write(`${c.red}Usage: csm info <session-id>${c.reset}\n`);
    process.exit(1);
  }

  // Enforce minimum prefix length
  if (sessionId.length < 8) {
    process.stderr.write(
      `${c.red}Session ID prefix too short (min 8 chars, got ${sessionId.length})${c.reset}\n`
    );
    process.exit(1);
  }

  const sessions = await getAllSessions(makeProgressCallback());

  // Ambiguity check
  const matches = sessions.filter((s) =>
    s.entry.sessionId.startsWith(sessionId)
  );

  if (matches.length === 0) {
    if (!outputJson) {
      console.log(`${c.red}Session not found: ${sessionId}${c.reset}`);
    }
    if (exitOnEmpty) process.exit(2);
    process.exit(1);
  }

  if (matches.length > 1) {
    process.stderr.write(
      `${c.red}Ambiguous session ID prefix "${sessionId}" matches ${matches.length} sessions:${c.reset}\n`
    );
    for (const m of matches) {
      process.stderr.write(`  ${m.entry.sessionId}\n`);
    }
    process.exit(1);
  }

  const session = matches[0]!;

  if (outputJson) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  const { entry, meta, facets, totalSizeBytes } = session;

  console.log(`\n${c.cyan}${c.bold}Session Details${c.reset}\n`);

  const label = getSessionLabel(session);
  const rows: [string, string][] = [
    ["ID", entry.sessionId],
    ["Name", entry.customTitle ?? "-"],
    ["Label", label],
    ["Summary", entry.summary ?? "-"],
    ["First Prompt", truncate(entry.firstPrompt, 70)],
    ["Project", entry.projectPath],
    ["Git Branch", entry.gitBranch ?? "-"],
    ["Created", formatDate(entry.created)],
    ["Modified", `${formatDate(entry.modified)} (${relativeDate(entry.modified)})`],
    ["Messages", String(entry.messageCount)],
    ["Total Size", formatBytes(totalSizeBytes)],
  ];

  if (meta) {
    rows.push(
      ["Duration", formatDuration(meta.duration_minutes)],
      ["User Messages", String(meta.user_message_count)],
      ["Assistant Msgs", String(meta.assistant_message_count)],
      ["Input Tokens", meta.input_tokens.toLocaleString()],
      ["Output Tokens", meta.output_tokens.toLocaleString()],
      ["Files Modified", String(meta.files_modified)],
      ["Lines +/-", `${c.green}+${meta.lines_added}${c.reset} / ${c.red}-${meta.lines_removed}${c.reset}`],
    );

    if (meta.git_commits != null)
      rows.push(["Git Commits", String(meta.git_commits)]);
    if (meta.git_pushes != null)
      rows.push(["Git Pushes", String(meta.git_pushes)]);

    if (Object.keys(meta.tool_counts).length > 0) {
      const tools = Object.entries(meta.tool_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Tools Used", tools]);
    }

    if (Object.keys(meta.languages).length > 0) {
      const langs = Object.entries(meta.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Languages", langs]);
    }

    if (meta.user_interruptions != null)
      rows.push(["Interruptions", String(meta.user_interruptions)]);
    if (meta.tool_errors != null)
      rows.push(["Tool Errors", String(meta.tool_errors)]);

    if (meta.tool_error_categories && Object.keys(meta.tool_error_categories).length > 0) {
      const cats = Object.entries(meta.tool_error_categories)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Error Types", cats]);
    }

    const features = [
      meta.uses_task_agent && "Task Agent",
      meta.uses_mcp && "MCP",
      meta.uses_web_search && "Web Search",
      meta.uses_web_fetch && "Web Fetch",
    ].filter(Boolean) as string[];
    if (features.length > 0)
      rows.push(["Features", features.join(", ")]);
  }

  if (facets) {
    if (facets.brief_summary)
      rows.push(["Brief Summary", facets.brief_summary]);
    if (facets.underlying_goal)
      rows.push(["Goal", facets.underlying_goal]);
    if (facets.session_type)
      rows.push(["Session Type", facets.session_type]);
    if (facets.outcome) rows.push(["Outcome", facets.outcome]);
    if (facets.claude_helpfulness)
      rows.push(["Helpfulness", facets.claude_helpfulness]);
    if (facets.primary_success)
      rows.push(["Success", facets.primary_success]);
    if (facets.friction_detail)
      rows.push(["Friction", facets.friction_detail]);

    if (facets.goal_categories && Object.keys(facets.goal_categories).length > 0) {
      const cats = Object.entries(facets.goal_categories)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Goal Categories", cats]);
    }

    if (facets.friction_counts && Object.keys(facets.friction_counts).length > 0) {
      const fc = Object.entries(facets.friction_counts)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Friction Types", fc]);
    }
  }

  for (const [lbl, value] of rows) {
    console.log(`  ${c.bold}${lbl.padEnd(16)}${c.reset} ${value}`);
  }
  console.log();
}

async function cmdClean() {
  const olderThanStr = getFlag("older-than");
  const dryRun = hasFlag("dry-run");

  let olderThanDays: number | undefined;
  if (olderThanStr) {
    olderThanDays = parseInt(olderThanStr, 10);
    if (isNaN(olderThanDays) || olderThanDays <= 0) {
      process.stderr.write(`[error] --older-than must be a positive integer, got: ${olderThanStr}\n`);
      process.exit(1);
    }
  }

  console.log(`${c.cyan}${c.bold}Claude Session Cleaner${c.reset}\n`);

  const sessions = await getAllSessions(makeProgressCallback());

  if (sessions.length === 0) {
    console.log(`${c.yellow}No sessions found.${c.reset}`);
    return;
  }

  // Sort by date, oldest first
  sessions.sort(
    (a, b) =>
      new Date(a.entry.modified).getTime() -
      new Date(b.entry.modified).getTime()
  );

  let preSelectedIds: Set<string> | undefined;
  if (olderThanDays !== undefined) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    preSelectedIds = new Set(
      sessions
        .filter((s) => new Date(s.entry.modified).getTime() < cutoff)
        .map((s) => s.entry.sessionId)
    );
  }

  const choices = sessions.map((s) => {
    const label = truncate(getSessionLabel(s), 40);
    const proj = truncate(projectName(s.entry.projectPath), 18);
    return {
      name: `${proj.padEnd(20)} ${label.padEnd(42)} ${relativeDate(s.entry.modified).padEnd(10)} ${formatBytes(s.totalSizeBytes)}`,
      value: s.entry.sessionId,
      checked: preSelectedIds?.has(s.entry.sessionId) ?? false,
    };
  });

  if (dryRun) {
    console.log(`${c.yellow}[DRY RUN]${c.reset} Would show interactive selection for ${sessions.length} sessions:\n`);
    const headers = ["Project", "Session", "Date", "Size"];
    const colWidths = [20, 42, 10, 10];
    const rows = sessions.map((s) => [
      truncate(projectName(s.entry.projectPath), 20),
      truncate(getSessionLabel(s), 42),
      relativeDate(s.entry.modified),
      formatBytes(s.totalSizeBytes),
    ]);
    printTable(headers, rows, colWidths);

    if (preSelectedIds && preSelectedIds.size > 0) {
      const preSize = sessions
        .filter((s) => preSelectedIds!.has(s.entry.sessionId))
        .reduce((a, s) => a + s.totalSizeBytes, 0);
      console.log(
        `\n${c.dim}Would pre-select ${preSelectedIds.size} sessions older than ${olderThanDays} days (${formatBytes(preSize)})${c.reset}`
      );
    }
    return;
  }

  console.log(
    `${c.dim}Use arrow keys to navigate, space to select, enter to confirm${c.reset}\n`
  );

  let selected: string[];
  try {
    selected = await checkbox({
      message: "Select sessions to delete:",
      choices,
      pageSize: termPageSize(),
      loop: false,
    });
  } catch {
    console.log(`\n${c.dim}Cancelled.${c.reset}`);
    return;
  }

  if (selected.length === 0) {
    console.log(`${c.dim}No sessions selected.${c.reset}`);
    return;
  }

  const toDelete = sessions.filter((s) =>
    selected.includes(s.entry.sessionId)
  );
  const totalSize = toDelete.reduce((a, s) => a + s.totalSizeBytes, 0);
  const totalTokensSel = toDelete.reduce((a, s) => a + sessionTokens(s), 0);

  console.log(
    `\n${c.yellow}Will delete ${c.bold}${toDelete.length}${c.reset}${c.yellow} session(s)` +
    ` \u00b7 ${formatBytes(totalSize)} \u00b7 ${formatTokens(totalTokensSel)} tokens${c.reset}`
  );

  let confirmed: boolean;
  try {
    confirmed = await confirm({
      message: "Proceed with deletion?",
      default: false,
    });
  } catch {
    console.log(`\n${c.dim}Cancelled.${c.reset}`);
    return;
  }

  if (!confirmed) {
    console.log(`${c.dim}Aborted.${c.reset}`);
    return;
  }

  for (const session of toDelete) {
    const label = truncate(getSessionLabel(session), 50);
    process.stdout.write(`  ${c.red}Deleting${c.reset} ${label}...`);
    await deleteSession(session);
    console.log(` ${c.green}done${c.reset}`);
  }

  console.log(
    `\n${c.green}${c.bold}Cleaned ${toDelete.length} session(s), freed ${formatBytes(totalSize)}.${c.reset}`
  );
}

async function cmdInteractive() {
  const projectFilter = getConfigProject();
  const sortBy = getConfigSort();

  console.log(`${c.cyan}${c.bold}Claude Session Manager${c.reset}\n`);
  console.log(`${c.dim}Loading sessions...${c.reset}`);

  let sessions = await getAllSessions(makeProgressCallback());

  if (projectFilter) {
    const filter = projectFilter.toLowerCase();
    sessions = sessions.filter((s) =>
      s.entry.projectPath.toLowerCase().includes(filter)
    );
  }

  const sortFn = getSortFn(sortBy);
  sessions.sort(sortFn);

  if (sessions.length === 0) {
    console.log(`${c.yellow}No sessions found.${c.reset}`);
    return;
  }

  const totalSize = sessions.reduce((a, s) => a + s.totalSizeBytes, 0);
  console.log(
    `${c.dim}Found ${c.white}${sessions.length}${c.dim} sessions (${formatBytes(totalSize)})${c.reset}\n`
  );

  // Column layout based on verbosity (same specs as list command)
  const INQUIRER_PREFIX = 4; // arrow + space used by select/checkbox
  const { cols: browseCols, gap: browseGap } = browseColSpec(verbosityLevel);
  const browseTermWidth = (process.stdout.columns ?? FALLBACK_TERM_WIDTH) - INQUIRER_PREFIX;
  const browseWidths = computeColWidths(browseTermWidth, browseCols, browseGap);

  mainLoop: while (true) {
    printInteractiveHeader(browseCols, browseWidths, browseGap, INQUIRER_PREFIX);
    if (verbosityLevel >= 2) console.log(`    ${c.dim}${VERBOSE_COL_LEGEND}${c.reset}`);

    const sessionChoices = sessions.map((s) => {
      return {
        name: formatInteractiveRow(s, browseCols, browseWidths, browseGap, verbosityLevel),
        value: s.entry.sessionId,
        description: s.facets?.brief_summary
          ?? (s.entry.firstPrompt !== "No prompt"
            ? truncate(s.entry.firstPrompt.replace(/[\r\n\t]+/g, " "), 90)
            : undefined),
      };
    });

    let selectedId: string;
    try {
      selectedId = await select({
        message: "Select a session:",
        choices: [
          ...sessionChoices,
          new Separator(),
          { name: "Delete multiple sessions...", value: "__delete__" },
          { name: "Exit", value: "__exit__" },
        ],
        pageSize: termPageSize(),
        loop: false,
      });
    } catch {
      return;
    }

    if (selectedId === "__exit__") return;

    if (selectedId === "__delete__") {
      const deletedIds = await interactiveBulkDelete(sessions);
      if (deletedIds.size > 0) {
        sessions = sessions.filter((s) => !deletedIds.has(s.entry.sessionId));
      }
      if (sessions.length === 0) {
        console.log(`${c.yellow}No sessions remaining.${c.reset}`);
        return;
      }
      continue;
    }

    const session = sessions.find((s) => s.entry.sessionId === selectedId);
    if (!session) continue mainLoop;

    // Action loop for selected session
    while (true) {
      const label = truncate(getSessionLabel(session), 60);
      let action: string;
      try {
        action = await select({
          message: `${label}`,
          choices: [
            {
              name: "Resume with Claude",
              value: "resume",
              description: `claude --resume ${session.entry.sessionId}`,
            },
            { name: "Show details", value: "info" },
            { name: "Delete this session", value: "delete" },
            new Separator(),
            { name: "Back to list", value: "back" },
          ],
        });
      } catch {
        return;
      }

      if (action === "back") continue mainLoop;

      if (action === "resume") {
        console.log(
          `\n${c.cyan}Resuming session ${c.bold}${session.entry.sessionId}${c.reset}${c.cyan}...${c.reset}\n`
        );
        const result = spawnSync("claude", ["--resume", session.entry.sessionId], {
          stdio: "inherit",
        });
        process.exit(result.status ?? 0);
      }

      if (action === "info") {
        console.log();
        printVerboseList([session]);
        continue; // Stay in action menu
      }

      if (action === "delete") {
        let confirmed: boolean;
        try {
          confirmed = await confirm({
            message: `Delete session "${truncate(label, 40)}"? (${formatBytes(session.totalSizeBytes)})`,
            default: false,
          });
        } catch {
          return;
        }

        if (confirmed) {
          process.stdout.write(`  ${c.red}Deleting${c.reset} ${label}...`);
          await deleteSession(session);
          console.log(` ${c.green}done${c.reset}\n`);
          sessions = sessions.filter(
            (s) => s.entry.sessionId !== session.entry.sessionId
          );
          if (sessions.length === 0) {
            console.log(`${c.yellow}No sessions remaining.${c.reset}`);
            return;
          }
        }
        continue mainLoop;
      }
    }
  }
}

async function interactiveBulkDelete(
  sessions: EnrichedSession[]
): Promise<Set<string>> {
  const INQUIRER_PREFIX = 4;
  const { cols, gap } = browseColSpec(verbosityLevel);
  const termW = (process.stdout.columns ?? FALLBACK_TERM_WIDTH) - INQUIRER_PREFIX;
  const widths = computeColWidths(termW, cols, gap);

  const choices = sessions.map((s) => {
    return {
      name: formatInteractiveRow(s, cols, widths, gap, verbosityLevel),
      value: s.entry.sessionId,
      checked: false,
    };
  });

  console.log(
    `\n${c.dim}Use arrow keys to navigate, space to select, enter to confirm${c.reset}\n`
  );
  printInteractiveHeader(cols, widths, gap, INQUIRER_PREFIX);
  if (verbosityLevel >= 2) console.log(`    ${c.dim}${VERBOSE_COL_LEGEND}${c.reset}`);

  let selected: string[];
  try {
    selected = await checkbox({
      message: "Select sessions to delete:",
      choices,
      pageSize: termPageSize(),
      loop: false,
    });
  } catch {
    console.log(`\n${c.dim}Cancelled.${c.reset}`);
    return new Set();
  }

  if (selected.length === 0) {
    console.log(`${c.dim}No sessions selected.${c.reset}\n`);
    return new Set();
  }

  const toDelete = sessions.filter((s) =>
    selected.includes(s.entry.sessionId)
  );
  const totalSize = toDelete.reduce((a, s) => a + s.totalSizeBytes, 0);
  const totalTokensSel = toDelete.reduce((a, s) => a + sessionTokens(s), 0);

  console.log(
    `\n${c.yellow}Will delete ${c.bold}${toDelete.length}${c.reset}${c.yellow} session(s)` +
    ` \u00b7 ${formatBytes(totalSize)} \u00b7 ${formatTokens(totalTokensSel)} tokens${c.reset}`
  );

  let confirmed: boolean;
  try {
    confirmed = await confirm({
      message: "Proceed with deletion?",
      default: false,
    });
  } catch {
    console.log(`\n${c.dim}Cancelled.${c.reset}`);
    return new Set();
  }

  if (!confirmed) {
    console.log(`${c.dim}Aborted.${c.reset}\n`);
    return new Set();
  }

  const deletedIds = new Set<string>();
  for (const session of toDelete) {
    const label = truncate(getSessionLabel(session), 50);
    process.stdout.write(`  ${c.red}Deleting${c.reset} ${label}...`);
    await deleteSession(session);
    console.log(` ${c.green}done${c.reset}`);
    deletedIds.add(session.entry.sessionId);
  }

  console.log(
    `\n${c.green}${c.bold}Cleaned ${toDelete.length} session(s), freed ${formatBytes(totalSize)}.${c.reset}\n`
  );

  return deletedIds;
}

async function cmdExport() {
  const sessionId = args[1];
  const destArg = args[2];

  if (!sessionId || !destArg) {
    process.stderr.write(`${c.red}Usage: csm export <session-id> <destination-dir>${c.reset}\n`);
    process.exit(1);
  }
  if (sessionId.length < 8) {
    process.stderr.write(`${c.red}Session ID prefix too short (min 8 chars)${c.reset}\n`);
    process.exit(1);
  }

  const sessions = await getAllSessions(makeProgressCallback());
  const matches = sessions.filter((s) => s.entry.sessionId.startsWith(sessionId));

  if (matches.length === 0) {
    process.stderr.write(`${c.red}Session not found: ${sessionId}${c.reset}\n`);
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write(`${c.red}Ambiguous session ID "${sessionId}" (${matches.length} matches)${c.reset}\n`);
    process.exit(1);
  }

  const session = matches[0]!;
  const id = session.entry.sessionId;

  await mkdir(destArg, { recursive: true });

  const filesToCopy: Array<[string, string]> = [
    [session.entry.fullPath, join(destArg, `${id}.jsonl`)],
    [join(getClaudeDir(), "usage-data", "session-meta", `${id}.json`), join(destArg, `${id}.meta.json`)],
    [join(getClaudeDir(), "usage-data", "facets", `${id}.json`), join(destArg, `${id}.facets.json`)],
  ];

  for (const [src, dst] of filesToCopy) {
    try {
      await cp(src, dst);
      console.log(`  ${c.green}copied${c.reset} ${dst}`);
    } catch {
      // File may not exist (e.g. no meta/facets) — skip silently
    }
  }

  console.log(`\n${c.green}Exported session ${id.slice(0, 8)} to ${destArg}${c.reset}`);
}

async function cmdBackup() {
  const olderThanStr = getFlag("older-than");
  const longFlagValues = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    if ((args[i] ?? "").startsWith("--") && i + 1 < args.length) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) longFlagValues.add(next);
    }
  }
  const destArg = args.find(
    (a) => !a.startsWith("-") && a !== "backup" && !longFlagValues.has(a)
  );

  if (!destArg) {
    process.stderr.write(`${c.red}Usage: csm backup --older-than <days> <destination-dir>${c.reset}\n`);
    process.exit(1);
  }
  if (!olderThanStr) {
    process.stderr.write(`${c.red}--older-than <days> is required for backup${c.reset}\n`);
    process.exit(1);
  }

  const days = parseInt(olderThanStr, 10);
  if (isNaN(days) || days <= 0) {
    process.stderr.write(`[error] --older-than must be a positive integer\n`);
    process.exit(1);
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = await getAllSessions(makeProgressCallback());
  const toBackup = sessions.filter(
    (s) => new Date(s.entry.modified).getTime() < cutoff
  );

  if (toBackup.length === 0) {
    console.log(`${c.yellow}No sessions older than ${days} days.${c.reset}`);
    return;
  }

  await mkdir(destArg, { recursive: true });
  console.log(`${c.cyan}Backing up ${toBackup.length} sessions to ${destArg}...${c.reset}\n`);

  for (const session of toBackup) {
    const id = session.entry.sessionId;
    const label = truncate(getSessionLabel(session), 40);
    process.stdout.write(`  ${c.dim}${id.slice(0, 8)}${c.reset} ${label}...`);

    const filesToCopy: Array<[string, string]> = [
      [session.entry.fullPath, join(destArg, `${id}.jsonl`)],
      [join(getClaudeDir(), "usage-data", "session-meta", `${id}.json`), join(destArg, `${id}.meta.json`)],
      [join(getClaudeDir(), "usage-data", "facets", `${id}.json`), join(destArg, `${id}.facets.json`)],
    ];

    for (const [src, dst] of filesToCopy) {
      try { await cp(src, dst); } catch { /* file may not exist */ }
    }

    console.log(` ${c.green}done${c.reset}`);
  }

  console.log(`\n${c.green}${c.bold}Backed up ${toBackup.length} sessions to ${destArg}${c.reset}`);
}

async function cmdStats() {
  const byKey = getFlag("by") ?? "project";
  const validByKeys = ["project", "language", "outcome"];
  if (!validByKeys.includes(byKey)) {
    process.stderr.write(`[error] --by must be one of: ${validByKeys.join(", ")}\n`);
    process.exit(1);
  }

  console.log(`${c.cyan}${c.bold}Session Statistics${c.reset}\n`);
  const sessions = await getAllSessions(makeProgressCallback());

  if (sessions.length === 0) {
    console.log(`${c.yellow}No sessions found.${c.reset}`);
    return;
  }

  // Overall totals
  const totalSessions = sessions.length;
  const totalSize = sessions.reduce((a, s) => a + s.totalSizeBytes, 0);
  const totalTokens = sessions.reduce((a, s) => a + sessionTokens(s), 0);
  const totalDuration = sessions.reduce((a, s) => a + (sessionDuration(s) ?? 0), 0);
  const avgSize = totalSize / totalSessions;

  console.log(`${c.bold}Overall${c.reset}`);
  console.log(`  Sessions:   ${totalSessions}`);
  console.log(`  Total size: ${formatBytes(totalSize)}  (avg ${formatBytes(avgSize)})`);
  console.log(`  Tokens:     ${formatTokens(totalTokens)}`);
  console.log(`  Duration:   ${formatDuration(Math.round(totalDuration))}`);
  console.log();

  // Grouped breakdown
  interface Group {
    count: number;
    size: number;
    tokens: number;
    duration: number;
  }

  const groups = new Map<string, Group>();

  function addTo(key: string, s: EnrichedSession) {
    const g = groups.get(key) ?? { count: 0, size: 0, tokens: 0, duration: 0 };
    g.count++;
    g.size += s.totalSizeBytes;
    g.tokens += sessionTokens(s);
    g.duration += sessionDuration(s) ?? 0;
    groups.set(key, g);
  }

  for (const s of sessions) {
    if (byKey === "project") {
      addTo(projectName(s.entry.projectPath), s);
    } else if (byKey === "language") {
      const lang = primaryLanguage(s.meta?.languages) || "-";
      addTo(lang, s);
    } else if (byKey === "outcome") {
      const outcome = formatOutcome(s.facets?.outcome) || "-";
      addTo(outcome, s);
    }
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].size - a[1].size);
  console.log(`${c.bold}By ${byKey}${c.reset}`);

  const headers = ["Group", "Sessions", "Size", "Tokens", "Duration"];
  const rows = sorted.map(([key, g]) => [
    key,
    String(g.count),
    formatBytes(g.size),
    formatTokens(g.tokens),
    formatDuration(Math.round(g.duration)),
  ]);
  const colWidths = [24, 8, 10, 10, 10];
  printTable(headers, rows, colWidths, ["l", "r", "r", "r", "r"]);
}

function cmdColumns() {
  console.log(`${c.cyan}${c.bold}CSM Column Reference${c.reset}\n`);

  const sections: Array<{ title: string; cols: ColSpec[] }> = [
    { title: "Minimal view (default)", cols: MINIMAL_COLS },
    { title: "Standard table (-v)", cols: LIST_COLS },
    { title: "Wide table (-vv)", cols: VERBOSE_COLS },
  ];

  for (const { title, cols } of sections) {
    console.log(`${c.bold}${title}${c.reset}`);
    for (const col of cols) {
      const flex = col.weight ? ` (flex ${(col.weight * 100).toFixed(0)}%)` : " (fixed)";
      console.log(`  ${c.green}${col.header.padEnd(8)}${c.reset}  min=${col.weight ? `${col.min} ` : col.min}${flex}`);
    }
    console.log();
  }

  console.log(`${c.bold}Wide table (-vv) legend${c.reset}`);
  console.log(`  ${VERBOSE_COL_LEGEND}`);
}

export function getSortFn(
  sortBy: string
): (a: EnrichedSession, b: EnrichedSession) => number {
  switch (sortBy) {
    case "size":
      return (a, b) => b.totalSizeBytes - a.totalSizeBytes;
    case "tokens":
      return (a, b) => sessionTokens(b) - sessionTokens(a);
    case "duration":
      return (a, b) =>
        (b.meta?.duration_minutes ?? 0) - (a.meta?.duration_minutes ?? 0);
    case "messages":
      return (a, b) => b.entry.messageCount - a.entry.messageCount;
    case "files-changed":
      return (a, b) => (b.meta?.files_modified ?? 0) - (a.meta?.files_modified ?? 0);
    case "commits":
      return (a, b) => (b.meta?.git_commits ?? 0) - (a.meta?.git_commits ?? 0);
    default:
      return (a, b) =>
        new Date(b.entry.modified).getTime() -
        new Date(a.entry.modified).getTime();
  }
}

function showHelp() {
  console.log(`
${c.cyan}${c.bold}csm${c.reset} - Claude Session Manager

${c.bold}USAGE${c.reset}
  csm [command] [options]

${c.bold}COMMANDS${c.reset}
  ${c.green}list${c.reset}, ${c.green}l${c.reset}              List all sessions (default)
    -p, --project <name>     Filter by project name
    -s, --sort <key>         Sort by: date, size, tokens, duration, messages, files-changed, commits
    -n, --limit <N>          Show only the first N sessions
    -r, --reverse            Reverse the sort order
    -v                       Standard table (ID, project, session, date, stats)
    -vv                      Wide table with all available columns + legend
    -vvv                     Card-style output with full details
    --after <date>           Show sessions modified after date
    --before <date>          Show sessions modified before date
    --min-size <size>        Filter by minimum size (e.g. 50MB)
    --max-size <size>        Filter by maximum size
    --min-tokens <N>         Filter by minimum token count
    --outcome <value>        Filter by outcome (fully, partial, unclear)
    --json                   Output as JSON array
    --ids-only               Output one session ID per line
    --exit-2-on-empty        Exit with code 2 if no sessions matched

  ${c.green}find${c.reset}, ${c.green}f${c.reset} <query>       Search sessions by description
    --json / --ids-only      Machine-readable output
    -r, --reverse            Reverse result order

  ${c.green}info${c.reset}, ${c.green}i${c.reset} <session-id>  Show detailed session information
    Requires at least 8 chars of the session ID
    --json                   Output as JSON object

  ${c.green}clean${c.reset}, ${c.green}c${c.reset}             Interactively select and remove sessions
    --older-than <days>      Pre-select sessions older than N days
    --dry-run                Preview without deleting

  ${c.green}interactive${c.reset}, ${c.green}browse${c.reset}, ${c.green}b${c.reset}  Browse sessions, resume or delete
    -p, --project <name>     Filter by project name
    -s, --sort <key>         Sort order

  ${c.green}export${c.reset} <id> <dir>     Export a single session to a directory
  ${c.green}backup${c.reset} <dir>          Bulk export sessions older than N days
    --older-than <days>      (required)

  ${c.green}stats${c.reset}                 Aggregate statistics across sessions
    --by project|language|outcome  Group by dimension

  ${c.green}columns${c.reset}               Show column reference for all table views
  ${c.green}help${c.reset}                  Show this help message

${c.bold}GLOBAL FLAGS${c.reset}
  --debug                    Enable verbose stderr logging
  --color always|auto|never  Color output mode (default: auto)

${c.bold}EXIT CODES${c.reset}
  0  Success
  1  Error (invalid args, I/O failure, etc.)
  2  No sessions matched (with --exit-2-on-empty)

${c.bold}CONFIG FILE${c.reset}
  ~/.csm.config.json         Default sort, limit, project
  CSM_SORT, CSM_PROJECT, CSM_LIMIT  Environment variable overrides

${c.bold}EXAMPLES${c.reset}
  csm                                List all sessions (minimal view)
  csm l -v                           List with standard table
  csm l -vv                          List with all columns
  csm l -s size -n 20                Top 20 sessions by size
  csm l -s tokens --min-tokens 10000 Sessions with 10k+ tokens
  csm l --json | jq '.[].entry.sessionId'  JSON output
  csm l --ids-only | head -5         First 5 session IDs
  csm f "expo upgrade"               Search sessions
  csm i dfde9d19                     Show session details
  csm c --older-than 30              Clean sessions older than 30 days
  csm export dfde9d19 ./backups/     Export single session
  csm backup --older-than 60 ./arch/ Backup old sessions
  csm stats --by language            Stats grouped by language
  csm browse                         Interactive session browser

${c.bold}SETUP${c.reset}
  bun run setup                      Install 'csm' globally
`);
}

// ── Main ─────────────────────────────────────────────────────

try {
  switch (command) {
    case "list":
    case "l":
      await cmdList();
      break;
    case "find":
    case "search":
    case "f":
      await cmdFind();
      break;
    case "info":
    case "show":
    case "i":
      await cmdInfo();
      break;
    case "clean":
    case "remove":
    case "delete":
    case "c":
      await cmdClean();
      break;
    case "interactive":
    case "browse":
    case "b":
      await cmdInteractive();
      break;
    case "export":
    case "e":
      await cmdExport();
      break;
    case "backup":
      await cmdBackup();
      break;
    case "stats":
      await cmdStats();
      break;
    case "columns":
      cmdColumns();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      process.stderr.write(`${c.red}Unknown command: ${command}${c.reset}\n`);
      showHelp();
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`${c.red}Error: ${String(err)}${c.reset}\n`);
  process.exit(1);
}
