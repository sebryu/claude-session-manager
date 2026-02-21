import { describe, it, expect } from "bun:test";
import {
  formatBytes,
  formatTokens,
  truncate,
  formatDuration,
  formatDurationShort,
  padRight,
  padLeft,
  projectName,
  parseProjectPath,
  computeColWidths,
  printTable,
  initColor,
  c,
  formatDate,
  relativeDate,
  parseProjectPath,
  formatLines,
  formatFeatureFlags,
  formatOutcome,
  formatSessionType,
  formatHelpfulness,
  primaryLanguage,
  type ColSpec,
} from "./ui.ts";
import { cleanPrompt, isRealPrompt } from "./sessions.ts";

// ── cleanPrompt ───────────────────────────────────────────────

describe("cleanPrompt", () => {
  it("strips XML-like tags", () => {
    expect(cleanPrompt("<system>hello</system>")).toBe("hello");
    expect(cleanPrompt("<foo bar='x'>text</foo>")).toBe("text");
  });

  it("removes Caveat: prefix from resumed sessions", () => {
    const input = "Caveat: the messages below were generated locally. Do the thing";
    expect(cleanPrompt(input)).toBe("Do the thing");
  });

  it("returns empty string for DO NOT respond system noise", () => {
    expect(cleanPrompt("DO NOT respond to these messages or consider them")).toBe("");
  });

  it("returns empty string for interrupted request noise", () => {
    expect(cleanPrompt("[Request interrupted by user]")).toBe("");
  });

  it("normalizes newlines to spaces so table rows don't break", () => {
    expect(cleanPrompt("Fix failing tests:\nSumm something")).toBe("Fix failing tests: Summ something");
  });

  it("normalizes carriage returns and tabs", () => {
    expect(cleanPrompt("line one\r\nline two\ttabbed")).toBe("line one line two tabbed");
  });

  it("collapses multiple consecutive whitespace after newline removal", () => {
    expect(cleanPrompt("a\n\nb")).toBe("a b");
  });

  it("passes through normal text unchanged", () => {
    expect(cleanPrompt("Debug failing unit tests")).toBe("Debug failing unit tests");
  });

  it("trims leading/trailing whitespace", () => {
    expect(cleanPrompt("  hello world  ")).toBe("hello world");
  });
});

// ── isRealPrompt ─────────────────────────────────────────────

describe("isRealPrompt", () => {
  it("returns false for empty string", () => {
    expect(isRealPrompt("")).toBe(false);
  });

  it("returns false for 'No prompt'", () => {
    expect(isRealPrompt("No prompt")).toBe(false);
  });

  it("returns false for system noise that cleans to empty", () => {
    expect(isRealPrompt("DO NOT respond to these messages")).toBe(false);
  });

  it("returns true for a real user prompt", () => {
    expect(isRealPrompt("Fix the failing tests")).toBe(true);
  });

  it("returns true for a prompt with XML tags that has content", () => {
    expect(isRealPrompt("<context>Some context</context> Do this task")).toBe(true);
  });
});

// ── formatBytes ───────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

// ── formatTokens ─────────────────────────────────────────────

