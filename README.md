# Claude Session Manager (csm)

A CLI tool for browsing, searching, and cleaning up local [Claude Code](https://claude.ai/claude-code) sessions stored under `~/.claude/projects/`.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.0

## Installation

```sh
git clone https://github.com/sebryu/claude-session-manager
cd claude-session-manager
bun install
bun run setup   # registers 'csm' globally via bun link
```

After setup, `csm` is available as a global command.

## Commands

### `csm list` / `csm l` (default)

List all Claude sessions.

```sh
csm                              # Minimal view: ID, project, label, date, messages
csm -v                           # Standard table with stats
csm -vv                          # Wide table with all columns + legend
csm -vvv                         # Card-style detail view

csm -s size -n 20                # Top 20 by size
csm -s tokens                    # Sort by token usage
csm -s messages                  # Sort by message count
csm -s commits                   # Sort by git commits
csm -r                           # Reverse sort order

csm -p myapp                     # Filter by project name
csm --after "2024-01-01"         # Sessions after date
csm --before "2025-01-01"        # Sessions before date
csm --min-size 50MB              # Sessions larger than 50MB
csm --min-tokens 10000           # Sessions with 10k+ tokens
csm --outcome fully              # Filter by outcome

csm --json                       # JSON array output
csm --ids-only                   # One session ID per line (for piping)
csm --exit-2-on-empty            # Exit 2 if no results (for scripting)
```

### `csm find` / `csm f`

Search sessions by description, summary, goals, and branch names.

```sh
csm find "expo upgrade"
csm f "authentication bug" -v
csm f "react native" --json
csm f tmux +statusbar              # AND-search: both terms must appear
csm f statusbar --in title         # restrict to a single field
csm f statusbar --in transcript    # alias for --content (see csm grep)
csm f tmux --score                 # show match score per result
csm f tmux --stream                # NDJSON, one session per line
csm f tmux --field id              # project a single field per line
```

Supported `--in` fields: `description` (default), `title`, `summary`,
`first-prompt`, `branch`, `project`, `goal`, `type`, `transcript`.

### `csm grep` / `csm g`

Search **inside transcripts** (JSONL files) for a query string. Slower than
`csm find` because it streams every transcript, but it sees content the
metadata never captures.

```sh
csm grep resurrect                 # find sessions whose transcripts mention "resurrect"
csm grep "TODO:" -p ai-work        # scoped to a project
csm grep error --json              # transcript matches as JSON, with snippets
csm grep tmux --ids-only           # just IDs for piping
```

Each result lists up to three matching lines per session with a ±60-character
snippet around the hit, the source role (user / assistant / tool_use /
tool_result), and the JSONL line number.

### `csm resume`

Switch directory to the session's recorded `cwd` (handling worktrees) and
exec `claude --resume <id>`.

```sh
csm resume dfde9d19
csm resume dfde9d19 -- --fork-session   # forward extra flags after `--`
```

### `csm open`

Open one or more sessions, each in its own tmux window. With a single id and
no `--tmux`, behaves like `csm resume`.

```sh
csm open dfde9d19 4a2bc3a1            # opens both in a fresh tmux session
csm open dfde9d19 --tmux review       # picks the tmux session name
```

Inside an existing tmux client, `csm open` issues `switch-client`. Outside
tmux, it `attach-session`s. Refuses to clobber an existing session of the
same name.

### `csm projects`

List logical projects with the encoded source dirs that feed each one. Useful
when `csm list -p X` returns more sessions than `ls ~/.claude/projects/...`
because csm aggregates worktrees and sibling encoded dirs.

```sh
csm projects
csm projects --json
csm list -p myapp --show-source        # shows the mapping inline after the table
```

### `csm info` / `csm i`

Show detailed information about a session (requires ≥ 8 chars of the session ID).

```sh
csm info dfde9d19
csm i dfde9d19abcd1234 --json
```

### `csm clean` / `csm c`

Interactively select sessions to delete.

```sh
csm clean                        # Interactive checkbox UI
csm clean --older-than 30        # Pre-select sessions older than 30 days
csm clean --dry-run              # Preview without deleting
```

### `csm browse` / `csm interactive`

Full-screen session browser — resume, inspect, or delete sessions interactively.

```sh
csm browse
csm browse -p myproject
csm browse -s size
```

### `csm export`

Export a session's JSONL and metadata to a directory.

```sh
csm export dfde9d19 ./backups/
```

### `csm backup`

Bulk export sessions older than N days before cleaning.

```sh
csm backup --older-than 60 ./archive/
```

### `csm stats`

Aggregate statistics across all sessions.

```sh
csm stats                        # Overall totals
csm stats --by project           # Breakdown by project
csm stats --by language          # Breakdown by primary language
csm stats --by outcome           # Breakdown by session outcome
```

### `csm summary`

Recent-activity digest grouped by project. Useful for "what did I work on this
week" reviews.

```sh
csm summary --since 7d           # Last 7 days
csm summary --since 24h          # Last 24 hours
csm summary --since 90m          # Last 90 minutes
csm summary --last 20            # Most recent 20 sessions
csm summary --since 7d -p myapp  # Scoped to a project
csm summary --since 7d --json    # Machine-readable output
```

`--since` accepts `Nm` / `Nh` / `Nd` / `Nw` durations or any ISO date string.

### `csm columns`

Print a reference of all table column abbreviations.

```sh
csm columns
```

## Sort Keys

| Key | Description |
|---|---|
| `date` | Last modified (default) |
| `size` | Total size on disk |
| `tokens` | Token count |
| `duration` | Session duration |
| `messages` | Message count |
| `files-changed` | Files modified |
| `commits` | Git commits |

## Global Flags

| Flag | Description |
|---|---|
| `--debug` | Verbose stderr logging |
| `--color always\|auto\|never` | Color mode (default: auto) |
| `NO_COLOR=1` | Disable color (env var) |

## Config File

Create `~/.csm.config.json` to set defaults:

```json
{ "sort": "size", "limit": 30, "project": "myapp" }
```

Or use environment variables: `CSM_SORT`, `CSM_PROJECT`, `CSM_LIMIT`.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (invalid args, I/O failure) |
| `2` | No sessions matched (with `--exit-2-on-empty`) |

## Data Sources

Sessions are read from `~/.claude/projects/<encoded-path>/`:
- `sessions-index.json` — indexed sessions with summaries
- `*.jsonl` — raw conversation files (also finds unindexed sessions)
- `~/.claude/usage-data/session-meta/<id>.json` — tokens, duration, tools
- `~/.claude/usage-data/facets/<id>.json` — goal, outcome, session type

Override the Claude home directory: `CLAUDE_DIR=/custom/path csm list`

## Development

```sh
bun run dev          # Run directly
bun test             # Run test suite
bun run typecheck    # TypeScript type check
```

## Column Reference

See [`docs/columns.md`](docs/columns.md) for full documentation of all table columns.

Use `csm columns` to see the reference in your terminal.

## Using csm from Claude Code / agents

`csm` is designed to be safe to call from automated tooling: it detects when
stderr is not a TTY and suppresses the loading spinner, and `--json` /
`--stream` / `--ids-only` / `--field` modes also imply quiet stderr.

Canonical recipes:

```sh
# Latest sessions in a project as JSON, ready for jq
csm list -p <project> --json | jq '.[].entry.sessionId'

# Newline-delimited JSON (large corpora — process incrementally)
csm list -p <project> --stream | jq -c '.entry.sessionId'

# Just IDs for xargs / shell pipelines
csm list -p <project> --ids-only

# Project a single column without jq
csm list -p <project> --field description
csm list --field id --limit 10

# Metadata-only search (fast)
csm find <query> -p <project> --json | jq '.[0].entry.sessionId'

# Transcript-content search — finds sessions even when the term isn't
# in the title/summary metadata
csm grep <query> -p <project> --json | jq '.[0].entry.sessionId'

# Resolve an exact session and inspect it
csm info <id> --json
```

Useful flags for agent use:

- `--exit-2-on-empty` — exit code 2 means "no match" so scripts can branch
  cleanly without parsing output.
- `+term` inside a query — that term must appear (AND-search).
- `--in <field>` — restrict scoring to one field; useful when a query word
  has many incidental matches.
- `--score` — surface the rank score so an agent can detect ties / weak
  matches and re-query.
