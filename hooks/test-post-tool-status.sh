#!/bin/bash
# Test suite for post-tool-status.sh hook
# Validates filtering, message formatting, edit-vs-post logic, and error handling.
# Does NOT call Slack API — uses a mock curl.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/post-tool-status.sh"
PASS=0
FAIL=0

# Setup: temp dirs for mock env and curl
MOCK_DIR=$(mktemp -d)
TEST_ENV="$MOCK_DIR/.env"
CURL_LOG="$MOCK_DIR/curl.log"
STATUS_FILE="$MOCK_DIR/status-ts"

echo "SLACK_BOT_TOKEN=xoxb-test-token" > "$TEST_ENV"

# Mock curl
cat > "$MOCK_DIR/curl" << 'MOCKCURL'
#!/bin/bash
echo "$@" >> "$CURL_LOG_PATH"
for arg in "$@"; do
  case "$arg" in
    *chat.update*) echo '{"ok":true,"ts":"1234567890.000001"}'; exit 0 ;;
    *chat.postMessage*) echo '{"ok":true,"ts":"9999999999.000001"}'; exit 0 ;;
  esac
done
echo '{"ok":false}'
MOCKCURL
chmod +x "$MOCK_DIR/curl"

run_hook() {
  local input="$1"
  rm -f "$CURL_LOG" "$STATUS_FILE"
  echo "$input" | \
    SLACK_ENV_PATH="$TEST_ENV" \
    SLACK_STATUS_FILE="$STATUS_FILE" \
    CURL_LOG_PATH="$CURL_LOG" \
    PATH="$MOCK_DIR:$PATH" \
    bash "$HOOK" 2>/dev/null
  echo $?
}

run_hook_with_status() {
  local input="$1"
  local existing_ts="$2"
  rm -f "$CURL_LOG"
  echo "$existing_ts" > "$STATUS_FILE"
  echo "$input" | \
    SLACK_ENV_PATH="$TEST_ENV" \
    SLACK_STATUS_FILE="$STATUS_FILE" \
    CURL_LOG_PATH="$CURL_LOG" \
    PATH="$MOCK_DIR:$PATH" \
    bash "$HOOK" 2>/dev/null
  echo $?
}

assert() {
  local test_name="$1"
  local condition="$2"

  if eval "$condition"; then
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name"
    FAIL=$((FAIL + 1))
  fi
}

# ── Filtering: read-only tools should exit silently ────────────────

echo "Test 1: Filtered tools don't call Slack"
for tool in Read Glob Grep WebSearch WebFetch ToolSearch; do
  run_hook "{\"tool_name\":\"$tool\",\"tool_input\":{}}" > /dev/null
  assert "$tool is filtered" "[ ! -f '$CURL_LOG' ]"
done

# ── Allowed tools post to Slack ────────────────────────────────────

echo ""
echo "Test 2: Bash tool posts to Slack"
run_hook '{"tool_name":"Bash","tool_input":{"command":"npm test","description":"Run test suite"}}' > /dev/null
assert "Slack API called" "[ -f '$CURL_LOG' ]"
assert "used postMessage" "grep -q 'chat.postMessage' '$CURL_LOG'"
assert "includes description" "grep -q 'Run test suite' '$CURL_LOG'"

echo ""
echo "Test 3: Edit tool posts to Slack"
run_hook '{"tool_name":"Edit","tool_input":{"file_path":"/foo.ts","description":"Update hero text"}}' > /dev/null
assert "Slack API called" "[ -f '$CURL_LOG' ]"
assert "includes description" "grep -q 'Update hero text' '$CURL_LOG'"

echo ""
echo "Test 4: Write tool posts to Slack"
run_hook '{"tool_name":"Write","tool_input":{"file_path":"/foo.ts","description":"Create new file"}}' > /dev/null
assert "Slack API called" "[ -f '$CURL_LOG' ]"

echo ""
echo "Test 5: Agent tool posts with agent type prefix"
run_hook '{"tool_name":"Agent","tool_input":{"description":"Build frontend"},"agent_type":"merchant-ui"}' > /dev/null
assert "Slack API called" "[ -f '$CURL_LOG' ]"
assert "includes agent type" "grep -q 'merchant-ui' '$CURL_LOG'"
assert "includes description" "grep -q 'Build frontend' '$CURL_LOG'"

