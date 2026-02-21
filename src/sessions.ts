import { readdir, stat, rm, readFile, writeFile, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// Dynamic accessors — read process.env each call so tests can override via process.env["CLAUDE_DIR"]
export function getClaudeDir(): string { return process.env["CLAUDE_DIR"] ?? join(homedir(), ".claude"); }


function projectsDir(): string { return join(getClaudeDir(), "projects"); }
function debugDir(): string { return join(getClaudeDir(), "debug"); }
function fileHistoryDir(): string { return join(getClaudeDir(), "file-history"); }
function tasksDir(): string { return join(getClaudeDir(), "tasks"); }
function todosDir(): string { return join(getClaudeDir(), "todos"); }
function sessionEnvDir(): string { return join(getClaudeDir(), "session-env"); }
function sessionMetaDir(): string { return join(getClaudeDir(), "usage-data", "session-meta"); }
function facetsDir(): string { return join(getClaudeDir(), "usage-data", "facets"); }

// Named constants
const FIRST_PROMPT_SLICE = 231;
const SEARCH_WORD_BOUNDARY_BONUS = 0.5;

// Module-level debug flag, set by index.ts at startup
let debugEnabled = false;
export function setDebug(v: boolean): void {
  debugEnabled = v;
}

function logDebug(msg: string): void {
  if (debugEnabled) process.stderr.write(`[debug] ${msg}\n`);
}

function logWarn(msg: string): void {
  process.stderr.write(`[warn] ${msg}\n`);
}

export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary?: string;
  customTitle?: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch?: string;
  projectPath: string;
  isSidechain: boolean;
}

export interface SessionMeta {
  session_id: string;
  project_path: string;
  start_time: string;
  duration_minutes: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_counts: Record<string, number>;
  languages: Record<string, number>;
  input_tokens: number;
  output_tokens: number;
  lines_added: number;
  lines_removed: number;
  files_modified: number;
  git_commits?: number;
  git_pushes?: number;
  first_prompt?: string;
  summary?: string;
  user_interruptions?: number;
  tool_errors?: number;
  tool_error_categories?: Record<string, number>;
  uses_task_agent?: boolean;
  uses_mcp?: boolean;
  uses_web_search?: boolean;
  uses_web_fetch?: boolean;
  user_response_times?: number[];
  message_hours?: number[];
}

export interface SessionFacets {
  underlying_goal?: string;
  outcome?: string;
  session_type?: string;
  brief_summary?: string;
  claude_helpfulness?: string;
  goal_categories?: Record<string, number>;
  friction_counts?: Record<string, number>;
  friction_detail?: string;
  primary_success?: string;
  user_satisfaction_counts?: Record<string, number>;
}

export interface EnrichedSession {
  entry: SessionEntry;
  meta?: SessionMeta;
  facets?: SessionFacets;
  totalSizeBytes: number;
  projectDirName: string;
  /** Duration in minutes computed from timestamps (fallback when meta unavailable) */
  computedDurationMinutes?: number;
  /** Tokens summed from JSONL message.usage (fallback when meta unavailable) */
  computedInputTokens?: number;
  computedOutputTokens?: number;
}

async function fileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch (err) {
    logDebug(`size failed for ${path}: ${String(err)}`);
    return 0;
  }
}

async function dirSize(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      // Skip symlinks to avoid infinite loops
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(path, entry.name);
      if (entry.isFile()) {
        total += (await stat(fullPath)).size;
      } else if (entry.isDirectory()) {
        total += await dirSize(fullPath);
      }
    }
    return total;
  } catch (err) {
    logDebug(`size failed for ${path}: ${String(err)}`);
    return 0;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf-8");
    try {
      return JSON.parse(content) as T;
    } catch (parseErr) {
      logDebug(`JSON parse error in ${path}: ${String(parseErr)}`);
      return undefined;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logDebug(`read error for ${path}: ${String(err)}`);
    }
    return undefined;
  }
}

/** Strip XML-like tags and system caveats from prompts */
export function cleanPrompt(text: string): string {
  let cleaned = text.replace(/<[^>]+>/g, "").trim();
  // Remove "Caveat: ..." prefix from resumed sessions
  cleaned = cleaned.replace(/^Caveat:.*?(?:\.\s*)/s, "").trim();
  // Skip internal system messages that leaked into prompts
  if (cleaned.startsWith("DO NOT respond to these messages")) return "";
  if (cleaned.startsWith("[Request interrupted")) return "";
  // Normalize newlines/tabs to spaces so labels don't break table rows
  cleaned = cleaned.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ");
  return cleaned || text.trim();
}

