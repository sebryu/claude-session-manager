import { describe, it, expect } from "bun:test";
import { parseSizeString, getSortFn, sessionTokens, sessionDuration, termPageSize, FALLBACK_TERM_HEIGHT } from "./index.ts";
import type { EnrichedSession, SessionEntry, SessionMeta } from "./sessions.ts";

// ── Test helper ──────────────────────────────────────────────

function makeTestSession(overrides: Partial<{
  totalSizeBytes: number;
  messageCount: number;
  modified: string;
  input_tokens: number;
  output_tokens: number;
  duration_minutes: number;
  files_modified: number;
  git_commits: number;
  computedInputTokens: number;
  computedOutputTokens: number;
  computedDurationMinutes: number;
}>): EnrichedSession {
  const hasMeta =
    overrides.input_tokens !== undefined ||
    overrides.output_tokens !== undefined ||
    overrides.duration_minutes !== undefined ||
    overrides.files_modified !== undefined ||
    overrides.git_commits !== undefined;

  const entry: SessionEntry = {
    sessionId: "test-" + Math.random().toString(36).slice(2, 10),
    fullPath: "/tmp/test.jsonl",
    fileMtime: Date.now(),
    firstPrompt: "test prompt",
    messageCount: overrides.messageCount ?? 5,
    created: "2025-01-01T00:00:00Z",
    modified: overrides.modified ?? "2025-01-15T00:00:00Z",
    projectPath: "/test/project",
    isSidechain: false,
  };

  const meta: SessionMeta | undefined = hasMeta
    ? {
        session_id: entry.sessionId,
        project_path: entry.projectPath,
        start_time: entry.created,
        duration_minutes: overrides.duration_minutes ?? 0,
        user_message_count: 3,
        assistant_message_count: 3,
        tool_counts: {},
        languages: {},
        input_tokens: overrides.input_tokens ?? 0,
        output_tokens: overrides.output_tokens ?? 0,
        lines_added: 0,
        lines_removed: 0,
        files_modified: overrides.files_modified ?? 0,
        git_commits: overrides.git_commits,
      }
    : undefined;

  return {
    entry,
    meta,
    totalSizeBytes: overrides.totalSizeBytes ?? 1000,
    projectDirName: "test-project",
    computedDurationMinutes: overrides.computedDurationMinutes,
    computedInputTokens: overrides.computedInputTokens,
    computedOutputTokens: overrides.computedOutputTokens,
  };
}

// ── parseSizeString ──────────────────────────────────────────

describe("parseSizeString", () => {
  it("parses '100B' to 100", () => {
    expect(parseSizeString("100B")).toBe(100);
  });

  it("parses '50KB' to 50 * 1024", () => {
    expect(parseSizeString("50KB")).toBe(50 * 1024);
  });

  it("parses '10MB' to 10 * 1024^2", () => {
    expect(parseSizeString("10MB")).toBe(10 * 1024 ** 2);
  });

  it("parses '2GB' to 2 * 1024^3", () => {
    expect(parseSizeString("2GB")).toBe(2 * 1024 ** 3);
  });

  it("parses '1.5MB' to 1.5 * 1024^2", () => {
    expect(parseSizeString("1.5MB")).toBe(1.5 * 1024 ** 2);
  });

  it("is case insensitive: '10mb' works", () => {
    expect(parseSizeString("10mb")).toBe(10 * 1024 ** 2);
  });

  it("no unit defaults to bytes: '500' -> 500", () => {
    expect(parseSizeString("500")).toBe(500);
  });

  it("returns undefined for invalid input 'abc'", () => {
    expect(parseSizeString("abc")).toBeUndefined();
  });

  it("returns undefined for empty string ''", () => {
    expect(parseSizeString("")).toBeUndefined();
  });

  it("returns undefined for invalid input 'MB50'", () => {
    expect(parseSizeString("MB50")).toBeUndefined();
  });

  it("parses '0B' to 0", () => {
    expect(parseSizeString("0B")).toBe(0);
  });
});

// ── getSortFn ────────────────────────────────────────────────

