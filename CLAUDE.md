# Claude Session Manager (csm)

CLI tool for browsing, searching, and cleaning up local Claude Code sessions.

## Tech Stack

- **Runtime:** Bun (use `bun` for running, testing, installing)
- **Language:** TypeScript (strict mode)
- **Dependency:** `@inquirer/prompts` for interactive checkbox/confirm in `clean` command
- **No build step** - runs directly via `bun run src/index.ts`

## Project Structure

```
src/
  index.ts      - CLI entry point, arg parsing, command routing (list/find/info/clean/interactive/help)
  sessions.ts   - Session discovery, JSONL parsing, metadata enrichment, size calculation, deletion
  ui.ts         - ANSI colors, table formatting, date/size/truncation helpers
```

## How It Works

Claude Code stores sessions under `~/.claude/projects/<encoded-path>/`. This tool reads:

- `sessions-index.json` - indexed sessions with summary, message count, timestamps
- `*.jsonl` files - raw session conversations (also discovers unindexed sessions)
- `~/.claude/usage-data/session-meta/<id>.json` - duration, tokens, tools, lines changed
- `~/.claude/usage-data/facets/<id>.json` - goal summary, outcome, session type

Deletion removes: JSONL, debug logs, file-history, tasks, todos, session-env, and updates the index.

## Running

```sh
bun run src/index.ts              # list sessions (default)
bun run src/index.ts list --sort size
bun run src/index.ts find "query"
bun run src/index.ts info <session-id>
bun run src/index.ts clean --older-than 30
bun run src/index.ts clean --dry-run
bun run src/index.ts browse            # interactive session browser
bun run src/index.ts browse -p myproj  # browse filtered by project
```

## Column Reference

All table columns (normal, verbose-table, verbose-card) are documented in [`docs/columns.md`](docs/columns.md).

## Troubleshooting

**"undefined is not an object" crash when listing sessions:**
Claude Code's `sessions-index.json` files can contain incomplete entries (missing `projectPath`, `messageCount`, `created`, etc.). This happens when Claude Code writes a session to the index before fully populating it. The fix is in `sessions.ts` — the index-loading loop backfills missing fields with sensible defaults. If a new required field is added to `SessionEntry`, also add a fallback in the index-loading section of `getAllSessions()`.

To find the broken session: `bun -e 'import {getAllSessions} from "./src/sessions.ts"; const s = await getAllSessions(); for (const x of s) { if (!x.entry.projectPath) console.log("BROKEN:", x.entry.sessionId, x.entry.fullPath) }' 2>/dev/null`

## Conventions

- Use `node:fs/promises` and `node:path` for file operations (session discovery needs recursive dir reads)
- ANSI colors via raw escape codes in `src/ui.ts` (no chalk dependency)
- Session labels are cleaned of XML tags and system caveats before display
- Partial session ID matching is supported in `info` command
