#!/bin/bash
# Pre-commit gate: blocks git commit/push unless build+test validation passed
# Used as a PreToolUse hook — exits non-zero to block the tool call

TOOL_INPUT="$CLAUDE_TOOL_INPUT"
GATE_FILE="/tmp/claude-pre-commit-gate.json"

# Only intercept git commit and git push commands
if ! echo "$TOOL_INPUT" | grep -qE 'git (commit|push)'; then
  exit 0
fi

# Check if the gate file exists and is recent (< 10 minutes old)
if [ ! -f "$GATE_FILE" ]; then
  echo "BLOCKED: Pre-commit gate not passed. You MUST run this sequence first:"
  echo "  1. npm ci (or npm install)"
  echo "  2. npm run build"
  echo "  3. npm run test"
  echo "Then call the gate script: bash claude-code-slack/hooks/pass-gate.sh <repo-dir>"
  exit 2
fi

# Check age (600 seconds = 10 minutes)
if [ "$(uname)" = "Darwin" ]; then
  FILE_AGE=$(( $(date +%s) - $(stat -f %m "$GATE_FILE") ))
else
  FILE_AGE=$(( $(date +%s) - $(stat -c %Y "$GATE_FILE") ))
fi

if [ "$FILE_AGE" -gt 600 ]; then
  echo "BLOCKED: Gate file is ${FILE_AGE}s old (>600s). Re-run build+test sequence."
  rm -f "$GATE_FILE"
  exit 2
fi

# Gate passed
exit 0