describe("getSortFn", () => {
  it("'date' sorts by modified date descending", () => {
    const a = makeTestSession({ modified: "2025-01-01T00:00:00Z" });
    const b = makeTestSession({ modified: "2025-06-01T00:00:00Z" });
    const sortFn = getSortFn("date");
    const sorted = [a, b].sort(sortFn);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
  });

  it("'size' sorts by totalSizeBytes descending", () => {
    const small = makeTestSession({ totalSizeBytes: 100 });
    const large = makeTestSession({ totalSizeBytes: 50000 });
    const sortFn = getSortFn("size");
    const sorted = [small, large].sort(sortFn);
    expect(sorted[0]).toBe(large);
    expect(sorted[1]).toBe(small);
  });

  it("'tokens' sorts by total tokens descending", () => {
    const low = makeTestSession({ input_tokens: 100, output_tokens: 50 });
    const high = makeTestSession({ input_tokens: 5000, output_tokens: 3000 });
    const sortFn = getSortFn("tokens");
    const sorted = [low, high].sort(sortFn);
    expect(sorted[0]).toBe(high);
    expect(sorted[1]).toBe(low);
  });

  it("'duration' sorts by duration_minutes descending", () => {
    const short = makeTestSession({ duration_minutes: 5 });
    const long = makeTestSession({ duration_minutes: 120 });
    const sortFn = getSortFn("duration");
    const sorted = [short, long].sort(sortFn);
    expect(sorted[0]).toBe(long);
    expect(sorted[1]).toBe(short);
  });

  it("'messages' sorts by messageCount descending", () => {
    const few = makeTestSession({ messageCount: 3 });
    const many = makeTestSession({ messageCount: 50 });
    const sortFn = getSortFn("messages");
    const sorted = [few, many].sort(sortFn);
    expect(sorted[0]).toBe(many);
    expect(sorted[1]).toBe(few);
  });

  it("'files-changed' sorts by files_modified descending", () => {
    const few = makeTestSession({ files_modified: 2 });
    const many = makeTestSession({ files_modified: 30 });
    const sortFn = getSortFn("files-changed");
    const sorted = [few, many].sort(sortFn);
    expect(sorted[0]).toBe(many);
    expect(sorted[1]).toBe(few);
  });

  it("'commits' sorts by git_commits descending", () => {
    const few = makeTestSession({ git_commits: 1 });
    const many = makeTestSession({ git_commits: 10 });
    const sortFn = getSortFn("commits");
    const sorted = [few, many].sort(sortFn);
    expect(sorted[0]).toBe(many);
    expect(sorted[1]).toBe(few);
  });

  it("default/unknown sort key falls back to date descending", () => {
    const old = makeTestSession({ modified: "2024-01-01T00:00:00Z" });
    const recent = makeTestSession({ modified: "2025-12-01T00:00:00Z" });
    const sortFn = getSortFn("unknown-key");
    const sorted = [old, recent].sort(sortFn);
    expect(sorted[0]).toBe(recent);
    expect(sorted[1]).toBe(old);
  });
});

// ── sessionTokens ────────────────────────────────────────────

describe("sessionTokens", () => {
  it("returns sum of meta input + output tokens when meta exists", () => {
    const s = makeTestSession({ input_tokens: 1000, output_tokens: 500 });
    expect(sessionTokens(s)).toBe(1500);
  });

  it("falls back to computed tokens when no meta", () => {
    const s = makeTestSession({
      computedInputTokens: 800,
      computedOutputTokens: 400,
    });
    expect(sessionTokens(s)).toBe(1200);
  });

  it("returns 0 when neither meta nor computed tokens exist", () => {
    const s = makeTestSession({});
    expect(sessionTokens(s)).toBe(0);
  });
});

// ── sessionDuration ──────────────────────────────────────────

describe("sessionDuration", () => {
  it("returns meta.duration_minutes when meta exists", () => {
    const s = makeTestSession({ duration_minutes: 45 });
    expect(sessionDuration(s)).toBe(45);
  });

  it("falls back to computedDurationMinutes", () => {
    const s = makeTestSession({ computedDurationMinutes: 30 });
    expect(sessionDuration(s)).toBe(30);
  });

  it("returns undefined when neither exists", () => {
    const s = makeTestSession({});
    expect(sessionDuration(s)).toBeUndefined();
  });
});

// ── termPageSize ────────────────────────────────────────────

describe("termPageSize", () => {
  const origRows = process.stdout.rows;

  function withRows(rows: number | undefined, fn: () => void) {
    Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
    try {
      fn();
    } finally {
      Object.defineProperty(process.stdout, "rows", { value: origRows, configurable: true });
    }
  }

  it("uses terminal rows minus reserved (default 4)", () => {
    withRows(40, () => {
      expect(termPageSize()).toBe(36);
    });
  });

  it("uses custom reserved value", () => {
    withRows(40, () => {
      expect(termPageSize(10)).toBe(30);
    });
  });

  it("falls back to FALLBACK_TERM_HEIGHT when rows is undefined", () => {
    withRows(undefined, () => {
      expect(termPageSize()).toBe(FALLBACK_TERM_HEIGHT - 4);
    });
  });

  it("returns minimum of 5 for very small terminals", () => {
    withRows(6, () => {
      expect(termPageSize()).toBe(5);
    });
  });

  it("returns minimum of 5 when rows minus reserved would be less than 5", () => {
    withRows(3, () => {
      expect(termPageSize()).toBe(5);
    });
  });

  it("handles large terminal heights", () => {
    withRows(200, () => {
      expect(termPageSize()).toBe(196);
    });
  });
});
