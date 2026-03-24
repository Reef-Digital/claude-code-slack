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

### 6. Configure Tokens

Run in Claude Code:

```
/slack:configure
```

Paste your tokens when prompted. They are saved to `~/.claude/channels/slack/.env` (chmod 600, owner-only).

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

### 8. Pair Your Slack Account

DM the bot in Slack. It will reply with a pairing code:

```
Pairing required — run in Claude Code:
/slack:access pair a3f91c
```

Run that command in your terminal to approve the pairing.

### 9. Invite the Bot to Channels

For the bot to receive messages in a channel, it must be a member:

1. Open the Slack channel
2. Type `/invite @YourBotName` or mention the bot
3. Enable the channel in access control:

```
/slack:access group add C0123456789
```

To find a channel's ID, right-click the channel name in Slack > **View channel details** > scroll to the bottom.

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

### Channel options

When adding a group, you can configure per-channel behavior:

- `requireMention` (default: `true`) — only respond when @mentioned. Set to `false` to respond to all messages.
- `allowFrom` — restrict which user IDs can trigger the bot in that channel.

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
| Bot connects but no messages arrive | Verify all 5 event subscriptions are added (step 3) and the app was reinstalled after adding them |
| Bot doesn't respond in a channel | 1) Invite the bot to the channel 2) Add with `/slack:access group add <channelId>` |
| "Listening for channel messages" but nothing happens | Check `--dangerously-load-development-channels server:slack` flag is set |
| Pairing code expired | DM the bot again to get a fresh code (codes expire after 1 hour) |
| MCP server crashes silently | Do not use `cwd` in `.mcp.json` — use bun's `--cwd` flag in args instead |

## License

Apache-2.0
