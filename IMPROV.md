# CSM Improvement Proposals

Findings from a three-agent codebase scan (architecture, UX/CLI, reliability/testing).
Issues are grouped by theme and ordered by severity within each section.

---

## 1. Critical Bugs

### 1.1 Broken test import
`src/ui.test.ts:12` imports `computeListColWidths` but `src/ui.ts` exports `computeColWidths`.
All tests fail on load. The two functions also have different signatures (1 arg vs 3 args), so
test invocations must be updated alongside the import.

### 1.2 Silent partial deletion
`deleteSession()` (`src/sessions.ts:463`) uses `Promise.all()`. If any individual file removal
fails (e.g. permission denied) the error is swallowed via `{ force: true }` and the index is
still updated — leaving orphaned files with no record of them. Replace with `Promise.allSettled()`,
collect failures, report them to stderr, and only remove index entries for sessions whose files
were fully deleted.

### 1.3 Index write has no error handling
After deletions succeed, `writeFile(...)` on the index (`src/sessions.ts:481`) has no catch.
A failed write leaves the index inconsistent with disk state. Write to a temp file and rename
atomically, and catch/report any write errors.

---

## 2. Error Handling

Most catch blocks are silent, making the tool impossible to debug in the field.

| Location | Current behavior | Better behavior |
|---|---|---|
| `readJson()` (line 116) | Returns `undefined` for any error | Distinguish ENOENT from parse errors; log parse errors to stderr |
| `parseJsonlSession()` (line 274) | Returns `undefined` if any line fails | Skip bad lines, log line number to stderr, continue |
| `getAllSessions()` (lines 285, 375) | Returns empty / skips directory silently | Warn on stderr that a directory was skipped and why |
| `fileSize()` / `dirSize()` (lines 89, 107) | Return 0 on any error | Log the path that failed |
| `deleteSession()` todos block (line 459) | Silently ignores errors | Report failures |

A `--debug` flag that enables verbose stderr logging would surface all these failures without
cluttering normal output.

---

## 3. Reliability & Data Safety

### 3.1 Promise.all in enrichment loop
`getAllSessions()` wraps three I/O ops per session in `Promise.all()` inside a `for` loop
(`src/sessions.ts:304-312`, `344-352`). Move all reads outside the loop so a single
`Promise.allSettled()` handles all meta/facets/sizes in parallel and failures are per-item.

### 3.2 Todos deletion uses substring match
`src/sessions.ts:455-457` uses `f.includes(id)` to find todo files. A session ID that is a
substring of another ID could delete the wrong files. Use an exact pattern:
`f === id || f.startsWith(id + "-")`.

### 3.3 Symlink loops in dirSize
`dirSize()` (`src/sessions.ts:94-110`) does recursive readdir without tracking visited inodes.
A symlink cycle would cause an infinite loop. Pass `{ followSymlinks: false }` or track inodes.

### 3.4 Large JSONL files loaded into memory
`parseJsonlSession()` (`src/sessions.ts:172`) reads entire files with `readFile()`. Multi-GB
JSONL files will exhaust memory. Use a line-by-line streaming reader.

### 3.5 Unreliable birthtime fallback
When no timestamps exist in a JSONL, the code falls back to `birthtimeMs`
(`src/sessions.ts:254-255`). `birthtime` is unreliable on ext4, NTFS, and many other
filesystems (often equals mtime). Warn the user when this fallback is used.

---

## 4. Testing

### 4.1 No tests for sessions.ts
The most dangerous and complex module has zero coverage. Minimum test targets:
- `parseJsonlSession()`: empty file, single corrupted line, missing token fields
- `deleteSession()`: file missing, permission error, index write failure
- `searchSessions()`: scoring, partial matches, empty query
- `getAllSessions()`: indexed + unindexed sessions, missing dirs

### 4.2 No integration tests
Create `test/fixtures/claude-home/` with sample `sessions-index.json` and JSONL files.
Set `CLAUDE_DIR` (see §6.1) to this fixture directory and run full command flows.

### 4.3 Missing package.json scripts
```json
"scripts": {
  "test":      "bun test",
  "typecheck": "tsc --noEmit",
  "lint":      "...",
  "dev":       "bun run src/index.ts"
}
```

---

## 5. TypeScript & Code Quality

### 5.1 Non-null assertions hiding potential bugs
15+ uses of `!` (`src/ui.ts:21`, `src/index.ts:213`, etc.) bypass the type checker.
Prefer `?? fallback` or explicit bounds checks.

### 5.2 Unvalidated command arguments
- `--limit abc` parses as `NaN` silently (`src/index.ts:133`).
- `--sort badkey` falls back to date with no warning.
- `--older-than abc` produces `NaN` in the date filter.

Validate each flag immediately after parsing and print a clear error before exiting.

### 5.3 Partial session ID match with no ambiguity check
`cmdInfo` accepts any prefix via `.startsWith()` (`src/index.ts:487`). If two sessions share
the same prefix, the first one wins silently. Enforce a minimum length (8 chars) and warn
when multiple sessions match.

### 5.4 Duplicated enrichment logic
Indexed and unindexed session branches (`src/sessions.ts:301-327`, `337-374`) apply nearly
identical meta + facets + size enrichment. Extract to a shared `enrichEntry()` helper.

### 5.5 Disabled strict rules in tsconfig
`noUnusedLocals`, `noUnusedParameters`, and `noPropertyAccessFromIndexSignature` are all
`false` despite `"strict": true`. Enable them to catch dead code and unsafe index access.