describe("formatTokens", () => {
  it("returns dash for 0", () => {
    expect(formatTokens(0)).toBe("-");
  });

  it("formats small counts as-is", () => {
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

// ── truncate ─────────────────────────────────────────────────

describe("truncate", () => {
  it("returns string unchanged if within max", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends ellipsis character", () => {
    expect(truncate("hello world", 8)).toBe("hello w\u2026");
    expect(truncate("hello world", 5)).toBe("hell\u2026");
  });
});

// ── formatDuration ───────────────────────────────────────────

describe("formatDuration", () => {
  it("formats minutes only", () => {
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(59)).toBe("59m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
  });

  it("formats exact hours without minutes", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
  });
});

// ── formatDurationShort ──────────────────────────────────────

describe("formatDurationShort", () => {
  it("shows minutes for < 1 hour", () => {
    expect(formatDurationShort(45)).toBe("45m");
  });

  it("shows hours for >= 1 hour", () => {
    expect(formatDurationShort(90)).toBe("1h");
    expect(formatDurationShort(150)).toBe("2h");
  });

  it("shows days for >= 24 hours", () => {
    expect(formatDurationShort(1440)).toBe("1d");
    expect(formatDurationShort(2880)).toBe("2d");
  });
});

// ── padRight / padLeft ───────────────────────────────────────

describe("padRight", () => {
  it("pads short string with spaces on right", () => {
    expect(padRight("abc", 6)).toBe("abc   ");
  });

  it("returns string unchanged if already at width", () => {
    expect(padRight("abc", 3)).toBe("abc");
  });

  it("returns string unchanged if longer than width", () => {
    expect(padRight("abcdef", 3)).toBe("abcdef");
  });
});

describe("padLeft", () => {
  it("pads short string with spaces on left", () => {
    expect(padLeft("42", 5)).toBe("   42");
  });

  it("returns string unchanged if already at width", () => {
    expect(padLeft("abc", 3)).toBe("abc");
  });
});

// ── computeColWidths ─────────────────────────────────────────

describe("computeColWidths", () => {
  // 10-column layout: 6 fixed + 4 flex, 9 separators at gap=2
  const COLS: ColSpec[] = [
    { header: "ID",      align: "l", min: 36 },
    { header: "Name",    align: "l", min: 10, weight: 0.10 },
    { header: "Project", align: "l", min: 12, weight: 0.20 },
    { header: "Session", align: "l", min: 18, weight: 0.50 },
    { header: "Branch",  align: "l", min: 8,  weight: 0.20 },
    { header: "Date",    align: "l", min: 11 },
    { header: "Dur",     align: "r", min: 5  },
    { header: "Msgs",    align: "r", min: 5  },
    { header: "Tokens",  align: "r", min: 7  },
    { header: "Size",    align: "r", min: 7  },
  ];
  const GAP = 2;

  it("returns a width for every column", () => {
    expect(computeColWidths(200, COLS, GAP).length).toBe(COLS.length);
  });

  it("session column gets the largest flex share", () => {
    const widths = computeColWidths(220, COLS, GAP);
    const [, name, project, session, branch] = widths;
    expect(session).toBeGreaterThan(name!);
    expect(session).toBeGreaterThan(project!);
    expect(session).toBeGreaterThan(branch!);
  });

  it("total columns fill the terminal width on wide displays", () => {
    for (const termWidth of [160, 180, 200, 220, 260]) {
      const widths = computeColWidths(termWidth, COLS, GAP);
      const total = widths.reduce((a, b) => a + b, 0) + (COLS.length - 1) * GAP;
      // Allow ±3 chars from rounding across 4 flex columns
      expect(Math.abs(total - termWidth)).toBeLessThanOrEqual(3);
    }
  });

  it("expands flex columns as terminal gets wider", () => {
    const w160 = computeColWidths(160, COLS, GAP);
    const w220 = computeColWidths(220, COLS, GAP);
    const w300 = computeColWidths(300, COLS, GAP);
    // session is at index 3
    expect(w220[3]).toBeGreaterThan(w160[3]!);
    expect(w300[3]).toBeGreaterThan(w220[3]!);
  });

  it("never goes below minimum widths on narrow terminals", () => {
    const widths = computeColWidths(100, COLS, GAP);
    const [, name, project, session, branch] = widths;
    expect(name).toBeGreaterThanOrEqual(10);
    expect(project).toBeGreaterThanOrEqual(12);
    expect(session).toBeGreaterThanOrEqual(18);
    expect(branch).toBeGreaterThanOrEqual(8);
  });
});

// ── projectName ───────────────────────────────────────────────

// ── parseProjectPath ─────────────────────────────────────────

describe("parseProjectPath", () => {
  it("returns project name with no worktree for a normal path", () => {
    const result = parseProjectPath("/Users/foo/my-project");
    expect(result.project).toBe("my-project");
    expect(result.worktree).toBeUndefined();
  });

  it("extracts project and worktree from a worktree path", () => {
    const result = parseProjectPath("/Users/foo/my-project/.claude/worktrees/feature-branch");
    expect(result.project).toBe("my-project");
    expect(result.worktree).toBe("feature-branch");
  });

  it("applies projectName short-segment fallback to the base project", () => {
    const result = parseProjectPath("/Users/foo/ui/.claude/worktrees/fix-bug");
    expect(result.project).toBe("foo/ui");
    expect(result.worktree).toBe("fix-bug");
  });

  it("handles worktree names with hyphens and numbers", () => {
    const result = parseProjectPath("/work/my-app/.claude/worktrees/feat-123-new-ui");
    expect(result.project).toBe("my-app");
    expect(result.worktree).toBe("feat-123-new-ui");
  });
});

// ── projectName ───────────────────────────────────────────────

describe("projectName", () => {
  it("returns the last path segment", () => {
    expect(projectName("/Users/foo/my-project")).toBe("my-project");
  });

  it("uses last 2 segments when last segment is too short", () => {
    expect(projectName("/Users/foo/rn")).toBe("foo/rn");
    expect(projectName("/Users/foo/ui")).toBe("foo/ui");
  });

  it("handles trailing slash gracefully", () => {
    // "bar" has length 3 (<4), so it falls back to last 2 segments
    expect(projectName("/Users/foo/bar/")).toBe("foo/bar");
  });
});

// ── initColor & c ────────────────────────────────────────────

describe("initColor", () => {
  it("returns ANSI codes when mode is 'always'", () => {
    initColor("always");
    expect(c.red).toBe("\x1b[31m");
    expect(c.bold).toBe("\x1b[1m");
    expect(c.reset).toBe("\x1b[0m");
    expect(c.dim).toBe("\x1b[2m");
    expect(c.green).toBe("\x1b[32m");
    expect(c.yellow).toBe("\x1b[33m");
    expect(c.blue).toBe("\x1b[34m");
    expect(c.magenta).toBe("\x1b[35m");
    expect(c.cyan).toBe("\x1b[36m");
    expect(c.white).toBe("\x1b[37m");
    expect(c.gray).toBe("\x1b[90m");
  });

  it("returns empty strings when mode is 'never'", () => {
    initColor("never");
    expect(c.red).toBe("");
    expect(c.bold).toBe("");
    expect(c.reset).toBe("");
    expect(c.dim).toBe("");
    expect(c.green).toBe("");
    expect(c.yellow).toBe("");
    expect(c.blue).toBe("");
    expect(c.magenta).toBe("");
    expect(c.cyan).toBe("");
    expect(c.white).toBe("");
    expect(c.gray).toBe("");
  });

  it("auto mode respects environment (non-TTY in test → no color)", () => {
    initColor("auto");
    // In a test runner, stdout is typically not a TTY, so color should be off
    // OR NO_COLOR might be set. Either way, we just verify it doesn't throw.
    // The result depends on the environment, so we check it's a string.
    expect(typeof c.red).toBe("string");
    // Restore to never for remaining tests
    initColor("never");
  });

  it("can switch modes back and forth", () => {
    initColor("always");
    expect(c.red).toBe("\x1b[31m");
    initColor("never");
    expect(c.red).toBe("");
    initColor("always");
    expect(c.red).toBe("\x1b[31m");
    // Leave color off for other tests
    initColor("never");
  });
});

// ── formatDate ───────────────────────────────────────────────

describe("formatDate", () => {
  it("formats a known ISO date correctly", () => {
    // Jan 15, 2024 in en-US
    const result = formatDate("2024-01-15T12:00:00Z");
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2024");
  });

  it("formats another known date correctly", () => {
    const result = formatDate("2023-12-25T00:00:00Z");
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2023");
  });

  it("handles a date at start of year", () => {
    const result = formatDate("2025-01-01T00:00:00Z");
    expect(result).toContain("Jan");
    expect(result).toContain("1");
    expect(result).toContain("2025");
  });
});

// ── relativeDate ─────────────────────────────────────────────

describe("relativeDate", () => {
  function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(14, 30, 0, 0);
    return d.toISOString();
  }

  it("returns 'today HH:MM' for same-day dates", () => {
    const now = new Date();
    now.setHours(10, 15, 0, 0);
    const result = relativeDate(now.toISOString());
    expect(result).toMatch(/^today \d{2}:\d{2}$/);
  });

  it("returns 'yest HH:MM' for yesterday", () => {
    const result = relativeDate(daysAgo(1));
    expect(result).toMatch(/^yest \d{2}:\d{2}$/);
  });

  it("returns 'Weekday HH:MM' for 2-4 days ago", () => {
    const result2 = relativeDate(daysAgo(2));
    // Should be a short weekday name like "Mon", "Tue", etc.
    expect(result2).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);

    const result3 = relativeDate(daysAgo(3));
    expect(result3).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);

    const result4 = relativeDate(daysAgo(4));
    expect(result4).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  });

  it("returns 'Xd ago' for 5-6 days ago", () => {
    const result5 = relativeDate(daysAgo(5));
    expect(result5).toMatch(/^\dd ago$/);

    const result6 = relativeDate(daysAgo(6));
    expect(result6).toMatch(/^\dd ago$/);
  });

  it("returns 'Xw ago' for 7-29 days ago", () => {
    const result7 = relativeDate(daysAgo(7));
    expect(result7).toBe("1w ago");

    const result14 = relativeDate(daysAgo(14));
    expect(result14).toBe("2w ago");

    const result21 = relativeDate(daysAgo(21));
    expect(result21).toBe("3w ago");
  });

  it("returns 'Xmo ago' for 30-364 days ago", () => {
    const result30 = relativeDate(daysAgo(30));
    expect(result30).toBe("1mo ago");

    const result90 = relativeDate(daysAgo(90));
    expect(result90).toBe("3mo ago");

    const result180 = relativeDate(daysAgo(180));
    expect(result180).toBe("6mo ago");
  });

  it("returns 'Xy ago' for 365+ days ago", () => {
    const result365 = relativeDate(daysAgo(365));
    expect(result365).toBe("1y ago");

    const result730 = relativeDate(daysAgo(730));
    expect(result730).toBe("2y ago");
  });
});

