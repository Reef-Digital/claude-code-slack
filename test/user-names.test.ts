import { describe, expect, it, beforeEach } from 'bun:test'
import {
  pickUserName,
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
    expect(await resolveUserName('U_ERR', client)).toBe('U_ERR')
    await resolveUserName('U_ERR', client)
    expect(hits.count).toBe(2)
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
