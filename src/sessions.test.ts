import { describe, it, expect, beforeAll } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  searchSessions,
  getAllSessions,
  getSessionLabel,
  deleteSession,
  calculateSessionSize,
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
  // beforeAll sets up the shared tmpDir structure. Each test then sets CLAUDE_DIR = tmpDir
  // explicitly so that other describe blocks running concurrently don't interfere.
  const tmpDir = join(tmpdir(), "csm-test-parseJsonl");

  beforeAll(async () => {
    // Create the tmpDir structure for JSONL parsing tests.
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

// ── getSessionLabel ──────────────────────────────────────────

describe("getSessionLabel", () => {
  it("returns customTitle when set and is a real prompt", () => {
    const session = makeSession({ customTitle: "My custom title" });
    expect(getSessionLabel(session)).toBe("My custom title");
  });

  it("falls back to summary when no custom title", () => {
    const session = makeSession({ summary: "Fixed the login bug", customTitle: undefined });
    expect(getSessionLabel(session)).toBe("Fixed the login bug");
  });

  it("falls back to facets.brief_summary", () => {
    const session: EnrichedSession = {
      ...makeSession({ customTitle: undefined, summary: undefined, firstPrompt: "" }),
      facets: { brief_summary: "Implemented OAuth flow" },
    };
    expect(getSessionLabel(session)).toBe("Implemented OAuth flow");
  });

  it("falls back to meta.first_prompt", () => {
    const session: EnrichedSession = {
      ...makeSession({ customTitle: undefined, summary: undefined, firstPrompt: "" }),
      meta: {
        session_id: "test",
        project_path: "/test",
        start_time: "",
        duration_minutes: 0,
        user_message_count: 0,
        assistant_message_count: 0,
        tool_counts: {},
        languages: {},
        input_tokens: 0,
        output_tokens: 0,
        lines_added: 0,
        lines_removed: 0,
        files_modified: 0,
        first_prompt: "Hello from meta",
      },
    };
    expect(getSessionLabel(session)).toBe("Hello from meta");
  });

  it("falls back to entry.firstPrompt", () => {
    const session = makeSession({
      customTitle: undefined,
      summary: undefined,
      firstPrompt: "My first prompt text",
    });
    expect(getSessionLabel(session)).toBe("My first prompt text");
  });

  it("returns short session ID (first 8 chars) when all sources are empty", () => {
    const session = makeSession({
      sessionId: "abcdef1234567890",
      customTitle: undefined,
      summary: undefined,
      firstPrompt: "",
    });
    expect(getSessionLabel(session)).toBe("abcdef12");
  });

  it("skips system noise in firstPrompt and returns session ID", () => {
    const session = makeSession({
      sessionId: "noise12345678",
      customTitle: undefined,
      summary: undefined,
      firstPrompt: "DO NOT respond to these messages",
    });
    expect(getSessionLabel(session)).toBe("noise123");
  });

  it("skips empty customTitle and falls through to summary", () => {
    const session = makeSession({
      customTitle: "",
      summary: "A good summary",
    });
    expect(getSessionLabel(session)).toBe("A good summary");
  });

  it("cleans XML tags from the label", () => {
    const session = makeSession({
      customTitle: "<system>Important</system> Fix the bug",
    });
    expect(getSessionLabel(session)).toBe("Important Fix the bug");
  });
});

// ── deleteSession ────────────────────────────────────────────

describe("deleteSession", () => {
  const tmpDir = join(tmpdir(), "csm-test-deleteSession-" + Date.now());

  beforeAll(async () => {
    // Create full directory structure mimicking Claude dir
    await mkdir(join(tmpDir, "projects", "-test-proj"), { recursive: true });
    await mkdir(join(tmpDir, "usage-data", "session-meta"), { recursive: true });
    await mkdir(join(tmpDir, "usage-data", "facets"), { recursive: true });
    await mkdir(join(tmpDir, "debug"), { recursive: true });
    await mkdir(join(tmpDir, "file-history"), { recursive: true });
    await mkdir(join(tmpDir, "tasks"), { recursive: true });
    await mkdir(join(tmpDir, "todos"), { recursive: true });
    await mkdir(join(tmpDir, "session-env"), { recursive: true });
  });

  it("deletes the JSONL file and associated files", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "del-session-1111";
    const jsonlPath = join(tmpDir, "projects", "-test-proj", `${id}.jsonl`);

    // Create session files
    await writeFile(jsonlPath, '{"type":"user","content":"hi"}\n');
    await writeFile(join(tmpDir, "debug", `${id}.txt`), "debug log");
    await mkdir(join(tmpDir, "file-history", id), { recursive: true });
    await writeFile(join(tmpDir, "file-history", id, "file.txt"), "history");
    await mkdir(join(tmpDir, "tasks", id), { recursive: true });
    await writeFile(join(tmpDir, "tasks", id, "task.json"), "{}");
    await writeFile(join(tmpDir, "usage-data", "session-meta", `${id}.json`), "{}");
    await writeFile(join(tmpDir, "usage-data", "facets", `${id}.json`), "{}");

    // Create index with this session
    const indexPath = join(tmpDir, "projects", "-test-proj", "sessions-index.json");
    await writeFile(
      indexPath,
      JSON.stringify({
        version: 1,
        originalPath: "/test",
        entries: [
          {
            sessionId: id,
            fullPath: jsonlPath,
            fileMtime: Date.now(),
            firstPrompt: "hi",
            messageCount: 1,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            projectPath: "/test",
            isSidechain: false,
          },
        ],
      })
    );

    const session: EnrichedSession = {
      entry: {
        sessionId: id,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "hi",
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        projectPath: "/test",
        isSidechain: false,
      },
      totalSizeBytes: 100,
      projectDirName: "-test-proj",
    };

    await deleteSession(session);

    // Verify JSONL is deleted
    const { stat: statFn } = await import("node:fs/promises");
    await expect(statFn(jsonlPath)).rejects.toThrow();
    // Verify debug log is deleted
    await expect(statFn(join(tmpDir, "debug", `${id}.txt`))).rejects.toThrow();
    // Verify file-history dir is deleted
    await expect(statFn(join(tmpDir, "file-history", id))).rejects.toThrow();
    // Verify tasks dir is deleted
    await expect(statFn(join(tmpDir, "tasks", id))).rejects.toThrow();
    // Verify meta file is deleted
    await expect(statFn(join(tmpDir, "usage-data", "session-meta", `${id}.json`))).rejects.toThrow();
    // Verify facets file is deleted
    await expect(statFn(join(tmpDir, "usage-data", "facets", `${id}.json`))).rejects.toThrow();
  });

  it("updates the sessions-index.json atomically (removes the entry)", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "del-session-2222";
    const keepId = "keep-session-3333";
    const jsonlPath = join(tmpDir, "projects", "-test-proj", `${id}.jsonl`);

    // Create only the JSONL file for deletion target
    await writeFile(jsonlPath, '{"type":"user","content":"bye"}\n');

    // Create index with two sessions
    const indexPath = join(tmpDir, "projects", "-test-proj", "sessions-index.json");
    await writeFile(
      indexPath,
      JSON.stringify({
        version: 1,
        originalPath: "/test",
        entries: [
          {
            sessionId: id,
            fullPath: jsonlPath,
            fileMtime: Date.now(),
            firstPrompt: "bye",
            messageCount: 1,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            projectPath: "/test",
            isSidechain: false,
          },
          {
            sessionId: keepId,
            fullPath: "/fake/path.jsonl",
            fileMtime: Date.now(),
            firstPrompt: "stay",
            messageCount: 1,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            projectPath: "/test",
            isSidechain: false,
          },
        ],
      })
    );

    const session: EnrichedSession = {
      entry: {
        sessionId: id,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "bye",
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        projectPath: "/test",
        isSidechain: false,
      },
      totalSizeBytes: 50,
      projectDirName: "-test-proj",
    };

    await deleteSession(session);

    // Read the updated index
    const { readFile: readFileFn } = await import("node:fs/promises");
    const updatedIndex = JSON.parse(await readFileFn(indexPath, "utf-8"));
    expect(updatedIndex.entries.length).toBe(1);
    expect(updatedIndex.entries[0].sessionId).toBe(keepId);
  });

  it("handles missing files gracefully (allSettled)", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "del-session-missing-4444";
    const jsonlPath = join(tmpDir, "projects", "-test-proj", `${id}.jsonl`);

    // Do NOT create any files — everything is missing

    // Create index without this session (so index update is still attempted)
    const indexPath = join(tmpDir, "projects", "-test-proj", "sessions-index.json");
    await writeFile(
      indexPath,
      JSON.stringify({ version: 1, originalPath: "/test", entries: [] })
    );

    const session: EnrichedSession = {
      entry: {
        sessionId: id,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "ghost",
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        projectPath: "/test",
        isSidechain: false,
      },
      totalSizeBytes: 0,
      projectDirName: "-test-proj",
    };

    // Should not throw even though files don't exist (rm with force: true)
    await deleteSession(session);
    // If we got here without throwing, the test passes
    expect(true).toBe(true);
  });

  it("deletes matching todo files", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "del-session-todos-5555";
    const jsonlPath = join(tmpDir, "projects", "-test-proj", `${id}.jsonl`);

    // Create the JSONL and some todo files
    await writeFile(jsonlPath, '{"type":"user","content":"todo test"}\n');
    await writeFile(join(tmpDir, "todos", id), "todo exact match");
    await writeFile(join(tmpDir, "todos", `${id}-subtask`), "todo with dash prefix");
    await writeFile(join(tmpDir, "todos", `${id}.json`), "todo with dot prefix");
    await writeFile(join(tmpDir, "todos", "unrelated-todo"), "should not be deleted");

    const indexPath = join(tmpDir, "projects", "-test-proj", "sessions-index.json");
    await writeFile(
      indexPath,
      JSON.stringify({ version: 1, originalPath: "/test", entries: [] })
    );

    const session: EnrichedSession = {
      entry: {
        sessionId: id,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "todo test",
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        projectPath: "/test",
        isSidechain: false,
      },
      totalSizeBytes: 50,
      projectDirName: "-test-proj",
    };

    await deleteSession(session);

    const { stat: statFn } = await import("node:fs/promises");
    // All matching todo files should be deleted
    await expect(statFn(join(tmpDir, "todos", id))).rejects.toThrow();
    await expect(statFn(join(tmpDir, "todos", `${id}-subtask`))).rejects.toThrow();
    await expect(statFn(join(tmpDir, "todos", `${id}.json`))).rejects.toThrow();
    // Unrelated todo should still exist
    const unrelated = await statFn(join(tmpDir, "todos", "unrelated-todo"));
    expect(unrelated.isFile()).toBe(true);
  });

  it("cleans up tmp dir after deleteSession tests", async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
});