// ── parseProjectPath ─────────────────────────────────────────

describe("parseProjectPath", () => {
  it("returns project name without worktree for normal paths", () => {
    const result = parseProjectPath("/Users/me/my-project");
    expect(result).toEqual({ project: "my-project" });
  });

  it("returns project and worktree when worktree marker is present", () => {
    const result = parseProjectPath("/Users/me/my-project/.claude/worktrees/feature-branch");
    expect(result).toEqual({
      project: "my-project",
      worktree: "feature-branch",
    });
  });

  it("applies projectName() to base path for short last segments", () => {
    const result = parseProjectPath("/Users/me/rn/.claude/worktrees/fix-bug");
    expect(result).toEqual({
      project: "me/rn",
      worktree: "fix-bug",
    });
  });

  it("handles path without worktree that has short last segment", () => {
    const result = parseProjectPath("/Users/me/ui");
    expect(result).toEqual({ project: "me/ui" });
  });

  it("returns undefined worktree for non-worktree path (not present in result)", () => {
    const result = parseProjectPath("/Users/me/my-project");
    expect(result.worktree).toBeUndefined();
  });
});

// ── formatLines ──────────────────────────────────────────────

describe("formatLines", () => {
  it("returns dash when both are 0", () => {
    expect(formatLines(0, 0)).toBe("-");
  });

  it("formats small numbers", () => {
    expect(formatLines(10, 5)).toBe("+10/-5");
  });

  it("handles only additions", () => {
    expect(formatLines(100, 0)).toBe("+100/-0");
  });

  it("handles only removals", () => {
    expect(formatLines(0, 50)).toBe("+0/-50");
  });

  it("formats thousands with k suffix", () => {
    expect(formatLines(1000, 2000)).toBe("+1k/-2k");
  });

  it("rounds thousands", () => {
    expect(formatLines(1500, 2500)).toBe("+2k/-3k");
  });

  it("mixes small and large numbers", () => {
    expect(formatLines(500, 3000)).toBe("+500/-3k");
    expect(formatLines(5000, 42)).toBe("+5k/-42");
  });
});

