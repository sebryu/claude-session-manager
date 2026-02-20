import { readdir, stat, rm, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const DEBUG_DIR = join(CLAUDE_DIR, "debug");
const FILE_HISTORY_DIR = join(CLAUDE_DIR, "file-history");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");
const TODOS_DIR = join(CLAUDE_DIR, "todos");
const SESSION_ENV_DIR = join(CLAUDE_DIR, "session-env");
const SESSION_META_DIR = join(CLAUDE_DIR, "usage-data", "session-meta");
const FACETS_DIR = join(CLAUDE_DIR, "usage-data", "facets");

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
}

export interface SessionFacets {
  underlying_goal?: string;
  outcome?: string;
  session_type?: string;
  brief_summary?: string;
  claude_helpfulness?: string;
}

export interface EnrichedSession {
  entry: SessionEntry;
  meta?: SessionMeta;
  facets?: SessionFacets;
  totalSizeBytes: number;
  projectDirName: string;
}

async function fileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

async function dirSize(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = join(path, entry.name);
      if (entry.isFile()) {
        total += (await stat(fullPath)).size;
      } else if (entry.isDirectory()) {
        total += await dirSize(fullPath);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/** Strip XML-like tags and system caveats from prompts */
function cleanPrompt(text: string): string {
  let cleaned = text.replace(/<[^>]+>/g, "").trim();
  // Remove "Caveat: ..." prefix from resumed sessions
  cleaned = cleaned.replace(/^Caveat:.*?(?:\.\s*)/s, "").trim();
  // Skip internal system messages that leaked into prompts
  if (cleaned.startsWith("DO NOT respond to these messages")) return "";
  if (cleaned.startsWith("[Request interrupted")) return "";
  return cleaned || text.trim();
}

/** Check if a prompt is meaningful (not empty or system noise) */
function isRealPrompt(text: string): boolean {
  const cleaned = cleanPrompt(text);
  return cleaned.length > 0 && cleaned !== "No prompt";
}

export async function calculateSessionSize(
  sessionId: string,
  jsonlPath: string
): Promise<number> {
  const sizes = await Promise.all([
    fileSize(jsonlPath),
    fileSize(join(DEBUG_DIR, `${sessionId}.txt`)),
    dirSize(join(FILE_HISTORY_DIR, sessionId)),
    dirSize(join(TASKS_DIR, sessionId)),
    fileSize(join(SESSION_META_DIR, `${sessionId}.json`)),
    fileSize(join(FACETS_DIR, `${sessionId}.json`)),
  ]);
  return sizes.reduce((a, b) => a + b, 0);
}

/** Extract basic session info from a JSONL file (for sessions without an index) */
async function parseJsonlSession(
  filePath: string,
  dirName: string
): Promise<SessionEntry | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) return undefined;

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    const sessionId = basename(filePath, ".jsonl");

    // Decode project path from dir name: "-Users-foo-bar" -> "/Users/foo/bar"
    const projectPath =
      (first.cwd as string) ||
      "/" + dirName.replace(/^-/, "").replace(/-/g, "/");

    // Find first user message for the prompt
    let firstPrompt = "No prompt";
    let messageCount = 0;
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = obj.type as string | undefined;
      const role = obj.role as string | undefined;
      if (type === "user" || role === "user") {
        messageCount++;
        if (firstPrompt === "No prompt") {
          const content = obj.content ?? (obj.message as Record<string, unknown>)?.content;
          if (typeof content === "string") {
            firstPrompt = content.slice(0, 200);
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (
                typeof part === "object" &&
                part !== null &&
                (part as Record<string, unknown>).type === "text"
              ) {
                firstPrompt = ((part as Record<string, unknown>).text as string).slice(0, 200);
                break;
              }
            }
          }
        }
      }
    }

    const created =
      (first.timestamp as string) || new Date().toISOString();
    const modified =
      (last.timestamp as string) || created;

    const fileStat = await stat(filePath);

    return {
      sessionId,
      fullPath: filePath,
      fileMtime: fileStat.mtimeMs,
      firstPrompt,
      messageCount,
      created,
      modified,
      gitBranch: first.gitBranch as string | undefined,
      projectPath,
      isSidechain: false,
    };
  } catch {
    return undefined;
  }
}

