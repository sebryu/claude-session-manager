#!/usr/bin/env bash
# mock-data.sh — Creates realistic fake Claude session data for demo recordings
# Usage: source this file, then call create_mock_data <target-dir>

set -euo pipefail

create_mock_data() {
  local base="$1"
  mkdir -p "$base/projects" "$base/usage-data/session-meta" "$base/usage-data/facets"

  # ── Project directories (encoded as dash-separated paths) ──
  local projects=(
    "-Users-dev-web-app"
    "-Users-dev-api-server"
    "-Users-dev-mobile-app"
    "-Users-dev-docs-site"
    "-Users-dev-cli-tool"
  )

  local project_paths=(
    "/Users/dev/web-app"
    "/Users/dev/api-server"
    "/Users/dev/mobile-app"
    "/Users/dev/docs-site"
    "/Users/dev/cli-tool"
  )

  # ── Session definitions ──
  # Format: id|project_idx|branch|title|summary|type|outcome|helpfulness|
  #         duration_min|user_msgs|asst_msgs|input_tok|output_tok|lines_add|lines_rm|
  #         files_mod|commits|errors|lang|days_ago|size_approx|goal
  local sessions=(
    "a1b2c3d4-e5f6-7890-abcd-111111111111|0|main|Add dark mode toggle|Implemented dark mode with CSS custom properties and localStorage persistence|code_generation|task_completed_fully|very_helpful|95|24|24|185000|42000|716|29|12|3|0|TypeScript|1|524288|Add dark mode support with system preference detection and manual toggle"
    "b2c3d4e5-f6a7-8901-bcde-222222222222|1|feat/auth|Fix JWT refresh token bug|Debugged race condition in token refresh middleware causing 401 errors|debugging|task_completed_fully|very_helpful|45|12|12|98000|21000|43|8|3|1|1|TypeScript|2|262144|Fix authentication failures when JWT tokens expire during concurrent requests"
    "c3d4e5f6-a7b8-9012-cdef-333333333333|2|main|React Native navigation refactor|Refactored navigation from React Navigation v5 to v6 with type-safe routes|code_generation|task_completed_fully|helpful|180|42|42|420000|95000|1843|892|28|5|3|TypeScript|3|1048576|Migrate React Navigation from v5 to v6 with full type safety"
    "d4e5f6a7-b8c9-0123-defa-444444444444|0|feat/perf|Optimize bundle size|Analyzed webpack bundle and reduced main chunk from 2.1MB to 890KB|analysis|task_completed_fully|very_helpful|60|15|15|130000|28000|156|423|8|2|0|JavaScript|5|393216|Reduce production bundle size below 1MB"
    "e5f6a7b8-c9d0-1234-efab-555555555555|3|main|Write API documentation|Generated comprehensive API docs with examples for all REST endpoints|documentation|task_completed_fully|helpful|120|28|28|245000|68000|2100|0|15|1|0|Markdown|7|786432|Create API reference documentation with request/response examples"
    "f6a7b8c9-d0e1-2345-fabc-666666666666|1|fix/n+1|Fix N+1 query in dashboard|Identified and fixed N+1 query pattern in dashboard stats endpoint|debugging|task_completed_fully|very_helpful|35|8|8|72000|15000|28|12|2|1|0|Python|10|196608|Fix slow dashboard load caused by N+1 database queries"
    "a7b8c9d0-e1f2-3456-abcd-777777777777|4|main|Add CLI progress bars|Added progress indicators and spinners to long-running CLI commands|code_generation|task_completed_partially|helpful|55|18|18|110000|24000|320|45|6|2|1|Go|14|327680|Add progress feedback to CLI export and sync commands"
    "b8c9d0e1-f2a3-4567-bcde-888888888888|0|main|Plan microservice split|Analyzed monolith codebase and created migration plan for 4 microservices|planning|task_completed_fully|very_helpful|90|20|20|195000|52000|0|0|0|0|0|TypeScript|21|458752|Design microservice architecture and phased migration strategy"
    "c9d0e1f2-a3b4-5678-cdef-999999999999|2|feat/offline|Implement offline sync|Built offline-first data sync with conflict resolution using SQLite|code_generation|task_completed_partially|helpful|240|56|56|520000|118000|2650|180|32|4|5|TypeScript|30|1572864|Implement offline mode with background sync and conflict resolution"
    "d0e1f2a3-b4c5-6789-defa-aaaaaaaaaaaa|1|main|Set up CI/CD pipeline|Configured GitHub Actions with test, lint, build, and deploy stages|configuration|task_completed_fully|very_helpful|40|10|10|85000|18000|280|0|4|1|0|YAML|45|229376|Set up automated CI/CD pipeline with staging and production deploys"
  )

  for proj in "${projects[@]}"; do
    mkdir -p "$base/projects/$proj"
  done

  local now_ts
  now_ts=$(date +%s)

  local index_entries=()
  local current_project_idx=-1

  for session_def in "${sessions[@]}"; do
    IFS='|' read -r id proj_idx branch title summary sess_type outcome helpfulness \
      duration user_msgs asst_msgs input_tok output_tok lines_add lines_rm \
      files_mod commits errors lang days_ago size_approx goal <<< "$session_def"

    local proj_dir="${projects[$proj_idx]}"
    local proj_path="${project_paths[$proj_idx]}"
    local session_ts=$((now_ts - days_ago * 86400))
    local created
    created=$(date -u -r "$session_ts" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "@$session_ts" +"%Y-%m-%dT%H:%M:%S.000Z")
    local end_ts=$((session_ts + duration * 60))
    local modified
    modified=$(date -u -r "$end_ts" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "@$end_ts" +"%Y-%m-%dT%H:%M:%S.000Z")

    # ── JSONL file ──
    local jsonl_path="$base/projects/$proj_dir/${id}.jsonl"

    # Write a realistic JSONL with user + assistant message pairs
    cat > "$jsonl_path" << JSONLEOF
{"type":"user","role":"user","content":"$title","cwd":"$proj_path","gitBranch":"$branch","timestamp":"$created"}
{"type":"assistant","role":"assistant","content":"I'll help you with that. Let me start by examining the codebase.","message":{"usage":{"input_tokens":$((input_tok / asst_msgs)),"output_tokens":$((output_tok / asst_msgs)),"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"timestamp":"$created"}}
JSONLEOF

    # Add more message pairs to reach ~message count
    local i
    for ((i = 2; i < user_msgs && i < 6; i++)); do
      echo "{\"type\":\"user\",\"role\":\"user\",\"content\":\"Continue with the implementation\",\"cwd\":\"$proj_path\",\"gitBranch\":\"$branch\",\"timestamp\":\"$created\"}" >> "$jsonl_path"
      echo "{\"type\":\"assistant\",\"role\":\"assistant\",\"content\":\"Making progress on the changes.\",\"message\":{\"usage\":{\"input_tokens\":$((input_tok / asst_msgs)),\"output_tokens\":$((output_tok / asst_msgs)),\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0},\"timestamp\":\"$modified\"}}" >> "$jsonl_path"
    done

    # Pad file to approximate size
    local current_size
    current_size=$(wc -c < "$jsonl_path")
    local pad_needed=$((size_approx - current_size))
    if [ "$pad_needed" -gt 0 ]; then
      # Add padding as a comment-like JSON line
      local pad_str
      pad_str=$(printf '%*s' "$pad_needed" '' | tr ' ' 'x')
      echo "{\"type\":\"assistant\",\"role\":\"assistant\",\"content\":\"$pad_str\",\"message\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0},\"timestamp\":\"$modified\"}}" >> "$jsonl_path"
    fi

    # ── Session meta ──
    local uses_task="false"
    local uses_mcp="false"
    local uses_web="false"
    if [ "$((RANDOM % 3))" -eq 0 ]; then uses_task="true"; fi
    if [ "$((RANDOM % 4))" -eq 0 ]; then uses_mcp="true"; fi
    if [ "$((RANDOM % 5))" -eq 0 ]; then uses_web="true"; fi

    cat > "$base/usage-data/session-meta/${id}.json" << METAEOF
{
  "session_id": "$id",
  "project_path": "$proj_path",
  "start_time": "$created",
  "duration_minutes": $duration,
  "user_message_count": $user_msgs,
  "assistant_message_count": $asst_msgs,
  "tool_counts": {"Read": $((files_mod * 3)), "Edit": $files_mod, "Bash": $((files_mod / 2 + 1)), "Grep": $((files_mod / 3 + 1))},
  "languages": {"$lang": $files_mod},
  "input_tokens": $input_tok,
  "output_tokens": $output_tok,
  "lines_added": $lines_add,
  "lines_removed": $lines_rm,
  "files_modified": $files_mod,
  "git_commits": $commits,
  "git_pushes": 0,
  "first_prompt": "$title",
  "summary": "$summary",
  "user_interruptions": $((RANDOM % 3)),
  "tool_errors": $errors,
  "uses_task_agent": $uses_task,
  "uses_mcp": $uses_mcp,
  "uses_web_search": $uses_web,
  "uses_web_fetch": false
}
METAEOF

    # ── Session facets ──
    cat > "$base/usage-data/facets/${id}.json" << FACETSEOF
{
  "underlying_goal": "$goal",
  "outcome": "$outcome",
  "session_type": "$sess_type",
  "brief_summary": "$summary",
  "claude_helpfulness": "$helpfulness"
}
FACETSEOF

    # ── Custom title in JSONL ──
    # Prepend a custom-title line
    local tmp_jsonl="${jsonl_path}.tmp"
    echo "{\"type\":\"custom-title\",\"customTitle\":\"$title\"}" > "$tmp_jsonl"
    cat "$jsonl_path" >> "$tmp_jsonl"
    mv "$tmp_jsonl" "$jsonl_path"

  done

  # ── Build sessions-index.json for each project ──
  for proj_idx in "${!projects[@]}"; do
    local proj_dir="${projects[$proj_idx]}"
    local proj_path="${project_paths[$proj_idx]}"
    local index_file="$base/projects/$proj_dir/sessions-index.json"

    # Start JSON
    echo "{\"version\":1,\"originalPath\":\"$proj_path\",\"entries\":[" > "$index_file"

    local first=true
    for session_def in "${sessions[@]}"; do
      IFS='|' read -r id s_proj_idx branch title summary sess_type outcome helpfulness \
        duration user_msgs asst_msgs input_tok output_tok lines_add lines_rm \
        files_mod commits errors lang days_ago size_approx goal <<< "$session_def"

      if [ "$s_proj_idx" != "$proj_idx" ]; then continue; fi

      local session_ts=$((now_ts - days_ago * 86400))
      local created
      created=$(date -u -r "$session_ts" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "@$session_ts" +"%Y-%m-%dT%H:%M:%S.000Z")
      local end_ts=$((session_ts + duration * 60))
      local modified
      modified=$(date -u -r "$end_ts" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "@$end_ts" +"%Y-%m-%dT%H:%M:%S.000Z")

      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$index_file"
      fi

      cat >> "$index_file" << ENTRYEOF
{
  "sessionId": "$id",
  "fullPath": "$base/projects/$proj_dir/${id}.jsonl",
  "fileMtime": ${end_ts}000,
  "firstPrompt": "$title",
  "summary": "$summary",
  "customTitle": "$title",
  "messageCount": $user_msgs,
  "created": "$created",
  "modified": "$modified",
  "gitBranch": "$branch",
  "projectPath": "$proj_path",
  "isSidechain": false
}
ENTRYEOF
    done

    echo "]}" >> "$index_file"
  done

  echo "Mock data created in $base with ${#sessions[@]} sessions across ${#projects[@]} projects"
}