// ── formatFeatureFlags ───────────────────────────────────────

describe("formatFeatureFlags", () => {
  it("returns '---' when no meta is provided", () => {
    expect(formatFeatureFlags()).toBe("---");
    expect(formatFeatureFlags(undefined)).toBe("---");
  });

  it("returns '---' when all flags are false or absent", () => {
    expect(formatFeatureFlags({})).toBe("---");
    expect(formatFeatureFlags({ uses_task_agent: false, uses_mcp: false, uses_web_search: false })).toBe("---");
  });

  it("shows T when task agent is used", () => {
    expect(formatFeatureFlags({ uses_task_agent: true })).toBe("T--");
  });

  it("shows M when MCP is used", () => {
    expect(formatFeatureFlags({ uses_mcp: true })).toBe("-M-");
  });

  it("shows W when web_search is used", () => {
    expect(formatFeatureFlags({ uses_web_search: true })).toBe("--W");
  });

  it("shows W when web_fetch is used", () => {
    expect(formatFeatureFlags({ uses_web_fetch: true })).toBe("--W");
  });

  it("shows W when both web_search and web_fetch are used", () => {
    expect(formatFeatureFlags({ uses_web_search: true, uses_web_fetch: true })).toBe("--W");
  });

  it("shows all flags together", () => {
    expect(formatFeatureFlags({
      uses_task_agent: true,
      uses_mcp: true,
      uses_web_search: true,
    })).toBe("TMW");
  });

  it("shows partial combinations", () => {
    expect(formatFeatureFlags({ uses_task_agent: true, uses_web_fetch: true })).toBe("T-W");
    expect(formatFeatureFlags({ uses_mcp: true, uses_web_search: true })).toBe("-MW");
  });
});

