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
| `chat:write` | Send messages |
| `channels:history` | Read public channel history |
| `groups:history` | Read private channel history |
| `im:history` | Read DM history |
| `mpim:history` | Read group DM history |
| `reactions:write` | Add emoji reactions |
| `files:write` | Upload file attachments |
| `files:read` | Read file metadata |
| `users:read` | Resolve user info |

### 3. Subscribe to Events

Go to **Event Subscriptions** (these use Socket Mode, no public URL needed):

| Event | Purpose |
|-------|---------|
| `message.im` | Receive DMs |
| `app_mention` | Receive @mentions in channels |
| `message.channels` | Receive messages in public channels (optional) |

### 4. Install the App to Your Workspace

Click **Install App** in the sidebar. After installing, copy the **Bot User OAuth Token** (`xoxb-`).

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
      "args": ["run", "--cwd", "/path/to/claude-code-slack", "--shell=bun", "--silent", "start"]
    }
  }
}
```

### 6. Configure Tokens

Run in Claude Code:

```
/slack:configure
```

Paste your tokens when prompted. They are saved to `~/.claude/channels/slack/.env` (chmod 600, owner-only).

Restart Claude Code for the connection to activate.

### 7. Pair Your Slack Account

DM the bot in Slack. It will reply with a pairing code:

```
Pairing required — run in Claude Code:
/slack:access pair a3f91c
```

Run that command in your terminal to approve the pairing.

## Access Control

The plugin uses a layered access control model:

| Mode | Behavior |
|------|----------|
| **Pairing** (default) | Unknown DM senders get a 6-character code to approve in the terminal |
| **Allowlist** | Only pre-approved Slack user IDs can interact |
| **Disabled** | All messages dropped |

### Managing access

```bash
/slack:access                          # Show current status
/slack:access pair <code>              # Approve a pending pairing
/slack:access allow <userId>           # Add a user directly
/slack:access remove <userId>          # Remove a user
/slack:access policy allowlist         # Switch to allowlist-only mode
/slack:access group add C0123456789    # Enable a channel
/slack:access group rm C0123456789     # Disable a channel
/slack:access set ackReaction eyes     # React to messages on receipt
```

## Tools Available to Claude

Once connected, Claude Code gains these Slack tools:

| Tool | Description |
|------|-------------|
| `reply` | Send a message to a channel or DM |
| `react` | Add an emoji reaction |
| `edit_message` | Edit a previously sent message |
| `fetch_messages` | Fetch recent channel history |
| `download_attachment` | Download files from a message |

## File Layout

State lives in `~/.claude/channels/slack/`:

```
~/.claude/channels/slack/
  .env              # SLACK_BOT_TOKEN + SLACK_APP_TOKEN (chmod 600)
  access.json       # Access control policy
  approved/         # Pairing approval markers
  inbox/            # Downloaded attachments
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-Level Token (`xapp-...`) |
| `SLACK_STATE_DIR` | No | Override state directory (default: `~/.claude/channels/slack`) |
| `SLACK_ACCESS_MODE` | No | Set to `static` to pin access.json at boot |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `bun: command not found` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |
| `SLACK_BOT_TOKEN and SLACK_APP_TOKEN required` | Run `/slack:configure` and paste both tokens |
| Plugin starts but no messages arrive | Check Event Subscriptions are enabled in your Slack app settings |
| Bot doesn't respond in a channel | Add the channel with `/slack:access group add <channelId>` |
| Pairing code expired | DM the bot again to get a fresh code (codes expire after 1 hour) |

## License

Apache-2.0