# ── Message formatting ─────────────────────────────────────────────

echo ""
echo "Test 6: Format is 'Tool: description'"
run_hook '{"tool_name":"Bash","tool_input":{"command":"npm run build","description":"Build project"}}' > /dev/null
assert "correct format" "grep -q 'Bash: Build project' '$CURL_LOG'"

echo ""
echo "Test 7: Tool without description shows just tool name"
run_hook '{"tool_name":"Bash","tool_input":{"command":"ls"}}' > /dev/null
assert "shows tool name" "grep -q 'Bash' '$CURL_LOG'"

echo ""
echo "Test 8: Null agent type is not shown as prefix"
run_hook '{"tool_name":"Bash","tool_input":{"description":"Simple task"},"agent_type":null}' > /dev/null
assert "no null prefix" "! grep -q '\[null\]' '$CURL_LOG'"

echo ""
echo "Test 9: Missing agent_type field is not shown"
run_hook '{"tool_name":"Bash","tool_input":{"description":"Simple task"}}' > /dev/null
assert "no empty prefix" "! grep -q '\[\]' '$CURL_LOG'"

# ── Edit vs post logic ────────────────────────────────────────────

echo ""
echo "Test 10: Edits existing message when status file exists"
run_hook_with_status '{"tool_name":"Bash","tool_input":{"description":"Second action"}}' "1234567890.000001" > /dev/null
assert "used chat.update" "grep -q 'chat.update' '$CURL_LOG'"
assert "did not post new" "! grep -q 'chat.postMessage' '$CURL_LOG'"

echo ""
echo "Test 11: Posts new message when no status file"
run_hook '{"tool_name":"Bash","tool_input":{"description":"First action"}}' > /dev/null
assert "used postMessage" "grep -q 'chat.postMessage' '$CURL_LOG'"

echo ""
echo "Test 12: Saves timestamp to status file after new post"
assert "status file created" "[ -f '$STATUS_FILE' ]"
assert "correct timestamp" "[ \"\$(cat $STATUS_FILE)\" = '9999999999.000001' ]"

# ── Edge cases ─────────────────────────────────────────────────────

echo ""
echo "Test 13: Empty tool name and description exits silently"
run_hook '{"tool_input":{}}' > /dev/null
assert "no Slack call" "[ ! -f '$CURL_LOG' ]"

echo ""
echo "Test 14: Missing .env exits gracefully"
rm -f "$CURL_LOG" "$STATUS_FILE"
EC=$(echo '{"tool_name":"Bash","tool_input":{"description":"test"}}' | \
  SLACK_ENV_PATH="/nonexistent/.env" \
  SLACK_STATUS_FILE="$STATUS_FILE" \
  PATH="$MOCK_DIR:$PATH" \
  bash "$HOOK" 2>/dev/null; echo $?)
assert "exits 0" "[ '$EC' = '0' ]"
assert "no Slack call" "[ ! -f '$CURL_LOG' ]"

echo ""
echo "Test 15: Empty bot token exits gracefully"
echo "" > "$MOCK_DIR/.env-empty"
rm -f "$CURL_LOG" "$STATUS_FILE"
EC=$(echo '{"tool_name":"Bash","tool_input":{"description":"test"}}' | \
  SLACK_ENV_PATH="$MOCK_DIR/.env-empty" \
  SLACK_STATUS_FILE="$STATUS_FILE" \
  PATH="$MOCK_DIR:$PATH" \
  bash "$HOOK" 2>/dev/null; echo $?)
assert "exits 0" "[ '$EC' = '0' ]"
assert "no Slack call" "[ ! -f '$CURL_LOG' ]"

# ── Cleanup ────────────────────────────────────────────────────────

rm -rf "$MOCK_DIR"

# ── Summary ────────────────────────────────────────────────────────

echo ""
echo "================================"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS passed, $FAIL failed (out of $TOTAL)"
echo "================================"

[ "$FAIL" -eq 0 ] || exit 1
