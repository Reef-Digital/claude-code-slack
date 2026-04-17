# claude-code-slack

Slack channel plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Interact with Claude Code agents via Slack — no terminal needed.

## How it works

This plugin runs as an MCP server alongside Claude Code. It connects to Slack via Socket Mode (WebSocket) and bridges messages between Slack and Claude Code. Claude Code sees Slack messages as channel notifications and can reply, react, edit messages, fetch history, and handle file attachments.

## Prerequisites

### Bun

This plugin requires [Bun](https://bun.sh) as its JavaScript runtime.

**macOS / Linux:**

```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (via PowerShell):**

```powershell
irm bun.sh/install.ps1 | iex
```

**Verify installation:**

```bash
bun --version
```

If `bun` is not installed, the plugin will fail to start. See [bun.sh](https://bun.sh) for alternative install methods (Homebrew, npm, Docker, etc).

### Claude Code

Version **2.1.80** or later is required (channels support). Check with:

```bash
claude --version
```

> **Important:** Channels require a **Claude Pro, Max, Team, or Enterprise subscription** (claude.ai account login). API key authentication (`ANTHROPIC_API_KEY`) alone is not sufficient — the channels feature depends on claude.ai OAuth which is only available with a subscription plan. On headless servers without browser access (e.g. EC2), set `CLAUDE_TMUX_WINDOW` to use the tmux fallback delivery instead.

### Slack App

You need a Slack app with Socket Mode enabled. Follow the steps below to create one.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name it (e.g. "Claude"), and select your workspace
3. Go to **Settings > Socket Mode** and toggle it **on**
4. Generate an **App-Level Token** with the `connections:write` scope — this is your `xapp-` token. Save it.

### 2. Configure Bot Permissions

Go to **OAuth & Permissions > Bot Token Scopes** and add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive `@bot` mentions in channels |
| `chat:write` | Send messages |
| `channels:read` | Look up public channel metadata |
| `channels:history` | Read public channel history |
| `groups:history` | Read private channel history |
| `im:history` | Read DM history |
| `mpim:history` | Read group DM history |
| `reactions:write` | Add emoji reactions |
| `files:write` | Upload file attachments |
| `files:read` | Read file metadata |
| `users:read` | Resolve user IDs to display names (`fetch_messages`, `fetch_thread`) |
| `users.profile:read` | Read `profile.display_name` for name resolution |

> **All scopes are required.** Reinstall the app after adding any of them — the bot token issued at install time is scope-locked. If a scope is missing, the plugin does not crash: it silently falls back (e.g. `fetch_messages` prints raw `U0…` IDs instead of display names). Check plugin stderr for `resolveUserName(…) failed: missing_scope` to diagnose scope gaps.

### 3. Subscribe to Events

Go to **Event Subscriptions** and enable it. Under **Subscribe to bot events**, add all of the following:

| Event | Purpose |
|-------|---------|
| `message.channels` | Receive messages in public channels |
| `message.groups` | Receive messages in private channels |
| `message.im` | Receive direct messages |
| `message.mpim` | Receive group direct messages |
| `app_mention` | Receive @mentions in channels |

> **All five events are required.** Socket Mode connects successfully without them, but Slack will never send message events over the WebSocket — the bot will appear online but silently ignore all messages.

### 4. Install the App to Your Workspace

Click **Install App** in the sidebar. After installing, copy the **Bot User OAuth Token** (`xoxb-`).

> If you change scopes or event subscriptions after installing, you must **reinstall the app** for changes to take effect.

You now have two tokens:
- `xoxb-...` — Bot User OAuth Token (from Install App page)
- `xapp-...` — App-Level Token (from Socket Mode settings)

### 5. Install the Plugin

```bash
claude /install-plugin https://github.com/reef-digital/claude-code-slack
```

Or manually clone and add to your Claude Code MCP config:

```bash
git clone https://github.com/reef-digital/claude-code-slack.git
```

Then add to your MCP settings (e.g. `~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "slack": {
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/claude-code-slack", "--silent", "start"]
    }
  }
}
```

> **Note:** Do not use a `cwd` field in the MCP config — Claude Code ignores it. Use bun's `--cwd` flag in the args array instead.

### 6. Configure Tokens and Baseline Access

The plugin is configured entirely via environment variables — no JSON files to edit.

Run in Claude Code:

```
/slack:configure
```

…and paste your Slack tokens when prompted. Or edit `~/.claude/channels/slack/.env` by hand:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_OWNERS=U08LBFQAKTM
SLACK_CHANNELS=C0AU11F386M,C0ARG49JR7W
```

The file is chmod 600, owner-only.