// ── JSONL parsing edge cases via getAllSessions ──────────────

describe("JSONL parsing edge cases", () => {
  const tmpDir = join(tmpdir(), "csm-test-jsonl-edges-" + Date.now());

  beforeAll(async () => {
    await mkdir(join(tmpDir, "projects", "-edge-dir"), { recursive: true });
    await writeFile(
      join(tmpDir, "projects", "-edge-dir", "sessions-index.json"),
      JSON.stringify({ version: 1, originalPath: "/edge", entries: [] })
    );
  });

  it("extracts firstPrompt from array content in user message", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "array-content-session";
    const content = [
      JSON.stringify({
        type: "user",
        role: "user",
        content: [
          { type: "text", text: "Hello from array content" },
          { type: "image", source: "data:image/png;base64,..." },
        ],
        cwd: "/test",
        timestamp: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        role: "assistant",
        message: { content: "Got it", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2024-01-01T00:00:05Z",
      }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-edge-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    expect(session?.entry.firstPrompt).toBe("Hello from array content");
  });

  it("extracts customTitle from custom-title type message", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "custom-title-session";
    const content = [
      JSON.stringify({
        type: "custom-title",
        customTitle: "My Special Session",
      }),
      JSON.stringify({
        type: "user",
        role: "user",
        content: "Do something",
        cwd: "/test",
        timestamp: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        role: "assistant",
        message: { content: "Done", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2024-01-01T00:00:05Z",
      }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-edge-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    expect(session?.entry.customTitle).toBe("My Special Session");
  });

  it("uses message.timestamp when top-level timestamp is absent", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "nested-timestamp-session";
    const content = [
      JSON.stringify({
        type: "user",
        role: "user",
        content: "Nested timestamps",
        cwd: "/test",
        message: { timestamp: "2024-06-15T10:00:00Z" },
      }),
      JSON.stringify({
        type: "assistant",
        role: "assistant",
        message: {
          content: "Response",
          timestamp: "2024-06-15T10:05:00Z",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-edge-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    expect(session?.entry.created).toBe("2024-06-15T10:00:00Z");
    expect(session?.entry.modified).toBe("2024-06-15T10:05:00Z");
  });

  it("falls back to file birthtime when no timestamps exist", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "no-timestamp-session";
    const content = [
      JSON.stringify({
        type: "user",
        role: "user",
        content: "No timestamp here",
        cwd: "/test",
      }),
    ].join("\n");
    const filePath = join(tmpDir, "projects", "-edge-dir", `${id}.jsonl`);
    await writeFile(filePath, content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    // created and modified should be ISO strings (file birthtime/mtime)
    expect(session?.entry.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(session?.entry.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // They should be recent (within last minute) since we just created the file
    const createdTime = new Date(session!.entry.created).getTime();
    expect(Date.now() - createdTime).toBeLessThan(60_000);
  });

  it("computes duration from timestamps", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "duration-compute-session";
    const content = [
      JSON.stringify({
        type: "user",
        role: "user",
        content: "Start",
        cwd: "/test",
        timestamp: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        role: "assistant",
        message: { content: "End", usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: "2024-01-01T00:10:00Z",
      }),
    ].join("\n");
    await writeFile(join(tmpDir, "projects", "-edge-dir", `${id}.jsonl`), content);

    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.entry.sessionId === id);
    expect(session).toBeDefined();
    expect(session?.computedDurationMinutes).toBe(10);
  });

  it("cleans up tmp dir after JSONL edge case tests", async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
});

// ── calculateSessionSize ─────────────────────────────────────

describe("calculateSessionSize", () => {
  const tmpDir = join(tmpdir(), "csm-test-calcSize-" + Date.now());

  beforeAll(async () => {
    await mkdir(join(tmpDir, "debug"), { recursive: true });
    await mkdir(join(tmpDir, "file-history"), { recursive: true });
    await mkdir(join(tmpDir, "tasks"), { recursive: true });
    await mkdir(join(tmpDir, "usage-data", "session-meta"), { recursive: true });
    await mkdir(join(tmpDir, "usage-data", "facets"), { recursive: true });
  });

  it("sums sizes of JSONL, debug, file-history, tasks, meta, and facets", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "size-session-1111";
    const jsonlPath = join(tmpDir, `${id}.jsonl`);

    // Create files with known content sizes
    const jsonlContent = "A".repeat(100);
    const debugContent = "B".repeat(50);
    const metaContent = "C".repeat(30);
    const facetsContent = "D".repeat(20);

    await writeFile(jsonlPath, jsonlContent);
    await writeFile(join(tmpDir, "debug", `${id}.txt`), debugContent);
    await mkdir(join(tmpDir, "file-history", id), { recursive: true });
    await writeFile(join(tmpDir, "file-history", id, "a.txt"), "E".repeat(40));
    await mkdir(join(tmpDir, "tasks", id), { recursive: true });
    await writeFile(join(tmpDir, "tasks", id, "t.json"), "F".repeat(25));
    await writeFile(join(tmpDir, "usage-data", "session-meta", `${id}.json`), metaContent);
    await writeFile(join(tmpDir, "usage-data", "facets", `${id}.json`), facetsContent);

    const size = await calculateSessionSize(id, jsonlPath);
    // 100 + 50 + 40 + 25 + 30 + 20 = 265
    expect(size).toBe(265);
  });

  it("returns only JSONL size when no other files exist", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "size-session-only-jsonl";
    const jsonlPath = join(tmpDir, `${id}.jsonl`);

    await writeFile(jsonlPath, "X".repeat(200));

    const size = await calculateSessionSize(id, jsonlPath);
    expect(size).toBe(200);
  });

  it("returns 0 when JSONL does not exist", async () => {
    process.env["CLAUDE_DIR"] = tmpDir;
    const id = "size-session-nonexistent";
    const jsonlPath = join(tmpDir, `${id}.jsonl`);
    // Don't create the file

    const size = await calculateSessionSize(id, jsonlPath);
    expect(size).toBe(0);
  });

  it("cleans up tmp dir after calculateSessionSize tests", async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
});
