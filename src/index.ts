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
  truncate,
  formatDate,
  formatDuration,
  relativeDate,
  printTable,
  projectName,
  padLeft,
} from "./ui.ts";

// ── Arg parsing ──────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "list";

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

// ── Commands ─────────────────────────────────────────────────

async function cmdList() {
  const projectFilter = getFlag("project");
  const sortBy = getFlag("sort") ?? "date";

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

  const totalSize = sessions.reduce((a, s) => a + s.totalSizeBytes, 0);
  console.log(
    `${c.dim}Found ${c.white}${sessions.length}${c.dim} sessions (${formatBytes(totalSize)} total)${c.reset}\n`
  );

  const headers = ["Project", "Session", "Date", "Msgs", "Size"];
  const colWidths = [22, 42, 12, 6, 10];

  const rows = sessions.map((s) => [
    truncate(projectName(s.entry.projectPath), colWidths[0]!),
    truncate(getSessionLabel(s), colWidths[1]!),
    relativeDate(s.entry.modified),
    String(s.entry.messageCount),
    formatBytes(s.totalSizeBytes),
  ]);

  printTable(headers, rows, colWidths);
}

async function cmdFind() {
  const query = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");

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

  for (const s of results.slice(0, 15)) {
    const label = getSessionLabel(s);
    const proj = projectName(s.entry.projectPath);
    console.log(
      `  ${c.green}${label}${c.reset}`
    );
    console.log(
      `  ${c.dim}${proj} | ${relativeDate(s.entry.modified)} | ${s.entry.messageCount} msgs | ${formatBytes(s.totalSizeBytes)}${c.reset}`
    );
    if (s.facets?.brief_summary) {
      console.log(`  ${c.dim}${truncate(s.facets.brief_summary, 80)}${c.reset}`);
    }
    console.log(
      `  ${c.dim}ID: ${s.entry.sessionId}${c.reset}\n`
    );
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
    ["Label", label],
    ["Title", entry.customTitle || "-"],
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

    if (Object.keys(meta.tool_counts).length > 0) {
      const tools = Object.entries(meta.tool_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      rows.push(["Tools Used", truncate(tools, 60)]);
    }
  }

  if (facets) {
    if (facets.brief_summary)
      rows.push(["Brief Summary", truncate(facets.brief_summary, 70)]);
    if (facets.session_type)
      rows.push(["Session Type", facets.session_type]);
    if (facets.outcome) rows.push(["Outcome", facets.outcome]);
    if (facets.claude_helpfulness)
      rows.push(["Helpfulness", facets.claude_helpfulness]);
  }

  for (const [label, value] of rows) {
    console.log(
      `  ${c.bold}${label.padEnd(16)}${c.reset} ${value}`
    );
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

  // Determine which are pre-selected (older-than filter)
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
    const date = relativeDate(s.entry.modified);
    const size = formatBytes(s.totalSizeBytes);

    return {
      name: `${proj.padEnd(20)} ${label.padEnd(42)} ${date.padEnd(10)} ${size}`,
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

${c.bold}COMMANDS${c.reset}
  ${c.green}list${c.reset}              List all sessions (default)
    --project <name>  Filter by project name
    --sort size|date  Sort order (default: date)

  ${c.green}find${c.reset} <query>       Search sessions by description
    Searches summaries, prompts, goals, and branch names

  ${c.green}info${c.reset} <session-id>  Show detailed session information
    Accepts partial session IDs

  ${c.green}clean${c.reset}             Interactively select and remove sessions
    --older-than <days>  Pre-select sessions older than N days
    --dry-run            Preview without deleting

  ${c.green}help${c.reset}              Show this help message

${c.bold}EXAMPLES${c.reset}
  csm                           List all sessions
  csm list --sort size          List sessions by size
  csm find "expo upgrade"       Find sessions about expo upgrades
  csm info dfde9d19             Show session details
  csm clean --older-than 30     Clean sessions older than 30 days
`);
}

// ── Main ─────────────────────────────────────────────────────

switch (command) {
  case "list":
    await cmdList();
    break;
  case "find":
  case "search":
    await cmdFind();
    break;
  case "info":
  case "show":
    await cmdInfo();
    break;
  case "clean":
  case "remove":
  case "delete":
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
