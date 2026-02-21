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