| Env var | Required | Default | Behavior |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | Bot User OAuth Token (`xoxb-...`) from the Slack app's Install page |
| `SLACK_APP_TOKEN` | yes | — | App-Level Token (`xapp-...`) with `connections:write` scope |
| `SLACK_OWNERS` | yes | — | Comma-separated Slack user IDs. Owners can always DM the bot and trigger it in any `SLACK_CHANNELS` channel. |
| `SLACK_CHANNELS` | yes | — | Comma-separated Slack channel IDs. The bot only responds in these channels. |
| `SLACK_MENTION_REQUIRED` | no | `true` | Set to the literal string `false` to let channel messages trigger the bot without `@bot`. |
| `SLACK_STATE_DIR` | no | `~/.claude/channels/slack` | Override the state directory |
| `SLACK_ACCESS_MODE` | no | — | Set to `static` to pin access.json at boot (advanced) |

**Invite the bot to each channel in Slack.** `SLACK_CHANNELS` only controls which channels the plugin responds to — it does not auto-join. In Slack, type `/invite @YourBotName` in each channel listed.

To find a Slack user or channel ID: right-click the name in Slack → **View … details** → scroll to the bottom.

### 7. Launch Claude Code with the Channel

This is a development channel plugin, so it requires the `--dangerously-load-development-channels` flag:

```bash
claude --dangerously-load-development-channels server:slack
```

You should see:

```
Listening for channel messages from: server:slack
```

> `server:slack` refers to the MCP server key in `.mcp.json`. Do not also pass `--channels` — that flag is for official plugins only and will cause duplicate registration warnings.

### 8. Say Hi

With `SLACK_OWNERS` + `SLACK_CHANNELS` set, you can now DM the bot from any owner account, or @mention it in any channel listed in `SLACK_CHANNELS` (after inviting the bot to that channel in Slack). No further setup required.

## Access Control

The env vars above are the **primary access-control layer**. Owners listed in `SLACK_OWNERS` can DM the bot and trigger it in channels listed in `SLACK_CHANNELS`. That's it.

### Precedence

1. **Env** (`SLACK_OWNERS` / `SLACK_CHANNELS`) — the baseline. Set once at deploy time.
2. **`access.json`** (optional, managed via `/slack:access`) — additive runtime overrides. Used for ad-hoc pairings and per-channel custom policies.

For DMs: a sender is allowed if they appear in **either** `SLACK_OWNERS` or `access.json:allowFrom`.

For channels:
- If `access.json` has an explicit entry for the channel, that entry wins — its `allowFrom` and `requireMention` are applied exactly as stored.
- Otherwise, if the channel is in `SLACK_CHANNELS`, the env defaults apply (only `SLACK_OWNERS` members can trigger, `SLACK_MENTION_REQUIRED` controls mention policy).
- Otherwise, the message is dropped.

## Advanced usage

Everything below is optional. Most deployments need only the env vars above.

### `/slack:access` — runtime overrides

The plugin still ships with the legacy `access.json` state file + `/slack:access` skill for ad-hoc changes that don't warrant an env-var edit:

```bash
/slack:access                          # Show current status
/slack:access pair <code>              # Approve a pending pairing
/slack:access allow <userId>           # Add a user directly
/slack:access remove <userId>          # Remove a user
/slack:access policy allowlist         # Switch to allowlist-only mode
/slack:access group add C0123456789    # Enable a channel (custom policy)
/slack:access group rm C0123456789     # Disable a channel
/slack:access set ackReaction eyes     # React to messages on receipt
```

`access.json` is optional — the plugin boots cleanly without it. It's only used when you need per-channel custom policies beyond the env defaults.

### Pairing flow (DMs from non-owners)

If a Slack user not in `SLACK_OWNERS` DMs the bot and `dmPolicy` is `pairing` (the default in `access.json`), the bot replies with a 6-character pairing code. The user in the terminal runs `/slack:access pair <code>` to add the sender to `access.json:allowFrom`.

Pairing is only relevant if you want to grant DM access to users who aren't listed in `SLACK_OWNERS`. If every DM-capable user is already an owner, you never hit the pairing flow.

### Per-channel options (`access.json` only)

Custom channel entries in `access.json` support:

- `requireMention` (default: `true`) — only respond when @mentioned. Set to `false` to respond to all messages.
- `allowFrom` — restrict which user IDs can trigger the bot in that channel. Empty list = anyone in the channel.

These overrides apply **per channel** and fully replace the env defaults for that channel.

### DM policy modes (`access.json` only)

| Mode | Behavior |
|------|----------|
| `pairing` (default) | Unknown DM senders get a pairing code |
| `allowlist` | Only users in `SLACK_OWNERS` or `access.json:allowFrom` can DM |
| `disabled` | All messages dropped |

## Architecture

### Message Delivery

The plugin uses Claude Code's native **MCP channel notification protocol** to deliver Slack messages. No tmux, file watching, or stdin piping is involved.

```
Slack (Socket Mode WebSocket)
  ↓
Bolt SDK (event listener)
  ↓
server.ts — formats message, downloads attachments
  ↓
mcp.notification({
  method: 'notifications/claude/channel',
  params: { content, meta: { chat_id, message_id, user, ts } }
})
  ↓
Claude Code — injects as <channel> tag in conversation
```

