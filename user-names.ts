// Resolve Slack user IDs to display names with per-process caching.

export const userNameCache = new Map<string, string>()

export type UserInfoLike = {
  user?: {
    name?: string
    real_name?: string
    profile?: { display_name?: string }
  }
}

export function pickUserName(info: UserInfoLike, userId: string): string {
  return (
    info.user?.profile?.display_name ||
    info.user?.real_name ||
    info.user?.name ||
    userId
  )
}

export type UsersInfoClient = {
  users: { info: (args: { user: string }) => Promise<UserInfoLike> }
}

export async function resolveUserName(
  userId: string,
  client: UsersInfoClient,
  logger: (msg: string) => void = (m) => process.stderr.write(m + '\n'),
): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!
  try {
    const result = await client.users.info({ user: userId })
    const name = pickUserName(result, userId)
    userNameCache.set(userId, name)
    return name
  } catch (err: unknown) {
    const code =
      (err as { data?: { error?: string } })?.data?.error ??
      (err as { message?: string })?.message ??
      String(err)
    logger(`resolveUserName(${userId}) failed: ${code}`)
    return userId
  }
}

// Slack renders user mentions in message text as `<@UXXXX>` or
// `<@UXXXX|fallback>`. Replace every such occurrence with `@<display name>`
// using resolveUserName (shares the per-process cache).
const MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g

export async function resolveMentions(
  text: string,
  client: UsersInfoClient,
  logger?: (msg: string) => void,
): Promise<string> {
  if (!text || !text.includes('<@')) return text
  const ids = new Set<string>()
  for (const m of text.matchAll(MENTION_RE)) ids.add(m[1])
  if (ids.size === 0) return text
  const resolved = new Map<string, string>()
  await Promise.all(
    Array.from(ids).map(async (id) => {
      resolved.set(id, await resolveUserName(id, client, logger))
    }),
  )
  return text.replace(MENTION_RE, (_, id: string) => {
    const name = resolved.get(id) ?? id
    return name === id ? `<@${id}>` : `@${name}`
  })
}
