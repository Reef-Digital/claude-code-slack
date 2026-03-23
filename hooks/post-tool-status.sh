#!/bin/bash
# Post tool use status updates to Slack channel.
# Called as a PostToolUse hook — receives JSON on stdin.
# Uses the Slack bot token from the channel plugin's .env.

set -euo pipefail

SLACK_ENV="${SLACK_ENV_PATH:-$HOME/.claude/channels/slack/.env}"
CHANNEL_ID="${SLACK_STATUS_CHANNEL:-C0AMXQUDF5K}"
STATUS_FILE="${SLACK_STATUS_FILE:-/tmp/claude-slack-status-ts}"

# Load bot token
if [ ! -f "$SLACK_ENV" ]; then exit 0; fi
BOT_TOKEN=$(grep '^SLACK_BOT_TOKEN=' "$SLACK_ENV" | cut -d= -f2 || true)
if [ -z "$BOT_TOKEN" ]; then exit 0; fi

# Parse hook input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Skip noisy read-only tools
case "$TOOL_NAME" in
  Read|Glob|Grep|WebSearch|WebFetch|ToolSearch) exit 0 ;;
esac

# Skip if no meaningful description
if [ -z "$DESCRIPTION" ] && [ -z "$TOOL_NAME" ]; then exit 0; fi

# Build status line
if [ -n "$AGENT_TYPE" ] && [ "$AGENT_TYPE" != "null" ]; then
  PREFIX="[$AGENT_TYPE]"
else
  PREFIX=""
fi

if [ -n "$DESCRIPTION" ]; then
  STATUS_LINE="${PREFIX} ${TOOL_NAME}: ${DESCRIPTION}"
else
  STATUS_LINE="${PREFIX} ${TOOL_NAME}"
fi

# Escape for JSON
STATUS_LINE=$(echo "$STATUS_LINE" | sed 's/\\/\\\\/g; s/"/\\"/g')

# Check for existing status message to edit (stored in temp file)
if [ -f "$STATUS_FILE" ]; then
  MSG_TS=$(cat "$STATUS_FILE")
  # Edit existing status message
  RESULT=$(curl -s -X POST "https://slack.com/api/chat.update" \
    -H "Authorization: Bearer $BOT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"$CHANNEL_ID\",\"ts\":\"$MSG_TS\",\"text\":\"$STATUS_LINE\"}" 2>/dev/null)

  OK=$(echo "$RESULT" | jq -r '.ok // false')
  if [ "$OK" = "true" ]; then exit 0; fi
  # If edit failed (message deleted etc), fall through to post new
fi

# Post new status message
RESULT=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"channel\":\"$CHANNEL_ID\",\"text\":\"$STATUS_LINE\"}" 2>/dev/null)

# Save message timestamp for future edits
TS=$(echo "$RESULT" | jq -r '.ts // empty')
if [ -n "$TS" ]; then
  echo "$TS" > "$STATUS_FILE"
fi