**Inbound** (Slack → Claude): Slack messages arrive via Bolt Socket Mode. The server formats them with metadata (channel ID, user, timestamp, attachments) and delivers via `notifications/claude/channel`. Claude Code renders these as `<channel source="slack" ...>` blocks in the conversation.

**Outbound** (Claude → Slack): Claude calls MCP tools (`reply`, `react`, `edit_message`, etc.) which the server executes via the Slack Web API.

**Attachments**: Images and files attached to Slack messages are auto-downloaded to `~/.claude/channels/slack/inbox/` and their local paths are included in the notification. Claude can read these files directly.

### Key Design Decisions

- **MCP over tmux/stdin**: The `notifications/claude/channel` protocol is a first-class Claude Code feature. It handles message queuing, deduplication, and context injection natively.
- **Socket Mode over HTTP**: No public URL or ngrok needed. The WebSocket connection is outbound-only, works behind firewalls and on EC2.
- **Deduplication**: Slack fires both `message` and `app_mention` events for @mentions. The server tracks processed timestamps to prevent duplicate delivery.
- **Access control**: All access decisions happen in the plugin before messages reach Claude. Unauthorized messages are silently dropped.

## Tools Available to Claude

Once connected, Claude Code gains these Slack tools:

| Tool | Description |
|------|-------------|
| `reply` | Send a message to a channel or DM |
| `react` | Add an emoji reaction |
| `edit_message` | Edit a previously sent message |
| `fetch_messages` | Fetch recent channel history |
| `fetch_thread` | Fetch replies in a thread |
| `download_attachment` | Download files from a message |

`fetch_messages` and `fetch_thread` resolve each message's user ID to a display name (via `users.info`, cached per process) so output reads as `alice: hello` instead of `U08LBFQAKTM: hello`. Requires the `users:read` scope.

## Approval Flow for Destructive Actions

When Claude Code runs on EC2 (headless, no terminal), it needs human approval for destructive actions like `git commit`, `git push`, deploy, etc. The plugin's tools enable a Slack-based approval protocol:

### How it works

1. **Claude posts a summary** to Slack using `reply`:
   ```
   Ready to commit and push reef-agents v1.2.16:
   - admin.service.ts — shop name in search traces
   - package.json — version bump
   Reply `approved` to proceed or `denied` to abort.
   ```

2. **Claude polls for response** using `fetch_thread` on the message it posted

3. **User replies** in the thread: `approved` or `denied`

4. **Claude reads the reply** and acts accordingly

### Setting up in your workspace

The plugin ships with ready-made templates. Copy them to your project:

```bash
# From your project root:
cp -r /path/to/claude-code-slack/templates/rules/ .claude/rules/
cp -r /path/to/claude-code-slack/templates/commands/ .claude/commands/
```

This installs:
- `.claude/rules/slack-approval.md` — enforces the approval protocol automatically
- `.claude/commands/request-approval.md` — `/request-approval` skill for the full approval flow

Use `/request-approval <action description>` to invoke the protocol.

### Keywords

| User reply | Action |
|------------|--------|
| `approved`, `yes`, `go`, `proceed` | Execute the action |
| `denied`, `no`, `stop`, `abort` | Cancel the action |

### Example conversation

```
🤖 Bot: Ready to push reef-agents v1.2.16 to release/1.2.
         Changes: admin.service.ts (shop name in traces)
         Reply `approved` to proceed or `denied` to abort. ⏳

👤 User: approved

🤖 Bot: ✅ Pushed: 9e15b61 → release/1.2
```

## File Layout

State lives in `~/.claude/channels/slack/`:

```
~/.claude/channels/slack/
  .env              # SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_OWNERS, SLACK_CHANNELS (chmod 600)
  access.json       # Optional runtime overrides (pairings, per-channel policies)
  approved/         # Pairing approval markers
  inbox/            # Downloaded attachments
```

See **Setup > 6. Configure Tokens and Baseline Access** above for the full env var reference.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `bun: command not found` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |
| `SLACK_BOT_TOKEN and SLACK_APP_TOKEN required` | Run `/slack:configure` and paste both tokens |
| Bot ignores DMs from an owner | Confirm the user ID is in `SLACK_OWNERS` (comma-separated, no quotes) and restart the plugin. Check plugin stderr for `slack channel: connected as …` on startup. |
| Bot connects but no messages arrive | Verify all 5 event subscriptions are added (step 3) and the app was reinstalled after adding them |
| Bot doesn't respond in a channel | 1) Invite the bot to the channel in Slack 2) Add the channel ID to `SLACK_CHANNELS` in `~/.claude/channels/slack/.env` 3) Verify your user ID is in `SLACK_OWNERS` 4) Restart the plugin |
| "Listening for channel messages" but nothing happens | Check `--dangerously-load-development-channels server:slack` flag is set |
| Pairing code expired | DM the bot again to get a fresh code (codes expire after 1 hour) |
| MCP server crashes silently | Do not use `cwd` in `.mcp.json` — use bun's `--cwd` flag in args instead |

## License

Apache-2.0
