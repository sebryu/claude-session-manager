#!/usr/bin/env bash
# generate.sh — Generate a demo GIF for Claude Session Manager
#
# Usage:
#   ./demo/generate.sh          # Record with real session data
#   ./demo/generate.sh --mock   # Record with mock data
#
# Prerequisites:
#   brew install vhs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAPE_FILE="$SCRIPT_DIR/demo.tape"
OUTPUT_FILE="$SCRIPT_DIR/demo.gif"
MOCK=false

for arg in "$@"; do
  case "$arg" in
    --mock) MOCK=true ;;
    --help|-h)
      echo "Usage: $0 [--mock]"
      echo ""
      echo "  --mock   Use generated fake session data instead of real ~/.claude data"
      echo ""
      echo "Prerequisites: brew install vhs"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

# Check prerequisites
if ! command -v vhs &>/dev/null; then
  echo "Error: vhs is not installed. Install with: brew install vhs" >&2
  exit 1
fi

if [ ! -f "$TAPE_FILE" ]; then
  echo "Error: Tape file not found: $TAPE_FILE" >&2
  exit 1
fi

cleanup() {
  if [ -n "${MOCK_DIR:-}" ] && [ -d "${MOCK_DIR:-}" ]; then
    rm -rf "$MOCK_DIR"
    echo "Cleaned up mock data: $MOCK_DIR"
  fi
  if [ -n "${TEMP_TAPE:-}" ] && [ -f "${TEMP_TAPE:-}" ]; then
    rm -f "$TEMP_TAPE"
  fi
}
trap cleanup EXIT

EFFECTIVE_TAPE="$TAPE_FILE"

if [ "$MOCK" = true ]; then
  MOCK_DIR=$(mktemp -d)
  echo "Creating mock session data in $MOCK_DIR..."

  # shellcheck source=./mock-data.sh
  source "$SCRIPT_DIR/mock-data.sh"
  create_mock_data "$MOCK_DIR"

  echo "Recording demo with mock data..."

  # Create a modified tape:
  # - Remove "Require csm" (may not be on PATH in VHS subshell)
  # - Insert "Env CLAUDE_DIR ..." after the last "Set" line
  TEMP_TAPE=$(mktemp "${SCRIPT_DIR}/demo-mock-XXXXXX.tape")

  awk -v mock_dir="$MOCK_DIR" '
    /^Require csm/ { next }
    { lines[NR] = $0 }
    /^Set / { last_set = NR }
    END {
      for (i = 1; i <= NR; i++) {
        print lines[i]
        if (i == last_set) {
          print ""
          print "Env CLAUDE_DIR \"" mock_dir "\""
        }
      }
    }
  ' "$TAPE_FILE" > "$TEMP_TAPE"

  EFFECTIVE_TAPE="$TEMP_TAPE"
else
  echo "Recording demo with real session data from ~/.claude..."
fi

cd "$SCRIPT_DIR"
vhs "$EFFECTIVE_TAPE"

if [ -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "Demo GIF saved to: $OUTPUT_FILE"
  SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
  echo "Size: $SIZE"
else
  echo "Error: GIF was not created" >&2
  exit 1
fi
