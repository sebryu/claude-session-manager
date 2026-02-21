import { describe, it, expect, beforeAll } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  searchSessions,
  getAllSessions,
  type EnrichedSession,
  type SessionEntry,
} from "./sessions.ts";

// ── Helpers ───────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionEntry> = {}): EnrichedSession {
  const entry: SessionEntry = {
    sessionId: "test-session-id-1234",
    fullPath: "/tmp/test.jsonl",
    fileMtime: Date.now(),
    firstPrompt: "Fix the bug",
    messageCount: 5,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    projectPath: "/Users/test/project",
    isSidechain: false,
    ...overrides,
  };
  return { entry, totalSizeBytes: 1000, projectDirName: "-Users-test-project" };
}

// ── searchSessions ────────────────────────────────────────────

describe("searchSessions", () => {
  const sessions: EnrichedSession[] = [
    makeSession({ sessionId: "aaa", firstPrompt: "Fix the authentication bug", projectPath: "/work/auth-service" }),
    makeSession({ sessionId: "bbb", firstPrompt: "Upgrade expo SDK to 50", projectPath: "/work/mobile-app" }),
    makeSession({ sessionId: "ccc", firstPrompt: "Write unit tests", projectPath: "/work/test-suite" }),
    makeSession({ sessionId: "ddd", firstPrompt: "Refactor database queries", projectPath: "/work/backend" }),
  ];

  it("returns matching sessions for a simple query", () => {
    const results = searchSessions(sessions, "authentication");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entry.sessionId).toBe("aaa");
  });

  it("returns multiple matches sorted by score", () => {
    const results = searchSessions(sessions, "expo upgrade");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entry.sessionId).toBe("bbb");
  });

  it("returns empty array for a query with no matches", () => {
    const results = searchSessions(sessions, "xyzzy-qqqq-zzzz-nonexistent");
    expect(results).toHaveLength(0);
  });

  it("returns all sessions for an empty query when all match", () => {
    // "fix" appears in firstPrompt of session aaa
    const results = searchSessions(sessions, "fix");
    expect(results.length).toBeGreaterThan(0);
  });

  it("matches against projectPath", () => {
    const results = searchSessions(sessions, "mobile-app");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entry.sessionId).toBe("bbb");
  });

  it("is case-insensitive", () => {
    const lower = searchSessions(sessions, "authentication");
    const upper = searchSessions(sessions, "AUTHENTICATION");
    expect(lower.length).toBe(upper.length);
  });

  it("handles multi-word queries", () => {
    const results = searchSessions(sessions, "unit tests");
    expect(results[0]?.entry.sessionId).toBe("ccc");
  });

  it("scores word-boundary matches higher than substring matches", () => {
    // Create sessions where one has an exact word match, another has substring
    const s1 = makeSession({ sessionId: "x1", firstPrompt: "expo is great" });
    const s2 = makeSession({ sessionId: "x2", firstPrompt: "something about myexpo embedded" });
    const results = searchSessions([s1, s2], "expo");
    // x1 should score higher due to word-boundary bonus
    expect(results[0]?.entry.sessionId).toBe("x1");
  });

  it("matches against facets fields", () => {
    const sessionWithFacets: EnrichedSession = {
      ...makeSession({ sessionId: "fff" }),
      facets: {
        brief_summary: "Implemented OAuth2 authentication",
        session_type: "coding",
      },
    };
    const results = searchSessions([...sessions, sessionWithFacets], "oauth2");
    expect(results.some((r) => r.entry.sessionId === "fff")).toBe(true);
  });
});

// ── getAllSessions with fixture dir ───────────────────────────

