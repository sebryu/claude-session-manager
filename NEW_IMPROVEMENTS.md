# csm — Improvement Notes from a Claude A/B Comparison

These observations come from a side-by-side test where two Claude agents solved the same three tasks against the user's session corpus: one using only native tooling (find/grep/jq over `~/.claude/projects/*.jsonl`), the other using `csm`. csm was the clear winner for breadth and topic clustering, but a handful of rough edges showed up. Listed roughly in order of impact.

---

## Verdict: should Claude default to csm?

**Yes, for session archaeology** — listing, summarizing, finding, inspecting. The stored `description` metadata is the killer feature; nothing else lets an agent label hundreds of sessions without reading any transcripts. The targeted finds (`csm find <keyword>`) returned the right session in one call both times.

**No, for content-level forensics** — when the question is "did the user mention X *inside* a transcript", raw `grep -l` over the JSONLs is still faster than `csm find` (which searches metadata only — see `searchSessions()` at `src/sessions.ts:492-530`). Today csm is the default for discovery, grep is the fallback for content. Closing that gap (item #3 below) would make csm the default for both.

---

## High-impact polish

### 1. The loading spinner pollutes non-TTY output

`csm list -p ai-work` printed `Loading sessions... 1/462`, `... 2/462`, ... once per session — a 29 KB stream of spinner frames before the table appeared. In a non-interactive context (Claude shelling out, CI, piping to a file) this is just noise that has to be filtered with `2>/dev/null`.

- Detect TTY on stderr; skip the spinner when not a TTY.
- Or: use `\r` in-place updates that collapse to a single line in TTY and emit nothing on non-TTY.
- `--json` should imply quiet stderr by default.

This was the single biggest "Claude friction" moment — the agent only realized after one failed call that the noise was on stderr, not stdout.

### 2. Project-name aggregation is opaque

`csm list -p ai-work --json` reported **265** sessions; `ls ~/.claude/projects/-Users-sebryu-ai-work/*.jsonl` showed **92**. The two answers are 3× apart and both technically correct — csm is folding worktrees / sibling encoded dirs under one logical project, while the filesystem view is literal.

This means a user (or agent) can't reliably reconcile csm's counts against disk without knowing the aggregation rule. Suggested fixes:

- `csm projects` — list every known project name with the source dirs/encoded-dir prefixes that feed it. Make the mapping inspectable.
- `csm list -p ai-work --show-source` — add a column for the original encoded dir per row.
- Document the aggregation rule in `--help` (one line under `-p`).

### 3. Content search inside transcripts

**Currently the single biggest functional gap.** Confirmed by reading `searchSessions()` (`src/sessions.ts:492-530`): `csm find` only searches metadata — `customTitle`, `summary`, `firstPrompt`, facets, `projectPath`, `gitBranch`. If the keyword the user remembers isn't in any of those, `csm find` misses it.

Concrete example from the A/B test: searching ai-work for `resurrect` with `csm find resurrect -p ai-work` returns nothing, while `grep -l -i resurrect ~/.claude/projects/-Users-sebryu-ai-work/*.jsonl` finds 6 substantive sessions about `tmux-resurrect`. Same project, same word, totally different answer — only because csm doesn't look inside transcripts.

**Proposed surface:**
```
csm find <query> --content              # search inside transcripts (slower)
csm find <query> --in transcript        # equivalent
csm grep <query>                        # alias / shortcut form
csm grep <query> -p ai-work --json      # piping into other tools
```

**Implementation sketch (~half a day to one day for a polished v1):**

1. **Eager linear scan, no index.** Project corpus is hundreds of JSONL files; a single regex pass is bounded (seconds). Indexing is a separate multi-day project — defer until the corpus or query patterns demand it.
2. **JSON-aware extraction, not raw byte regex.** Stream each line, `JSON.parse`, walk `message.content[]` collecting `text`, `tool_use.input`, `tool_result.content`, then match. ~50 LoC of content-walker code. Avoids false positives on field names like `"role"` matching "role" queries. The byte-regex hack is faster to ship (~2-3h) but the snippet quality is much worse — go straight to the JSON-aware path.
3. **Reuse existing JSONL discovery** — `parseJsonlSession()` (`sessions.ts:204+`) already maps file → session.
4. **Output: snippet ±60 chars around each match**, sorted by (hit count desc, recency desc). Reuse `ui.ts` table formatting. Mirror `find`'s `--json` / `--ids-only` / `-vvv` / `--exit-2-on-empty` flags.
5. **Wiring:** new command branch in `src/index.ts`; help text; tests in `sessions.test.ts` (existing JSONL fixtures cover the parsing path).

### 4. No "do something with this session" verb

After `csm find` returns the right ID, the next move is invariably:
```
cd <project-dir> && claude --resume <id>
```
…with the right cwd. csm knows both. Two missing verbs would close the loop:

- `csm resume <id>` — `cd` to the session's recorded cwd and exec `claude --resume <id>`. (Honor `--fork-session` / `--name` passthrough.)
- `csm open <id> [<id> ...] [--tmux <session-name>]` — open one or more sessions, each in its own tmux window of a (new) named session. We literally just hand-rolled this one tmux command for two sessions; it's a natural csm primitive.

These would make csm the entry point for the *whole* session lifecycle, not just discovery.

---

## Medium-impact

### 5. AND-search and field-scoped queries

Currently `csm find "tmux statusbar"` is one fuzzy match. Useful additions:
- `csm find tmux +statusbar` — both terms must appear.
- `csm find statusbar --in description` / `--in first-prompt` / `--in transcript` (the last one folds into #3 above).

### 6. Output a one-screen summary digest

`csm summary --since 7d` (or `--last 20`) — auto-clustered titles grouped by theme. This is exactly what the A/B agents did manually for Job 1; csm has the data to do it natively.

### 7. Stable session ranking for repeat queries

`csm find` returned ranked results, but with no visible scoring. Adding `--score` (or showing rank position in `-vv`) would let agents decide whether the top hit is dominant or a tie.

### 8. JSON streaming for big projects

The 234 KB JSON dump for ai-work is fine for jq, but a `--stream` flag (NDJSON, one session per line) would let agents process incrementally without buffering the whole array.

---

## Small wins

- **`csm info <id>` accepts 8+ char prefix.** Document this prominently — useful and not obvious from `--help`.
- **`csm list --ids-only` exists** — great. Consider `--field <key>` for projecting any single column (id, description, project, modified, tokens) so simple jq pipelines aren't required for one-column extraction.
- **Add `--exit-2-on-empty` parity to `find`** — `list` has it; `find` should too, so scripts can branch cleanly on "no match".
- **Color in `-vvv` cards** is nice; ensure it's `NO_COLOR`-aware for piping.
- **`csm columns`** exists — link to it from `--help` so it's discoverable.

---

## Doc / agent-onboarding

Add a "Using csm from Claude Code / agents" section to README that gives the canonical recipe:
```bash
csm list -p <project> --json 2>/dev/null | jq '...'
csm find <query> -p <project> --json 2>/dev/null | jq '.[0].id'
csm info <id> --json 2>/dev/null
```
The `2>/dev/null` shouldn't be needed (see #1), but until then, calling it out saves every agent the same discovery cycle.

---

## Out of scope here

The existing `IMPROV.md` already covers internal bugs (broken test import, partial-delete races, index-write atomicity). This file is purely about **observed UX from an LLM-driven caller** — no overlap intended.