### 5.6 Magic numbers
Several values should be named constants:
- `231` (firstPrompt slice length in `src/sessions.ts`)
- `120` (fallback terminal width in `src/index.ts:207`)
- `0.5` (search score bonus in `src/sessions.ts:420`)

---

## 6. Configuration & Portability

### 6.1 All paths hardcoded
`src/sessions.ts:5-13` defines nine directory constants derived from `homedir()`. There is
no way to override them, which makes testing require real `~/.claude` data. Support an
environment variable override:

```ts
const CLAUDE_DIR = process.env.CLAUDE_DIR ?? join(homedir(), ".claude");
```

This also enables testing against fixture directories and supports non-standard setups.

### 6.2 No config file
Users who always want the same sort order or project filter must type flags every time.
Support `~/.csm.config.json` with defaults:

```json
{ "sort": "size", "limit": 30, "project": "myapp" }
```

Also respect env vars: `CSM_SORT=size`, `CSM_PROJECT=myapp`.

---

## 7. UX & Output

### 7.1 No machine-readable output
The tool cannot be used in scripts without fragile ANSI-table parsing. Add:
- `--json`: output a JSON array of session objects
- `--ids-only`: one session ID per line (for piping to xargs, etc.)

`csm info <id> --json` should also output a single JSON object.

### 7.2 No documented exit codes
Scripts cannot branch on the tool's outcome. Define and document:
- `0`: success
- `1`: error (invalid args, I/O failure, etc.)
- `2`: no sessions matched (optional, via `--exit-2-on-empty`)

### 7.3 NO_COLOR and accessibility
- Respect the `NO_COLOR` environment variable (standard).
- Add `--color=always|auto|never`.
- Use text attributes (bold, dim) alongside color so colorblind users can read output.
- Use plain ASCII separators (`-`, `=`) when color is disabled instead of box-drawing characters.

### 7.4 Verbosity flag confusion
`-vt`/`--verbose-table` sets level 2 but so does `-vv`, yet they're described as the same
thing. The `-vt` alias adds confusion rather than clarity. Consider removing it and sticking
to the `--verbose` / `-v` / `-vv` / `-vvv` progression.

### 7.5 No date / size / token filters on list
Currently only `--project` and `--limit` filter the list. Natural additions:
- `--after "2 weeks ago"` / `--before <date>`
- `--min-size 50MB` / `--max-size 500MB`
- `--min-tokens 5000`
- `--outcome fully|partial|unclear`

### 7.6 Interactive clean lacks search/filter
The checkbox list in `clean` can become hundreds of items long with no way to search.
Use `@inquirer/search` (already a dep) or add a pre-filter step before entering the
checkbox UI. Also show total metrics of selected sessions before the confirm prompt.

### 7.7 Missing column legend
`-vv` mode adds many abbreviated columns (`WT`, `Cmts`, `Int`, etc.) that aren't
self-evident. Print a one-line legend below the table, or add a `csm columns` command
that explains each column.

### 7.8 Progress indication for slow operations
Long session discovery shows a static spinner with no count. Show
`Loading sessions... 234/1500` so users know the tool is not hung.

---

## 8. Missing Features

### 8.1 Export / backup
There is no way to back up sessions before deleting them. Add:
- `csm export <id> [path]` — copy JSONL + metadata to a directory
- `csm backup --older-than 60 ./archive/` — bulk export before clean

### 8.2 Stats / analytics command
`csm stats [--by project|language|outcome]` — aggregate summary across sessions
(total tokens, total time, session count, average size, etc.).

### 8.3 Reverse sort flag
All sort orders are descending. A `--reverse` / `-r` flag to flip the order would
help when looking for the smallest or oldest sessions.

### 8.4 Additional sort keys
The `--sort` switch is missing: `messages`, `files-changed`, `commits`.
All three fields are already present in the enriched session object.

---

## 9. Distribution & Documentation

### 9.1 No README.md
There is no top-level README. GitHub visitors (and anyone cloning the repo) have no
installation instructions, usage examples, or overview. The CLAUDE.md is developer-focused
but should not be the only documentation.

### 9.2 Unclear installation story
`package.json` is `"private": true` and the `setup` script requires `bun link` (manual,
Bun-specific). Document the intended install path explicitly, or add a published release
(npm, GitHub release binary, or Homebrew formula).

### 9.3 package.json metadata
`package.json` is missing: `description`, `version`, `author`, `license`, `repository`.
These fields matter for `bun link` discoverability and future publishing.

---

## Quick-win Summary

| # | Change | File | Effort |
|---|---|---|---|
| 1 | Fix broken test import | `src/ui.test.ts:12` | Minutes |
| 2 | Use `Promise.allSettled` in `deleteSession` | `src/sessions.ts:463` | ~1h |
| 3 | Atomic index write (tmp + rename) | `src/sessions.ts:481` | ~30m |
| 4 | `CLAUDE_DIR` env var override | `src/sessions.ts:5` | ~30m |
| 5 | Validate `--limit`, `--sort`, `--older-than` args | `src/index.ts` | ~1h |
| 6 | Respect `NO_COLOR` env var | `src/ui.ts` | ~1h |
| 7 | Add `--json` / `--ids-only` output flags | `src/index.ts`, `src/ui.ts` | ~2h |
| 8 | Log errors to stderr with `--debug` | Throughout | ~2h |
| 9 | Minimum prefix length / ambiguity check in `info` | `src/index.ts:487` | ~30m |
| 10 | Add `"test"` / `"typecheck"` npm scripts | `package.json` | Minutes |