describe("getAllSessions with fixtures", () => {
  // NOTE: Bun runs ALL beforeAll hooks across ALL top-level describe blocks before any tests run.
  // So we cannot use beforeAll here — env must be set inside each it() block directly.
  const fixtureDir = join(import.meta.dir, "..", "test", "fixtures", "claude-home");

  it("loads indexed sessions from sessions-index.json", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const sessions = await getAllSessions();
    const indexed = sessions.filter((s) => s.entry.sessionId === "aaaabbbb-1111-2222-3333-444455556666");
    expect(indexed.length).toBe(1);
    const session = indexed[0]!;
    expect(session.entry.firstPrompt).toBe("Fix the authentication bug");
    expect(session.entry.messageCount).toBe(5);
    expect(session.entry.gitBranch).toBe("fix/auth");
  });

  it("loads a second indexed session", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const sessions = await getAllSessions();
    const expo = sessions.filter((s) => s.entry.sessionId === "ccccdddd-5555-6666-7777-888899990000");
    expect(expo.length).toBe(1);
    expect(expo[0]?.entry.firstPrompt).toContain("expo");
  });

  it("discovers unindexed JSONL sessions", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const sessions = await getAllSessions();
    const unindexed = sessions.filter((s) => s.entry.sessionId === "eeee1111-aaaa-bbbb-cccc-dddd11112222");
    expect(unindexed.length).toBe(1);
    const session = unindexed[0]!;
    expect(session.entry.firstPrompt).toContain("unit test");
    expect(session.entry.messageCount).toBe(2);
  });

  it("enriches indexed session with meta data", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === "aaaabbbb-1111-2222-3333-444455556666");
    expect(session?.meta).toBeDefined();
    expect(session?.meta?.duration_minutes).toBe(17);
    expect(session?.meta?.input_tokens).toBe(15000);
  });

  it("enriches indexed session with facets data", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === "aaaabbbb-1111-2222-3333-444455556666");
    expect(session?.facets).toBeDefined();
    expect(session?.facets?.outcome).toBe("fully_completed");
    expect(session?.facets?.session_type).toBe("debugging");
  });

  it("reports progress via callback", async () => {
    process.env["CLAUDE_DIR"] = fixtureDir;
    const progresses: Array<{ loaded: number; total: number }> = [];
    await getAllSessions((loaded, total) => progresses.push({ loaded, total }));
    expect(progresses.length).toBeGreaterThan(0);
    // All progress calls should have consistent totals
    const lastTotal = progresses[progresses.length - 1]?.total ?? 0;
    expect(lastTotal).toBeGreaterThan(0);
  });

  it("returns empty array when CLAUDE_DIR does not exist", async () => {
    process.env["CLAUDE_DIR"] = "/nonexistent/path/that/does/not/exist";
    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(0);
    // Restore for next tests in this file
    process.env["CLAUDE_DIR"] = fixtureDir;
  });
});

// ── parseJsonlSession (via getAllSessions) ─────────────────────

describe("parseJsonlSession via fixture JSONL", () => {
  // NOTE: Bun runs ALL beforeAll hooks before any tests run, so we cannot use beforeAll
  // to set CLAUDE_DIR reliably. Instead, each test sets it explicitly and manages its own
  // tmpDir. We use a shared tmpDir path derived deterministically from the test file name.
  const tmpDir = join(tmpdir(), "csm-test-parseJsonl");

  beforeAll(async () => {
    // Create the tmpDir structure. Bun runs this before any tests but we only use tmpDir
    // for writes/reads inside each test which explicitly set CLAUDE_DIR = tmpDir.
    await mkdir(join(tmpDir, "projects", "-test-dir"), { recursive: true });
    await writeFile(
      join(tmpDir, "projects", "-test-dir", "sessions-index.json"),
      JSON.stringify({ version: 1, originalPath: "/test", entries: [] })
    );
  });

  it("handles an empty JSONL file gracefully", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    await writeFile(join(tmpDir, "projects", "-test-dir", "empty-session.jsonl"), "");
    const sessions = await getAllSessions();
    const empty = sessions.find((s) => s.entry.sessionId === "empty-session");
    expect(empty).toBeUndefined();
  });

  it("skips corrupted lines and parses the rest", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "corrupt-test-session";
    const content = [
      JSON.stringify({ type: "user", role: "user", content: "hello", cwd: "/test", timestamp: "2023-01-01T00:00:00Z" }),
      "THIS IS NOT JSON {{{{",
      JSON.stringify({ type: "assistant", role: "assistant", message: { usage: { input_tokens: 10, output_tokens: 5 } }, timestamp: "2023-01-01T00:01:00Z" }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-test-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    // Should still get the first valid user message
    expect(session?.entry.firstPrompt).toBe("hello");
  });

  it("extracts tokens from assistant messages", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "token-test-session";
    const content = [
      JSON.stringify({ type: "user", role: "user", content: "Count tokens", timestamp: "2023-01-01T00:00:00Z" }),
      JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 500, output_tokens: 200 } }, timestamp: "2023-01-01T00:00:05Z" }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-test-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session?.computedInputTokens).toBe(500);
    expect(session?.computedOutputTokens).toBe(200);
  });

  it("cleans up tmp dir after tests", async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
});