export async function getAllSessions(): Promise<EnrichedSession[]> {
  const sessions: EnrichedSession[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(PROJECTS_DIR);
  } catch {
    return sessions;
  }

  for (const dirName of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dirName);
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
        const [meta, facets, totalSizeBytes] = await Promise.all([
          readJson<SessionMeta>(
            join(SESSION_META_DIR, `${entry.sessionId}.json`)
          ),
          readJson<SessionFacets>(
            join(FACETS_DIR, `${entry.sessionId}.json`)
          ),
          calculateSessionSize(entry.sessionId, entry.fullPath),
        ]);

        sessions.push({
          entry,
          meta,
          facets,
          totalSizeBytes,
          projectDirName: dirName,
        });
      }
    }

    // Discover unindexed JSONL files
    try {
      const files = await readdir(dirPath);
      const jsonlFiles = files.filter(
        (f) => f.endsWith(".jsonl") && !indexedIds.has(f.replace(".jsonl", ""))
      );

      for (const file of jsonlFiles) {
        const filePath = join(dirPath, file);
        const entry = await parseJsonlSession(filePath, dirName);
        if (!entry) continue;

        const [meta, facets, totalSizeBytes] = await Promise.all([
          readJson<SessionMeta>(
            join(SESSION_META_DIR, `${entry.sessionId}.json`)
          ),
          readJson<SessionFacets>(
            join(FACETS_DIR, `${entry.sessionId}.json`)
          ),
          calculateSessionSize(entry.sessionId, filePath),
        ]);

        // Enrich with meta summary if available
        if (meta?.first_prompt && entry.firstPrompt === "No prompt") {
          entry.firstPrompt = meta.first_prompt;
        }

        sessions.push({
          entry,
          meta,
          facets,
          totalSizeBytes,
          projectDirName: dirName,
        });
      }
    } catch {
      // directory read failed, skip
    }
  }

  return sessions;
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
      s.entry.customTitle || "",
      s.entry.summary || "",
      s.entry.firstPrompt || "",
      s.facets?.brief_summary || "",
      s.facets?.underlying_goal || "",
      s.facets?.session_type || "",
      s.entry.projectPath || "",
      s.entry.gitBranch || "",
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (searchable.includes(term)) {
        score += 1;
        // Bonus for exact word match
        if (searchable.includes(` ${term} `) || searchable.startsWith(`${term} `)) {
          score += 0.5;
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
  const deletions = [
    rm(session.entry.fullPath, { force: true }),
    rm(join(DEBUG_DIR, `${id}.txt`), { force: true }),
    rm(join(FILE_HISTORY_DIR, id), { recursive: true, force: true }),
    rm(join(TASKS_DIR, id), { recursive: true, force: true }),
    rm(join(SESSION_ENV_DIR, id), { recursive: true, force: true }),
    rm(join(SESSION_META_DIR, `${id}.json`), { force: true }),
    rm(join(FACETS_DIR, `${id}.json`), { force: true }),
  ];

  // Delete matching todo files
  try {
    const todoFiles = await readdir(TODOS_DIR);
    for (const f of todoFiles) {
      if (f.includes(id)) {
        deletions.push(rm(join(TODOS_DIR, f), { force: true }));
      }
    }
  } catch {
    // todos dir may not exist
  }

  await Promise.all(deletions);

  // Remove from sessions-index.json
  const indexPath = join(
    PROJECTS_DIR,
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
    await writeFile(indexPath, JSON.stringify(index, null, 2));
  }
}
