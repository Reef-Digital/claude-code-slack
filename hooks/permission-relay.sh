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
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input | if type == "object" then (.command // (.file_path // (. | tostring | .[0:300]))) else (. | tostring | .[0:300]) end')

# Gather git context for richer messages
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_REPO=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")
GIT_STATUS=$(git diff --stat --cached 2>/dev/null || git diff --stat 2>/dev/null || echo "")
GIT_STATUS="${GIT_STATUS:0:500}"

# Build context string
CONTEXT=""
if [[ "$TOOL_INPUT" == git* ]]; then
  CONTEXT="*Repo:* \`${GIT_REPO}\` • *Branch:* \`${GIT_BRANCH}\`"
  if [[ -n "$GIT_STATUS" ]]; then
    CONTEXT="${CONTEXT}\n*Changes:*\n\`\`\`${GIT_STATUS}\`\`\`"
  fi
fi

# Generate unique request ID
REQUEST_ID="perm-$(date +%s)-$$"

# Post Block Kit message with buttons
DESC="🔐 *Permission Request*\n\nTool: \`${TOOL_NAME}\`\n\`\`\`${TOOL_INPUT}\`\`\`"
if [[ -n "$CONTEXT" ]]; then
  DESC="${DESC}\n\n${CONTEXT}"
fi

BLOCKS=$(jq -n \
  --arg desc "$DESC" \
  --arg rid "$REQUEST_ID" \
  '[
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": $desc
      }
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
  ]')

RESPONSE=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg channel "$SLACK_CHANNEL_ID" \
    --arg text "🔐 Permission Request: ${TOOL_NAME}" \
    --argjson blocks "$BLOCKS" \
    '{channel: $channel, text: $text, blocks: $blocks}')")

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

jq -n --arg decision "$PERM" --arg reason "Slack interactive: $DECISION" '{
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    permissionDecision: $decision,
    permissionDecisionReason: $reason
  }
}'
