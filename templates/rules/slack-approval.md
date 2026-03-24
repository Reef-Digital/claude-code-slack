# Slack Approval for Destructive Actions

When operating via Slack (messages arrive as `<channel>` tags, no terminal interaction), you MUST request human approval before any destructive or visible action.

## Actions requiring approval
- `git commit` / `git push`
- Deploy triggers (CI/CD, ECS)
- File deletion / overwriting
- Database modifications
- npm publish
- Any action that affects shared state

## Approval protocol
1. Post a clear summary to Slack: what, why, which files/repos
2. End with: "Reply `approved` to proceed or `denied` to abort."
3. Wait for user reply in the thread (poll with `fetch_thread`)
4. Only execute if user explicitly approves
5. If no response within 5 minutes, abort

## This rule is NON-NEGOTIABLE
- Never auto-commit or auto-push when running via Slack
- Never bypass approval by assuming consent
- Always show the full diff summary before requesting approval