// ── formatOutcome ────────────────────────────────────────────

describe("formatOutcome", () => {
  it("returns dash when no outcome", () => {
    expect(formatOutcome()).toBe("-");
    expect(formatOutcome(undefined)).toBe("-");
  });

  it("returns 'full' for fully_completed", () => {
    expect(formatOutcome("fully_completed")).toBe("full");
  });

  it("returns 'full' for case variations with 'fully'", () => {
    expect(formatOutcome("Fully_completed")).toBe("full");
  });

  it("returns 'part' for partial", () => {
    expect(formatOutcome("partial")).toBe("part");
  });

  it("returns 'no' for not_completed", () => {
    expect(formatOutcome("not_completed")).toBe("no");
  });

  it("returns 'no' for failed", () => {
    expect(formatOutcome("failed")).toBe("no");
  });

  it("returns first 4 chars for unknown outcomes", () => {
    expect(formatOutcome("something_else")).toBe("some");
    expect(formatOutcome("abcdefgh")).toBe("abcd");
  });
});

// ── formatSessionType ────────────────────────────────────────

describe("formatSessionType", () => {
  it("returns dash when no type", () => {
    expect(formatSessionType()).toBe("-");
    expect(formatSessionType(undefined)).toBe("-");
  });

  it("maps coding to code", () => {
    expect(formatSessionType("coding")).toBe("code");
  });

  it("maps debugging to debug", () => {
    expect(formatSessionType("debugging")).toBe("debug");
  });

  it("maps analysis to anlys", () => {
    expect(formatSessionType("analysis")).toBe("anlys");
  });

  it("maps planning to plan", () => {
    expect(formatSessionType("planning")).toBe("plan");
  });

  it("maps review to rev", () => {
    expect(formatSessionType("review")).toBe("rev");
  });

  it("maps documentation to docs", () => {
    expect(formatSessionType("documentation")).toBe("docs");
  });

  it("maps research to rsrch", () => {
    expect(formatSessionType("research")).toBe("rsrch");
  });

  it("maps iterative_refinement to iter", () => {
    expect(formatSessionType("iterative_refinement")).toBe("iter");
  });

  it("maps configuration to cfg", () => {
    expect(formatSessionType("configuration")).toBe("cfg");
  });

  it("maps troubleshooting to trbl", () => {
    expect(formatSessionType("troubleshooting")).toBe("trbl");
  });

  it("handles case-insensitive input", () => {
    expect(formatSessionType("Coding")).toBe("code");
    expect(formatSessionType("DEBUGGING")).toBe("debug");
  });

  it("returns first 5 chars for unknown types", () => {
    expect(formatSessionType("something_custom")).toBe("somet");
    expect(formatSessionType("xyz")).toBe("xyz");
  });
});

