# /slack:configure — Slack Channel Setup

Use this skill when the user pastes Slack bot tokens, asks to configure the
Slack channel, or wants to check channel status.

## What to do

### If the user provides tokens

1. Extract `SLACK_BOT_TOKEN` (starts with `xoxb-`) and `SLACK_APP_TOKEN` (starts with `xapp-`).
2. Write to `~/.claude/channels/slack/.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
3. Set file permissions to 0o600 (owner-only).
4. Tell the user the tokens are saved and they need to restart Claude Code
   for the channel to connect.

### If the user asks for status

1. Check if `~/.claude/channels/slack/.env` exists and has both tokens.
2. Read `~/.claude/channels/slack/access.json` (if exists).
3. Report:
   - Token status: set / not set (never show the actual token)
   - DM policy: pairing / allowlist / disabled
   - Allowed users: count and list
   - Groups: count and channel IDs
   - Pending pairings: count

### Security guidance

If the policy is still `pairing` (default), suggest the user:
1. Pair the users they want
2. Then switch to `allowlist` via `/slack:access policy allowlist`
   to lock down access

## Important

- Never show token values — only confirm set/not-set.
- The .env file must be chmod 0o600 (owner read/write only).
- Both tokens are required: SLACK_BOT_TOKEN for API calls, SLACK_APP_TOKEN for Socket Mode.
