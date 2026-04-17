/**
 * Pure access-gate helpers.
 *
 * Two configuration sources feed the gate:
 *   1. Env vars (SLACK_OWNERS, SLACK_CHANNELS, SLACK_MENTION_REQUIRED) — the
 *      zero-file baseline. New users configure the plugin entirely via env.
 *   2. access.json (optional, managed by /slack:access + pairing flow) — adds
 *      per-user pairings and per-channel policy overrides on top of env.
 *
 * Precedence:
 *   - DM: allowed if sender is in env owners OR access.allowFrom.
 *   - Channel: an explicit access.groups[channelId] entry wins and its policy
 *     is applied exactly as stored. Otherwise, if the channel is in
 *     SLACK_CHANNELS, the env default applies (only env owners may trigger,
 *     SLACK_MENTION_REQUIRED controls mention policy). Otherwise, deny.
 *
 * These helpers live in their own module so the gate logic is testable in
 * isolation without booting the Bolt app or the MCP server.
 */

export type GroupPolicy = {
  requireMention: boolean
  allowFrom: string[]
}

export type AccessLike = {
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
}

/**
 * Parse SLACK_OWNERS env var into a deduped, trimmed list of Slack user IDs.
 * Empty / unset → empty list.
 */
export function envOwners(): string[] {
  return (process.env.SLACK_OWNERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Parse SLACK_CHANNELS env var into a list of Slack channel IDs.
 * Empty / unset → empty list. The bot must also be invited to each channel on
 * the Slack side — this env var only tells the plugin which channels to gate
 * through.
 */
export function envChannels(): string[] {
  return (process.env.SLACK_CHANNELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Default `true`. Only the literal string `"false"` flips it off. This makes
 * the env var unambiguous: any other value (including unset) keeps mentions
 * required, which is the safer default.
 */
export function envMentionRequired(): boolean {
  return process.env.SLACK_MENTION_REQUIRED !== 'false'
}

/**
 * DM allow check. A sender may DM the bot if they are listed in SLACK_OWNERS
 * OR present in access.allowFrom. Env and access.json are additive here — no
 * override semantics, just union.
 */
export function isDmAllowed(senderId: string, access: AccessLike): boolean {
  if (envOwners().includes(senderId)) return true
  if (access.allowFrom.includes(senderId)) return true
  return false
}

/**
 * Resolve the effective channel policy for a given channel. Returns:
 *   - The explicit access.groups entry when present (per-channel override).
 *   - The env-default policy when the channel appears in SLACK_CHANNELS but
 *     has no explicit entry. The env default restricts the `allowFrom` list
 *     to SLACK_OWNERS so channel messages from randos never reach Claude.
 *   - null when the channel is neither in access.groups nor in SLACK_CHANNELS.
 *     Callers must treat null as "drop".
 */
export function resolveGroupPolicy(
  channelId: string,
  access: AccessLike,
): GroupPolicy | null {
  const explicit = access.groups[channelId]
  if (explicit) {
    return {
      requireMention: explicit.requireMention ?? true,
      allowFrom: explicit.allowFrom ?? [],
    }
  }
  if (envChannels().includes(channelId)) {
    const owners = envOwners()
    // Env-default path: require a non-empty owner list. If SLACK_OWNERS is
    // unset we deny rather than fall through to "empty allowFrom = anyone",
    // because without any trusted sender the channel gate has no one to
    // recognise and would accept anyone who happened to be in the channel.
    if (owners.length === 0) return null
    return {
      requireMention: envMentionRequired(),
      allowFrom: owners,
    }
  }
  return null
}

/**
 * Apply a channel policy to a concrete (senderId) and return whether the
 * sender is permitted. `allowFrom.length === 0` means "anyone allowed" — this
 * preserves the existing access.json semantics and never kicks in for the
 * env-default policy, where we always stamp SLACK_OWNERS into `allowFrom`.
 */
export function isChannelSenderAllowed(
  senderId: string,
  policy: GroupPolicy,
): boolean {
  if (policy.allowFrom.length === 0) return true
  return policy.allowFrom.includes(senderId)
}
