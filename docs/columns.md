# CSM Table Columns

All columns displayed by `csm list` across the three display modes.

---

## Normal table — `csm l`

| Header   | Align | Width    | Source                               | Notes |
|----------|-------|----------|--------------------------------------|-------|
| ID       | left  | 36 fixed | `entry.sessionId`                    | Full UUID |
| Name     | left  | flex     | `entry.customTitle`                  | User-assigned title (e.g. worktree name); `-` if not set |
| Project  | left  | flex     | `entry.projectPath`                  | Base project directory (last path segment); worktree suffix stripped |
| Worktree | left  | flex     | `entry.projectPath`                  | Worktree name when session ran inside `/.claude/worktrees/<name>`; `-` otherwise |
| Session  | left  | flex     | label priority chain                 | First non-empty of: customTitle → summary → facets.brief_summary → meta.first_prompt → entry.firstPrompt → short ID |
| Branch   | left  | flex     | `entry.gitBranch`                    | Git branch active during the session |
| Date     | left  | 11 fixed | `entry.modified`                     | Relative time of last modification (e.g. `today 14:02`, `yest 09:30`, `3d ago`) |
| Dur      | right | 5 fixed  | `meta.duration_minutes`              | Session wall-clock duration: `m`=minutes, `h`=hours, `d`=days |
| Msgs     | right | 5 fixed  | `entry.messageCount`                 | Number of user messages sent |
| Tokens   | right | 7 fixed  | `meta.input_tokens + output_tokens`  | Total tokens (K=thousands, M=millions); falls back to JSONL-computed sum when meta is unavailable |
| Size     | right | 7 fixed  | sum of all session files             | Disk space: JSONL + debug log + file-history + tasks + session-meta + facets |

Flex columns expand/shrink proportionally with terminal width (min widths enforced).

---

## Verbose table — `csm l -vt`

All normal-table columns (with abbreviated headers and ID shortened to 8 chars), plus:

| Header | Align | Width    | Source                              | Notes |
|--------|-------|----------|-------------------------------------|-------|
| Files  | right | 5 fixed  | `meta.files_modified`               | Number of files modified |
| Lines  | right | 10 fixed | `meta.lines_added / lines_removed`  | e.g. `+716/-29`; values ≥ 1000 shown as `1k` |
| Cmts   | right | 4 fixed  | `meta.git_commits`                  | Git commits made during the session |
| Err    | right | 3 fixed  | `meta.tool_errors`                  | Tool errors encountered |
| Int    | right | 3 fixed  | `meta.user_interruptions`           | Times the user pressed Esc to interrupt Claude |
| Lang   | left  | 5 fixed  | top key of `meta.languages`         | Primary language detected (first 5 chars, e.g. `TypeS`, `JSON`) |
| Feat   | left  | 3 fixed  | `meta.uses_task_agent/mcp/web_*`    | Feature flags: `T`=Task Agent, `M`=MCP, `W`=Web search or fetch; `-` = unused |
| Type   | left  | 5 fixed  | `facets.session_type`               | AI-labelled session type: `code`, `debug`/`iter`, `plan`, `rev`, `docs`, `rsrch`, `cfg`, `trbl` |
| Out    | left  | 4 fixed  | `facets.outcome`                    | Goal outcome: `full`=fully achieved, `part`=partial, `no`=not achieved |
| Help   | left  | 5 fixed  | `facets.claude_helpfulness`         | Helpfulness rating: `v.hi`=very helpful, `hi`=helpful, `mid`=somewhat, `low`=not helpful |

All flex columns (Name, Project, WT, Session, Branch) adapt to terminal width.
Meta/facets columns show `-` for sessions not yet processed (typically very recent sessions).

---

## Verbose card mode — `csm l -v`

Not a table. Renders each session as a multi-line card with every available field:
ID, name, label, branch, created/modified/duration, messages, size, tokens, files modified,
lines +/-, git commits/pushes, interruptions, tool errors, tool breakdown, languages,
feature flags, session type, outcome, helpfulness, brief summary, goal, friction detail,
first prompt.
