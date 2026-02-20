import { describe, it, expect } from "bun:test";
import {
  formatBytes,
  formatTokens,
  truncate,
  formatDuration,
  formatDurationShort,
  relativeDate,
  padRight,
  padLeft,
  projectName,
  computeListColWidths,
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

// ── computeListColWidths ─────────────────────────────────────

describe("computeListColWidths", () => {
  // Fixed cols + 9 separators of 2 = 89
  const FIXED_TOTAL = 36 + 11 + 5 + 5 + 7 + 7 + 9 * 2;

  it("returns exactly 4 widths", () => {
    expect(computeListColWidths(200).length).toBe(4);
  });

  it("session column gets the largest share", () => {
    const [name, project, session, branch] = computeListColWidths(220);
    expect(session).toBeGreaterThan(name);
    expect(session).toBeGreaterThan(project);
    expect(session).toBeGreaterThan(branch);
  });

  it("total columns fill the terminal width on wide displays", () => {
    for (const termWidth of [160, 180, 200, 220, 260]) {
      const widths = computeListColWidths(termWidth);
      const total = FIXED_TOTAL + widths.reduce((a, b) => a + b, 0);
      // Allow ±3 chars from rounding across 4 columns
      expect(Math.abs(total - termWidth)).toBeLessThanOrEqual(3);
    }
  });

  it("expands columns as terminal gets wider", () => {
    const [, , session160] = computeListColWidths(160);
    const [, , session220] = computeListColWidths(220);
    const [, , session300] = computeListColWidths(300);
    expect(session220).toBeGreaterThan(session160);
    expect(session300).toBeGreaterThan(session220);
  });

  it("never goes below minimum widths on narrow terminals", () => {
    const [name, project, session, branch] = computeListColWidths(100);
    expect(name).toBeGreaterThanOrEqual(10);
    expect(project).toBeGreaterThanOrEqual(12);
    expect(session).toBeGreaterThanOrEqual(18);
    expect(branch).toBeGreaterThanOrEqual(8);
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
