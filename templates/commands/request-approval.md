---
description: Request human approval via Slack before executing a destructive action (commit, push, deploy, delete)
---

You MUST use this pattern before any destructive or visible action when operating via Slack (no terminal access). This includes: git commit, git push, deploy, file deletion, DB changes, or any action that affects shared state.

## How to request approval

1. **Post a summary to Slack** using the `mcp__slack__reply` tool:
   - Clearly state what you want to do
   - List the specific changes (files, repos, versions)
   - End with: "Reply `approved` to proceed or `denied` to abort."
   - Add a ⏳ reaction to your own message using `mcp__slack__react`

2. **Poll for response** using `mcp__slack__fetch_thread`:
   - Fetch the thread of the message you posted
   - Check for a reply from the user (not from the bot)
   - Look for keywords: `approved`, `yes`, `go`, `proceed` → approved
   - Look for keywords: `denied`, `no`, `stop`, `abort` → denied
   - Poll every 10 seconds, timeout after 5 minutes
   - If timeout: post "Approval timed out — action not taken." and abort

3. **Act on response**:
   - If approved: execute the action, then reply with confirmation
   - If denied: reply "Action cancelled." and do NOT execute
   - Replace the ⏳ reaction with ✅ (approved) or ❌ (denied)

## Example flow

```
Bot: "Ready to commit and push reef-agents v1.2.16:
- admin.service.ts — shop name in search traces SQL
- package.json — version bump

Reply `approved` to proceed or `denied` to abort."

User: "approved"

Bot: "✅ Committed and pushed: 9e15b61 → release/1.2"
```

## When to use

- ALWAYS when running on EC2 (no terminal)
- ALWAYS for: git commit, git push, npm publish, deploy triggers, file deletions, DB modifications
- NOT needed for: reading files, running tests, building, searching, fetching data

## Arguments

Pass the action description as the argument, e.g.:
  /request-approval commit and push reef-agents v1.2.16 with shop name changes