/** Check if a prompt is meaningful (not empty or system noise) */
export function isRealPrompt(text: string): boolean {
  const cleaned = cleanPrompt(text);
  return cleaned.length > 0 && cleaned !== "No prompt";
}

export async function calculateSessionSize(
  sessionId: string,
  jsonlPath: string
): Promise<number> {
  const sizes = await Promise.all([
    fileSize(jsonlPath),
    fileSize(join(debugDir(), `${sessionId}.txt`)),
    dirSize(join(fileHistoryDir(), sessionId)),
    dirSize(join(tasksDir(), sessionId)),
    fileSize(join(sessionMetaDir(), `${sessionId}.json`)),
    fileSize(join(facetsDir(), `${sessionId}.json`)),
  ]);
  return sizes.reduce((a, b) => a + b, 0);
}

/** Parse token usage from an assistant message's message.usage */
function extractUsage(obj: Record<string, unknown>): { input: number; output: number } {
  const msg = obj["message"] as Record<string, unknown> | undefined;
  const usage = msg?.["usage"] as Record<string, number> | undefined;
  if (!usage) return { input: 0, output: 0 };
  return {
    input: (usage["input_tokens"] ?? 0) + (usage["cache_creation_input_tokens"] ?? 0) + (usage["cache_read_input_tokens"] ?? 0),
    output: usage["output_tokens"] ?? 0,
  };
}

