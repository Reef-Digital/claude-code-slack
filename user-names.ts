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
): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!
  try {
    const result = await client.users.info({ user: userId })
    const name = pickUserName(result, userId)
    userNameCache.set(userId, name)
    return name
  } catch {
    return userId
  }
}