// ── formatHelpfulness ────────────────────────────────────────

describe("formatHelpfulness", () => {
  it("returns dash when no helpfulness", () => {
    expect(formatHelpfulness()).toBe("-");
    expect(formatHelpfulness(undefined)).toBe("-");
  });

  it("returns 'v.hi' for very_helpful", () => {
    expect(formatHelpfulness("very_helpful")).toBe("v.hi");
  });

  it("returns 'v.hi' for any string starting with 'very'", () => {
    expect(formatHelpfulness("Very_helpful")).toBe("v.hi");
    expect(formatHelpfulness("very helpful")).toBe("v.hi");
  });

  it("returns 'hi' for helpful", () => {
    expect(formatHelpfulness("helpful")).toBe("hi");
  });

  it("returns 'mid' for somewhat_helpful", () => {
    expect(formatHelpfulness("somewhat_helpful")).toBe("mid");
  });

  it("returns 'low' for not_helpful", () => {
    expect(formatHelpfulness("not_helpful")).toBe("low");
  });

  it("returns first 4 chars for unknown values", () => {
    expect(formatHelpfulness("amazing")).toBe("amaz");
    expect(formatHelpfulness("ok")).toBe("ok");
  });
});

// ── primaryLanguage ──────────────────────────────────────────

describe("primaryLanguage", () => {
  it("returns dash when no languages", () => {
    expect(primaryLanguage()).toBe("-");
    expect(primaryLanguage(undefined)).toBe("-");
  });

  it("returns dash for empty object", () => {
    expect(primaryLanguage({})).toBe("-");
  });

  it("returns the only language", () => {
    expect(primaryLanguage({ TypeScript: 100 })).toBe("TypeS");
  });

  it("returns the language with highest count", () => {
    expect(primaryLanguage({ TypeScript: 200, Python: 50, Rust: 10 })).toBe("TypeS");
  });

  it("truncates long language names to 5 chars", () => {
    expect(primaryLanguage({ JavaScript: 100 })).toBe("JavaS");
  });

  it("returns short language names as-is", () => {
    expect(primaryLanguage({ Go: 100 })).toBe("Go");
    expect(primaryLanguage({ Rust: 100 })).toBe("Rust");
    expect(primaryLanguage({ HTML: 50 })).toBe("HTML");
  });

  it("picks the top language when counts are different", () => {
    expect(primaryLanguage({ Python: 300, Ruby: 200 })).toBe("Pytho");
  });
});

// ── printTable ───────────────────────────────────────────────

describe("printTable", () => {
  it("prints header, divider, and rows to stdout", () => {
    initColor("never");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      printTable(
        ["Name", "Age"],
        [["Alice", "30"], ["Bob", "25"]],
        [10, 5],
        ["l", "r"],
        2,
      );
    } finally {
      console.log = origLog;
    }

    expect(logs.length).toBe(4); // header + divider + 2 rows
    expect(logs[0]).toContain("Name");
    expect(logs[0]).toContain("Age");
    // Divider uses plain dashes in no-color mode
    expect(logs[1]).toMatch(/^-+$/);
    expect(logs[2]).toContain("Alice");
    expect(logs[2]).toContain("30");
    expect(logs[3]).toContain("Bob");
    expect(logs[3]).toContain("25");
  });

  it("uses box-drawing chars for divider in color mode", () => {
    initColor("always");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      printTable(["X"], [["y"]], [5]);
    } finally {
      console.log = origLog;
      initColor("never");
    }

    // Divider should use ─ (box-drawing horizontal)
    expect(logs[1]).toContain("\u2500");
  });

  it("right-aligns columns when specified", () => {
    initColor("never");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      printTable(["Val"], [["42"]], [8], ["r"]);
    } finally {
      console.log = origLog;
    }

    // "42" right-aligned in 8 chars: "      42"
    expect(logs[2]).toBe("      42");
  });
});