/** Extract basic session info from a JSONL file (for sessions without an index) */
async function parseJsonlSession(
  filePath: string,
  dirName: string
): Promise<{ entry: SessionEntry; inputTokens: number; outputTokens: number } | undefined> {
  const sessionId = basename(filePath, ".jsonl");

  let projectPath = "";
  let gitBranch: string | undefined;
  let customTitle: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let firstPrompt = "No prompt";
  let messageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let lineNum = 0;
  let hasLines = false;

  try {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      lineNum++;
      hasLines = true;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        logDebug(`bad line ${lineNum} in ${filePath}`);
        continue;
      }

      const type = obj["type"] as string | undefined;

      // Extract custom title
      if (type === "custom-title") {
        customTitle = obj["customTitle"] as string | undefined;
        continue;
      }

      // Extract metadata from message entries (user/assistant/system have cwd, gitBranch)
      if (!projectPath && obj["cwd"]) {
        projectPath = obj["cwd"] as string;
      }
      if (!gitBranch && obj["gitBranch"]) {
        gitBranch = obj["gitBranch"] as string;
      }

      // Track timestamps from messages (not snapshots)
      if (obj["timestamp"]) {
        if (!firstTimestamp) firstTimestamp = obj["timestamp"] as string;
        lastTimestamp = obj["timestamp"] as string;
      } else if ((obj["message"] as Record<string, unknown>)?.["timestamp"]) {
        const ts = (obj["message"] as Record<string, unknown>)["timestamp"] as string;
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;
      }

      // Sum tokens from assistant messages
      if (type === "assistant") {
        const usage = extractUsage(obj);
        inputTokens += usage.input;
        outputTokens += usage.output;
      }

      // Count user messages and extract first prompt
      const role = obj["role"] as string | undefined;
      if (type === "user" || role === "user") {
        messageCount++;
        if (firstPrompt === "No prompt") {
          const content = obj["content"] ?? (obj["message"] as Record<string, unknown>)?.["content"];
          if (typeof content === "string") {
            firstPrompt = content.slice(0, FIRST_PROMPT_SLICE);
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (
                typeof part === "object" &&
                part !== null &&
                (part as Record<string, unknown>)["type"] === "text"
              ) {
                firstPrompt = ((part as Record<string, unknown>)["text"] as string).slice(0, FIRST_PROMPT_SLICE);
                break;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logDebug(`failed reading ${filePath}: ${String(err)}`);
    return undefined;
  }

  if (!hasLines) return undefined;

  // Fallback project path from dir name: "-Users-foo-bar" -> "/Users/foo/bar"
  if (!projectPath) {
    projectPath = "/" + dirName.replace(/^-/, "").replace(/-/g, "/");
  }

  const fileStat = await stat(filePath);
  let usingBirthtimeFallback = false;
  if (!firstTimestamp) usingBirthtimeFallback = true;
  const created = firstTimestamp ?? new Date(fileStat.birthtimeMs).toISOString();
  const modified = lastTimestamp ?? new Date(fileStat.mtimeMs).toISOString();

  if (usingBirthtimeFallback) {
    logWarn(`session ${sessionId}: no timestamps in JSONL, using file birthtime (may be unreliable)`);
  }

  return {
    entry: {
      sessionId,
      fullPath: filePath,
      fileMtime: fileStat.mtimeMs,
      firstPrompt,
      customTitle,
      messageCount,
      created,
      modified,
      gitBranch,
      projectPath,
      isSidechain: false,
    },
    inputTokens,
    outputTokens,
  };
}

/** Enrich a session entry with meta, facets, and size data. */
async function enrichEntry(
  sessionId: string,
  jsonlPath: string
): Promise<{ meta: SessionMeta | undefined; facets: SessionFacets | undefined; totalSizeBytes: number }> {
  const results = await Promise.allSettled([
    readJson<SessionMeta>(join(sessionMetaDir(), `${sessionId}.json`)),
    readJson<SessionFacets>(join(facetsDir(), `${sessionId}.json`)),
    calculateSessionSize(sessionId, jsonlPath),
  ]);
  return {
    meta: results[0].status === "fulfilled" ? results[0].value : undefined,
    facets: results[1].status === "fulfilled" ? results[1].value : undefined,
    totalSizeBytes: results[2].status === "fulfilled" ? (results[2].value ?? 0) : 0,
  };
}

export async function getAllSessions(
  onProgress?: (loaded: number, total: number) => void
): Promise<EnrichedSession[]> {
  // Phase 1: collect all raw session data across all project dirs
  interface RawSession {
    entry: SessionEntry;
    jsonlPath: string;
    projectDirName: string;
    computedInputTokens?: number;
    computedOutputTokens?: number;
  }

  const rawSessions: RawSession[] = [];

  let projectDirs: string[];
  const pDir = projectsDir();
  try {
    projectDirs = await readdir(pDir);
  } catch (err) {
    logWarn(`could not read projects dir ${pDir}: ${String(err)}`);
    return [];
  }

  for (const dirName of projectDirs) {
    const dirPath = join(pDir, dirName);
    const indexPath = join(dirPath, "sessions-index.json");
    const index = await readJson<{
      version: number;
      entries: SessionEntry[];
      originalPath: string;
    }>(indexPath);

    // Track which session IDs we've seen from the index
    const indexedIds = new Set<string>();

    if (index?.entries) {
      for (const entry of index.entries) {
        indexedIds.add(entry.sessionId);
        rawSessions.push({
          entry,
          jsonlPath: entry.fullPath,
          projectDirName: dirName,
        });
      }
    }

    // Discover unindexed JSONL files
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch (err) {
      logWarn(`skipped directory ${dirPath}: ${String(err)}`);
      continue;
    }

    const jsonlFiles = files.filter(
      (f) => f.endsWith(".jsonl") && !indexedIds.has(f.replace(".jsonl", ""))
    );

    // Parse unindexed JSONL files in parallel within this project dir
    const parsedResults = await Promise.allSettled(
      jsonlFiles.map((file) => parseJsonlSession(join(dirPath, file), dirName))
    );

    for (const result of parsedResults) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { entry, inputTokens, outputTokens } = result.value;
      rawSessions.push({
        entry,
        jsonlPath: entry.fullPath,
        projectDirName: dirName,
        computedInputTokens: inputTokens || undefined,
        computedOutputTokens: outputTokens || undefined,
      });
    }
  }

  // Phase 2: enrich all sessions in parallel
  const total = rawSessions.length;
  let loaded = 0;

  const enrichedResults = await Promise.allSettled<EnrichedSession>(
    rawSessions.map(async (raw): Promise<EnrichedSession> => {
      const enriched = await enrichEntry(raw.entry.sessionId, raw.jsonlPath);
      loaded++;
      onProgress?.(loaded, total);

      // Enrich first prompt from meta if JSONL had none
      if (enriched.meta?.first_prompt && raw.entry.firstPrompt === "No prompt") {
        raw.entry.firstPrompt = enriched.meta.first_prompt;
      }

      // Compute duration from timestamps as fallback
      const computedDurationMinutes = Math.round(
        (new Date(raw.entry.modified).getTime() - new Date(raw.entry.created).getTime()) / 60000
      );

      return {
        entry: raw.entry,
        meta: enriched.meta,
        facets: enriched.facets,
        totalSizeBytes: enriched.totalSizeBytes,
        projectDirName: raw.projectDirName,
        computedDurationMinutes,
        computedInputTokens: raw.computedInputTokens,
        computedOutputTokens: raw.computedOutputTokens,
      };
    })
  );

  const out: EnrichedSession[] = [];
  for (const r of enrichedResults) {
    if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}

export function getSessionLabel(session: EnrichedSession): string {
  // Try each source, skipping system noise
  for (const src of [
    session.entry.customTitle,
    session.entry.summary,
    session.facets?.brief_summary,
    session.meta?.first_prompt,
    session.entry.firstPrompt,
  ]) {
    if (src && isRealPrompt(src)) return cleanPrompt(src);
  }
  return session.entry.sessionId.slice(0, 8);
}

export function searchSessions(
  sessions: EnrichedSession[],
  query: string
): EnrichedSession[] {
  const terms = query.toLowerCase().split(/\s+/);

  const scored = sessions.map((s) => {
    const searchable = [
      s.entry.customTitle ?? "",
      s.entry.summary ?? "",
      s.entry.firstPrompt ?? "",
      s.facets?.brief_summary ?? "",
      s.facets?.underlying_goal ?? "",
      s.facets?.session_type ?? "",
      s.entry.projectPath ?? "",
      s.entry.gitBranch ?? "",
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (searchable.includes(term)) {
        score += 1;
        // Bonus for exact word match
        if (searchable.includes(` ${term} `) || searchable.startsWith(`${term} `)) {
          score += SEARCH_WORD_BOUNDARY_BONUS;
        }
      }
    }

    return { session: s, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.session);
}

export async function deleteSession(session: EnrichedSession): Promise<void> {
  const id = session.entry.sessionId;

  // Delete all associated files
  const deletions: Array<Promise<void>> = [
    rm(session.entry.fullPath, { force: true }),
    rm(join(debugDir(), `${id}.txt`), { force: true }),
    rm(join(fileHistoryDir(), id), { recursive: true, force: true }),
    rm(join(tasksDir(), id), { recursive: true, force: true }),
    rm(join(sessionEnvDir(), id), { recursive: true, force: true }),
    rm(join(sessionMetaDir(), `${id}.json`), { force: true }),
    rm(join(facetsDir(), `${id}.json`), { force: true }),
  ];

  // Delete matching todo files using exact pattern
  try {
    const todoFiles = await readdir(todosDir());
    for (const f of todoFiles) {
      if (f === id || f.startsWith(id + "-") || f.startsWith(id + ".")) {
        deletions.push(rm(join(todosDir(), f), { force: true }));
      }
    }
  } catch (err) {
    logDebug(`could not read todos dir: ${String(err)}`);
  }

  // Use allSettled so partial failures don't abort other deletions
  const results = await Promise.allSettled(deletions);
  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) {
    const reason = f.status === "rejected" ? String(f.reason) : "";
    process.stderr.write(`[warn] deletion failed for session ${id}: ${reason}\n`);
  }

  if (failures.length > 0) {
    process.stderr.write(
      `[warn] session ${id}: ${failures.length} file(s) could not be deleted; skipping index update\n`
    );
    return;
  }

  // Remove from sessions-index.json using atomic write
  const indexPath = join(
    projectsDir(),
    session.projectDirName,
    "sessions-index.json"
  );
  const index = await readJson<{
    version: number;
    entries: SessionEntry[];
    originalPath: string;
  }>(indexPath);

  if (index) {
    index.entries = index.entries.filter(
      (e) => e.sessionId !== session.entry.sessionId
    );
    const tmpPath = indexPath + ".tmp";
    try {
      await writeFile(tmpPath, JSON.stringify(index, null, 2));
      await rename(tmpPath, indexPath);
    } catch (err) {
      process.stderr.write(`[error] failed to update session index for ${id}: ${String(err)}\n`);
      // Try to clean up tmp file
      try { await rm(tmpPath, { force: true }); } catch { /* ignore */ }
    }
  }
}
