import { describe, expect, it, beforeEach } from 'bun:test'
import {
  pickUserName,
  resolveMentions,
  resolveUserName,
  userNameCache,
} from '../user-names.ts'

beforeEach(() => {
  userNameCache.clear()
})

describe('pickUserName', () => {
  it('prefers profile.display_name', () => {
    expect(
      pickUserName(
        {
          user: {
            name: 'u_name',
            real_name: 'Real Name',
            profile: { display_name: 'Display' },
          },
        },
        'U1',
      ),
    ).toBe('Display')
  })

  it('falls back to real_name when display_name is empty', () => {
    expect(
      pickUserName(
        { user: { name: 'u_name', real_name: 'Real', profile: {} } },
        'U1',
      ),
    ).toBe('Real')
  })

  it('falls back to name when real_name is missing', () => {
    expect(pickUserName({ user: { name: 'handle' } }, 'U1')).toBe('handle')
  })

  it('falls back to the user ID when nothing else is set', () => {
    expect(pickUserName({}, 'U123')).toBe('U123')
    expect(pickUserName({ user: {} }, 'U123')).toBe('U123')
  })
})

function fakeClient(
  responses: Record<string, unknown>,
  hits = { count: 0 },
) {
  return {
    users: {
      info: async ({ user }: { user: string }) => {
        hits.count++
        if (responses[user] === 'throw') throw new Error('not_found')
        return responses[user] as any
      },
    },
  }
}

describe('resolveUserName', () => {
  it('resolves a user ID to display name via client', async () => {
    const client = fakeClient({
      U1: { user: { profile: { display_name: 'alice' } } },
    })
    expect(await resolveUserName('U1', client)).toBe('alice')
  })

  it('caches the resolved name (second call does not re-request)', async () => {
    const hits = { count: 0 }
    const client = fakeClient(
      { U1: { user: { profile: { display_name: 'alice' } } } },
      hits,
    )
    await resolveUserName('U1', client)
    await resolveUserName('U1', client)
    await resolveUserName('U1', client)
    expect(hits.count).toBe(1)
  })

  it('falls back to the user ID on API error and does not cache', async () => {
    const hits = { count: 0 }
    const client = fakeClient({ U_ERR: 'throw' }, hits)
    const logs: string[] = []
    expect(await resolveUserName('U_ERR', client, (m) => logs.push(m))).toBe(
      'U_ERR',
    )
    await resolveUserName('U_ERR', client, (m) => logs.push(m))
    expect(hits.count).toBe(2)
    expect(logs.length).toBe(2)
    expect(logs[0]).toContain('U_ERR')
    expect(logs[0]).toContain('failed')
  })

  it('surfaces Slack missing_scope error code through the logger', async () => {
    const client = {
      users: {
        info: async () => {
          const err = new Error('platform error') as Error & {
            data?: { error?: string }
          }
          err.data = { error: 'missing_scope' }
          throw err
        },
      },
    }
    const logs: string[] = []
    await resolveUserName('U1', client, (m) => logs.push(m))
    expect(logs[0]).toContain('missing_scope')
  })

  it('caches per-user — different IDs resolve independently', async () => {
    const client = fakeClient({
      U1: { user: { profile: { display_name: 'alice' } } },
      U2: { user: { real_name: 'Bob Builder' } },
    })
    expect(await resolveUserName('U1', client)).toBe('alice')
    expect(await resolveUserName('U2', client)).toBe('Bob Builder')
  })
})

describe('resolveMentions', () => {
  it('substitutes <@UXXX> with @displayName', async () => {
    const client = fakeClient({
      U1: { user: { profile: { display_name: 'alice' } } },
    })
    expect(
      await resolveMentions('Approved by <@U1> — thanks', client),
    ).toBe('Approved by @alice — thanks')
  })

  it('handles the <@UXXX|fallback> form', async () => {
    const client = fakeClient({
      U1: { user: { real_name: 'Alice Author' } },
    })
    expect(
      await resolveMentions('heads up <@U1|alice_fallback>', client),
    ).toBe('heads up @Alice Author')
  })

  it('resolves multiple distinct mentions in one text', async () => {
    const hits = { count: 0 }
    const client = fakeClient(
      {
        U1: { user: { profile: { display_name: 'alice' } } },
        U2: { user: { real_name: 'Bob' } },
      },
      hits,
    )
    expect(
      await resolveMentions('<@U1> and <@U2> and <@U1> again', client),
    ).toBe('@alice and @Bob and @alice again')
    // Same-id repetitions must not trigger extra users.info calls
    expect(hits.count).toBe(2)
  })

  it('leaves <@UXXX> intact when resolution fails', async () => {
    const client = fakeClient({ U_ERR: 'throw' })
    expect(
      await resolveMentions('ping <@U_ERR> now', client, () => {}),
    ).toBe('ping <@U_ERR> now')
  })

  it('returns text unchanged when there are no mentions', async () => {
    const client = fakeClient({})
    expect(await resolveMentions('no mentions here', client)).toBe(
      'no mentions here',
    )
  })

  it('ignores channel/subteam refs and only touches <@Uxxx>', async () => {
    const client = fakeClient({
      U1: { user: { profile: { display_name: 'alice' } } },
    })
    expect(
      await resolveMentions(
        'fyi <!channel> <!subteam^S123|devs> <@U1>',
        client,
      ),
    ).toBe('fyi <!channel> <!subteam^S123|devs> @alice')
  })

  it('shares the cache with resolveUserName', async () => {
    const hits = { count: 0 }
    const client = fakeClient(
      { U1: { user: { profile: { display_name: 'alice' } } } },
      hits,
    )
    await resolveUserName('U1', client)
    await resolveMentions('hi <@U1>', client)
    expect(hits.count).toBe(1)
  })
})
