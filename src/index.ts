#!/usr/bin/env bun

import { checkbox, confirm } from "@inquirer/prompts";
import {
  getAllSessions,
  getSessionLabel,
  searchSessions,
  deleteSession,
  type EnrichedSession,
} from "./sessions.ts";
import {
  c,
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
  type ColSpec,
} from "./ui.ts";

// ── Arg parsing ──────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "list";

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

const verbose = hasFlag("verbose", "v");
const verboseTable = args.includes("--verbose-table") || args.includes("-vt");

// ── Session helpers ───────────────────────────────────────────

function sessionTokens(s: EnrichedSession): number {
  return (s.meta?.input_tokens ?? 0) + (s.meta?.output_tokens ?? 0)
    || (s.computedInputTokens ?? 0) + (s.computedOutputTokens ?? 0);
}

function sessionDuration(s: EnrichedSession): number | undefined {
  return s.meta?.duration_minutes ?? s.computedDurationMinutes;
}

// ── Column definitions ────────────────────────────────────────
// Single source of truth for header label, alignment, and sizing.
// See docs/columns.md for full documentation of each column.

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

// ── Commands ─────────────────────────────────────────────────

async function cmdList() {
  const projectFilter = getFlag("project", "p");
  const sortBy = getFlag("sort", "s") ?? "date";
  const limitStr = getFlag("limit", "n");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  console.log(`${c.cyan}${c.bold}Claude Session Manager${c.reset}\n`);
  console.log(`${c.dim}Loading sessions...${c.reset}`);

  let sessions = await getAllSessions();

  if (projectFilter) {
    const filter = projectFilter.toLowerCase();
    sessions = sessions.filter((s) =>
      s.entry.projectPath.toLowerCase().includes(filter)
    );
  }

  if (sortBy === "size") {
    sessions.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes);
  } else if (sortBy === "tokens") {
    sessions.sort((a, b) => sessionTokens(b) - sessionTokens(a));
  } else if (sortBy === "duration") {
    sessions.sort(
      (a, b) => (b.meta?.duration_minutes ?? 0) - (a.meta?.duration_minutes ?? 0)
    );
  } else {
    sessions.sort(
      (a, b) =>
        new Date(b.entry.modified).getTime() -
        new Date(a.entry.modified).getTime()
    );
  }

  if (sessions.length === 0) {
    console.log(`${c.yellow}No sessions found.${c.reset}`);
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

  if (verbose) {
    printVerboseList(displayed);
  } else if (verboseTable) {
    printVerboseTable(displayed);
  } else {
    printListTable(displayed);
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

function printListTable(sessions: EnrichedSession[]) {
  const termWidth = process.stdout.columns ?? 160;
  const widths = computeColWidths(termWidth, LIST_COLS, 2);

  const rows = sessions.map((s) => {
    const { project, worktree } = parseProjectPath(s.entry.projectPath);
    const dur = sessionDuration(s);
    const tok = sessionTokens(s);
    return [
      s.entry.sessionId,
      truncate(s.entry.customTitle || "-", widths[1]!),
      truncate(project, widths[2]!),
      truncate(worktree ?? "-", widths[3]!),
      truncate(getSessionLabel(s), widths[4]!),
      truncate(s.entry.gitBranch ?? "-", widths[5]!),
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
      truncate(s.entry.customTitle || "-", widths[1]!),
      truncate(project, widths[2]!),
      truncate(worktree ?? "-", widths[3]!),
      truncate(getSessionLabel(s), widths[4]!),
      truncate(s.entry.gitBranch ?? "-", widths[5]!),
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
}

function printVerboseList(sessions: EnrichedSession[]) {
  for (const s of sessions) {
    const { entry, meta, facets, totalSizeBytes } = s;
    const sep = c.dim + "\u2500".repeat(80) + c.reset;
    console.log(sep);

    console.log(`  ${c.cyan}${c.bold}${entry.sessionId}${c.reset}`);

    const name = entry.customTitle || "-";
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

  if (!query) {
    console.log(`${c.red}Usage: csm find <search query>${c.reset}`);
    console.log(`${c.dim}Example: csm find "expo upgrade"${c.reset}`);
    process.exit(1);
  }

  console.log(
    `${c.cyan}${c.bold}Searching for:${c.reset} ${c.white}${query}${c.reset}\n`
  );

  const allSessions = await getAllSessions();
  const results = searchSessions(allSessions, query);

  if (results.length === 0) {
    console.log(`${c.yellow}No sessions matching "${query}".${c.reset}`);
    return;
  }

  console.log(
    `${c.dim}Found ${c.white}${results.length}${c.dim} matching session(s)${c.reset}\n`
  );

  if (verbose) {
    printVerboseList(results.slice(0, 15));
  } else {
    for (const s of results.slice(0, 15)) {
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
  if (!sessionId) {
    console.log(`${c.red}Usage: csm info <session-id>${c.reset}`);
    process.exit(1);
  }

  const sessions = await getAllSessions();
  const session = sessions.find((s) =>
    s.entry.sessionId.startsWith(sessionId)
  );

  if (!session) {
    console.log(`${c.red}Session not found: ${sessionId}${c.reset}`);
    process.exit(1);
  }

  const { entry, meta, facets, totalSizeBytes } = session;

  console.log(`\n${c.cyan}${c.bold}Session Details${c.reset}\n`);

  const label = getSessionLabel(session);
  const rows: [string, string][] = [
    ["ID", entry.sessionId],
    ["Name", entry.customTitle || "-"],
    ["Label", label],
    ["Summary", entry.summary || "-"],
    ["First Prompt", truncate(entry.firstPrompt, 70)],
    ["Project", entry.projectPath],
    ["Git Branch", entry.gitBranch || "-"],
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

  for (const [label, value] of rows) {
    console.log(`  ${c.bold}${label.padEnd(16)}${c.reset} ${value}`);
  }
  console.log();
}

async function cmdClean() {
  const olderThanDays = getFlag("older-than");
  const dryRun = hasFlag("dry-run");

  console.log(`${c.cyan}${c.bold}Claude Session Cleaner${c.reset}\n`);

  const sessions = await getAllSessions();

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
  if (olderThanDays) {
    const cutoff = Date.now() - parseInt(olderThanDays) * 24 * 60 * 60 * 1000;
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
      pageSize: 20,
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

  console.log(
    `\n${c.yellow}Will delete ${c.bold}${toDelete.length}${c.reset}${c.yellow} session(s), freeing ${c.bold}${formatBytes(totalSize)}${c.reset}`
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

function showHelp() {
  console.log(`
${c.cyan}${c.bold}csm${c.reset} - Claude Session Manager

${c.bold}USAGE${c.reset}
  csm [command] [options]

${c.bold}GLOBAL OPTIONS${c.reset}
  -v, --verbose         Show detailed output with all available data

${c.bold}COMMANDS${c.reset}
  ${c.green}list${c.reset}, ${c.green}l${c.reset}              List all sessions (default)
    -p, --project <name>  Filter by project name
    -s, --sort <key>      Sort by: date, size, tokens, duration
    -n, --limit <N>       Show only the first N sessions
    -v, --verbose         Card-style output with full details
    -vt, --verbose-table  Wide table with all available columns

  ${c.green}find${c.reset}, ${c.green}f${c.reset} <query>       Search sessions by description
    Searches summaries, prompts, goals, and branch names
    -v, --verbose         Card-style output with full details

  ${c.green}info${c.reset}, ${c.green}i${c.reset} <session-id>  Show detailed session information
    Accepts partial session IDs (8 chars is enough)

  ${c.green}clean${c.reset}, ${c.green}c${c.reset}             Interactively select and remove sessions
    --older-than <days>  Pre-select sessions older than N days
    --dry-run            Preview without deleting

  ${c.green}help${c.reset}              Show this help message

${c.bold}EXAMPLES${c.reset}
  csm                           List all sessions (full IDs & names)
  csm l -v                      List with verbose card output
  csm l -vt                     List with all columns (wide table)
  csm l -s size -n 20           Top 20 sessions by size
  csm l -s tokens               Sort by token usage
  csm f "expo upgrade"          Find sessions about expo upgrades
  csm f "expo upgrade" -v       Find with verbose detail cards
  csm i dfde9d19                Show session details (partial ID)
  csm c --older-than 30         Clean sessions older than 30 days

${c.bold}SETUP${c.reset}
  bun run setup                 Install 'csm' globally
`);
}

// ── Main ─────────────────────────────────────────────────────

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
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    console.log(`${c.red}Unknown command: ${command}${c.reset}`);
    showHelp();
    process.exit(1);
}
