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

# Track active thread_ts from Slack replies so permission-relay can post in-thread
# Uses a thread map directory keyed by session_id for multi-agent support
THREAD_MAP_DIR="${HOME}/.claude/channels/slack/thread-map"
THREAD_TS_FILE="${HOME}/.claude/channels/slack/active-thread-ts"
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [ "$TOOL_NAME" = "mcp__slack__reply" ]; then
  REPLY_TO=$(echo "$INPUT" | jq -r '.tool_input.reply_to // empty')
  REPLY_CHANNEL=$(echo "$INPUT" | jq -r '.tool_input.chat_id // empty')
  if [ -n "$REPLY_TO" ]; then
    # Always update global fallback
    echo "$REPLY_TO" > "$THREAD_TS_FILE"
    # Also write per-session mapping
    if [ -n "$SESSION_ID" ]; then
      mkdir -p "$THREAD_MAP_DIR"
      echo "$REPLY_TO" > "$THREAD_MAP_DIR/$SESSION_ID"
    fi
  fi
  # Track active channel so permission-relay posts in the right channel
  if [ -n "$REPLY_CHANNEL" ]; then
    echo "$REPLY_CHANNEL" > "${HOME}/.claude/channels/slack/active-channel"
  fi
fi

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
