#!/usr/bin/env bash
# Permission Relay — forwards Claude Code permission prompts to Slack
# as interactive messages with Approve/Deny buttons.
#
# Used as a PermissionRequest hook. Posts Block Kit message, polls for
# button click response written by the Slack plugin's action handler.
#
# Required env vars:
#   SLACK_BOT_TOKEN    — Bot OAuth token (xoxb-...)
#   SLACK_CHANNEL_ID   — Channel to post approval requests to
#
set -euo pipefail

SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"
SLACK_CHANNEL_ID="${SLACK_CHANNEL_ID:-}"
PERMISSION_DIR="${HOME}/.claude/channels/slack/permissions"
THREAD_MAP_DIR="${HOME}/.claude/channels/slack/thread-map"
THREAD_TS_FILE="${HOME}/.claude/channels/slack/active-thread-ts"
POLL_INTERVAL=3
TIMEOUT=300

if [[ -z "$SLACK_BOT_TOKEN" || -z "$SLACK_CHANNEL_ID" ]]; then
  echo '{"continue": true}'
  exit 0
fi

mkdir -p "$PERMISSION_DIR"

# Read hook input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
RAW_CMD=$(echo "$INPUT" | jq -r '.tool_input | if type == "object" then (.command // (.file_path // (. | tostring | .[0:500]))) else (. | tostring | .[0:500]) end')

# Extract the first meaningful command (before && or heredoc)
# For multi-line commands like "git add ... && git commit ..." show each git command on its own line
CLEAN_CMD=$(echo "$RAW_CMD" | sed 's/ *&& */\n/g' | grep -E '^(git |npm |npx |curl |rm |cp |mv |docker |deploy)' | head -5)
if [[ -z "$CLEAN_CMD" ]]; then
  # Fallback: first line, truncated
  CLEAN_CMD=$(echo "$RAW_CMD" | head -1 | cut -c1-200)
fi

# For git commit, extract the message summary
COMMIT_MSG=""
if echo "$RAW_CMD" | grep -q "git commit"; then
  COMMIT_MSG=$(echo "$RAW_CMD" | sed -n 's/.*-m ["\x27]\{0,1\}\([^"\x27]*\).*/\1/p' | head -1 | cut -c1-200 2>/dev/null || echo "")
  if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG=$(echo "$RAW_CMD" | sed -n 's/.*-m \([^ ]*\).*/\1/p' | head -1 | cut -c1-200 2>/dev/null || echo "")
  fi
fi

# Generate unique request ID
REQUEST_ID="perm-$(date +%s)-$$"

# Build clean approval message — just the command + buttons
BLOCKS=$(jq -n \
  --arg cmds "$CLEAN_CMD" \
  --arg rid "$REQUEST_ID" \
  '
  [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": ("```" + $cmds + "```") }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "✅ Approve" },
          "style": "primary",
          "action_id": "permission_approve",
          "value": $rid
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "❌ Deny" },
          "style": "danger",
          "action_id": "permission_deny",
          "value": $rid
        }
      ]
    }
  ]
  ')

# Read active thread_ts — check per-session map first, fallback to global
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
THREAD_TS=""
if [[ -n "$SESSION_ID" && -f "$THREAD_MAP_DIR/$SESSION_ID" ]]; then
  THREAD_TS=$(cat "$THREAD_MAP_DIR/$SESSION_ID" 2>/dev/null || echo "")
fi
if [[ -z "$THREAD_TS" && -f "$THREAD_TS_FILE" ]]; then
  THREAD_TS=$(cat "$THREAD_TS_FILE" 2>/dev/null || echo "")
fi

RESPONSE=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg channel "$SLACK_CHANNEL_ID" \
    --arg text "🔐 Permission Request: ${TOOL_NAME}" \
    --arg thread_ts "$THREAD_TS" \
    --argjson blocks "$BLOCKS" \
    'if $thread_ts != "" then {channel: $channel, text: $text, blocks: $blocks, thread_ts: $thread_ts} else {channel: $channel, text: $text, blocks: $blocks} end')")

OK=$(echo "$RESPONSE" | jq -r '.ok // "false"')
if [[ "$OK" != "true" ]]; then
  echo '{"continue": true}' # Failed to post — don't block
  exit 0
fi

# Poll for button click (action handler writes to PERMISSION_DIR/REQUEST_ID)
DECISION_FILE="$PERMISSION_DIR/$REQUEST_ID"
DEADLINE=$(($(date +%s) + TIMEOUT))

while [[ $(date +%s) -lt $DEADLINE ]]; do
  if [[ -f "$DECISION_FILE" ]]; then
    DECISION=$(cat "$DECISION_FILE")
    rm -f "$DECISION_FILE"
    break
  fi
  sleep $POLL_INTERVAL
done

DECISION="${DECISION:-}"

if [[ "$DECISION" == "allow" ]]; then
  PERM="allow"
elif [[ "$DECISION" == "deny" ]]; then
  PERM="deny"
else
  # Timeout
  PERM="deny"
  MSG_TS=$(echo "$RESPONSE" | jq -r '.ts // empty')
  if [[ -n "$MSG_TS" ]]; then
    curl -s -X POST "https://slack.com/api/chat.update" \
      -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg channel "$SLACK_CHANNEL_ID" --arg ts "$MSG_TS" \
        --arg text "⏰ Permission request timed out — denied." \
        '{channel: $channel, ts: $ts, text: $text, blocks: []}')" > /dev/null
  fi
fi

rm -f "$DECISION_FILE" 2>/dev/null

# Post acknowledgment back to the thread so user knows the CLI received the decision
MSG_TS=$(echo "$RESPONSE" | jq -r '.ts // empty')
if [[ -n "$MSG_TS" ]]; then
  if [[ "$PERM" == "allow" ]]; then
    ACK_TEXT="✅ CLI received approval — executing."
  elif [[ "$PERM" == "deny" ]]; then
    ACK_TEXT="❌ CLI received denial — command blocked."
  else
    ACK_TEXT="⏰ No response received — command blocked (timeout)."
  fi
  ACK_THREAD="${THREAD_TS:-$MSG_TS}"
  curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg channel "$SLACK_CHANNEL_ID" --arg text "$ACK_TEXT" --arg thread_ts "$ACK_THREAD" \
      '{channel: $channel, text: $text, thread_ts: $thread_ts}')" > /dev/null
fi

jq -n --arg behavior "$PERM" '{
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: {
      behavior: $behavior
    }
  }
}'
