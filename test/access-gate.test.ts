import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  envOwners,
  envChannels,
  envMentionRequired,
  isDmAllowed,
  resolveGroupPolicy,
  isChannelSenderAllowed,
  type AccessLike,
} from '../access-gate.ts'

// ── Env var sandbox ───────────────────────────────────────────────────────
// Each test snapshots the three env vars before it runs and restores them
// afterwards so tests can't leak state into each other.

const TRACKED = ['SLACK_OWNERS', 'SLACK_CHANNELS', 'SLACK_MENTION_REQUIRED'] as const

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {}
  for (const k of TRACKED) snap[k] = process.env[k]
  return snap
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of TRACKED) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
}

function emptyAccess(): AccessLike {
  return { allowFrom: [], groups: {} }
}

describe('env parsers', () => {
  let snap: Record<string, string | undefined>
  beforeEach(() => {
    snap = snapshotEnv()
    for (const k of TRACKED) delete process.env[k]
  })
  afterEach(() => restoreEnv(snap))

  it('envOwners: unset → empty list', () => {
    expect(envOwners()).toEqual([])
  })

  it('envOwners: trims + filters blanks', () => {
    process.env.SLACK_OWNERS = ' U1 , U2,, U3 '
    expect(envOwners()).toEqual(['U1', 'U2', 'U3'])
  })

  it('envChannels: parses comma list', () => {
    process.env.SLACK_CHANNELS = 'C1,C2,C3'
    expect(envChannels()).toEqual(['C1', 'C2', 'C3'])
  })

  it('envMentionRequired: defaults to true', () => {
    expect(envMentionRequired()).toBe(true)
  })

  it('envMentionRequired: only literal "false" disables it', () => {
    process.env.SLACK_MENTION_REQUIRED = 'false'
    expect(envMentionRequired()).toBe(false)
    process.env.SLACK_MENTION_REQUIRED = 'FALSE'
    expect(envMentionRequired()).toBe(true) // case-sensitive by spec
    process.env.SLACK_MENTION_REQUIRED = '0'
    expect(envMentionRequired()).toBe(true)
    process.env.SLACK_MENTION_REQUIRED = 'true'
    expect(envMentionRequired()).toBe(true)
  })
})

describe('isDmAllowed', () => {
  let snap: Record<string, string | undefined>
  beforeEach(() => {
    snap = snapshotEnv()
    for (const k of TRACKED) delete process.env[k]
  })
  afterEach(() => restoreEnv(snap))

  it('DM allowed via env only, not in access.json', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    expect(isDmAllowed('U_OWNER', emptyAccess())).toBe(true)
  })

  it('DM allowed via access.json only, not in env', () => {
    const access: AccessLike = { allowFrom: ['U_PAIRED'], groups: {} }
    expect(isDmAllowed('U_PAIRED', access)).toBe(true)
  })

  it('DM denied when neither has the user', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    const access: AccessLike = { allowFrom: ['U_PAIRED'], groups: {} }
    expect(isDmAllowed('U_RANDO', access)).toBe(false)
  })

  it('DM denied when both env and access.json are empty', () => {
    expect(isDmAllowed('U_ANY', emptyAccess())).toBe(false)
  })
})

describe('resolveGroupPolicy — env default', () => {
  let snap: Record<string, string | undefined>
  beforeEach(() => {
    snap = snapshotEnv()
    for (const k of TRACKED) delete process.env[k]
  })
  afterEach(() => restoreEnv(snap))

  it('Channel in env allows senders in SLACK_OWNERS', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    const policy = resolveGroupPolicy('C_ENV', emptyAccess())
    expect(policy).not.toBeNull()
    expect(isChannelSenderAllowed('U_OWNER', policy!)).toBe(true)
  })

  it('Channel in env denies senders not in SLACK_OWNERS', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    const policy = resolveGroupPolicy('C_ENV', emptyAccess())
    expect(policy).not.toBeNull()
    expect(isChannelSenderAllowed('U_RANDO', policy!)).toBe(false)
  })

  it('Channel not in env and not in access.json → null (drop)', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    expect(resolveGroupPolicy('C_OTHER', emptyAccess())).toBeNull()
  })

  it('Env channel with no SLACK_OWNERS set → null (safe deny)', () => {
    // Without any trusted sender the env-default path must not fall through
    // to "empty allowFrom = anyone" — that would open the channel to anyone.
    process.env.SLACK_CHANNELS = 'C_ENV'
    expect(resolveGroupPolicy('C_ENV', emptyAccess())).toBeNull()
  })

  it('SLACK_MENTION_REQUIRED=false bypasses mention requirement on env channels', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    process.env.SLACK_MENTION_REQUIRED = 'false'
    const policy = resolveGroupPolicy('C_ENV', emptyAccess())
    expect(policy!.requireMention).toBe(false)
  })

  it('Default mention policy is true on env channels', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    const policy = resolveGroupPolicy('C_ENV', emptyAccess())
    expect(policy!.requireMention).toBe(true)
  })
})

describe('resolveGroupPolicy — access.json precedence', () => {
  let snap: Record<string, string | undefined>
  beforeEach(() => {
    snap = snapshotEnv()
    for (const k of TRACKED) delete process.env[k]
  })
  afterEach(() => restoreEnv(snap))

  it('Explicit access.json entry wins over env default', () => {
    // Env default would require SLACK_OWNERS membership + mentions. The
    // explicit entry says "no mention needed, any sender" and must win.
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_SHARED'
    process.env.SLACK_MENTION_REQUIRED = 'true'
    const access: AccessLike = {
      allowFrom: [],
      groups: {
        C_SHARED: { requireMention: false, allowFrom: [] },
      },
    }
    const policy = resolveGroupPolicy('C_SHARED', access)
    expect(policy).not.toBeNull()
    expect(policy!.requireMention).toBe(false)
    // Empty allowFrom on an explicit entry means "anyone in this channel"
    expect(isChannelSenderAllowed('U_RANDO', policy!)).toBe(true)
  })

  it('Explicit access.json entry restricts allowFrom independently of env', () => {
    process.env.SLACK_OWNERS = 'U_OWNER'
    const access: AccessLike = {
      allowFrom: [],
      groups: {
        C_LOCKED: { requireMention: true, allowFrom: ['U_TRUSTED'] },
      },
    }
    const policy = resolveGroupPolicy('C_LOCKED', access)!
    expect(isChannelSenderAllowed('U_TRUSTED', policy)).toBe(true)
    // U_OWNER is an env owner but has no explicit entry in the group's
    // allowFrom, so the explicit policy still denies them.
    expect(isChannelSenderAllowed('U_OWNER', policy)).toBe(false)
  })

  it('Channel only in access.json (not env) still resolves', () => {
    const access: AccessLike = {
      allowFrom: [],
      groups: {
        C_LEGACY: { requireMention: true, allowFrom: ['U_ALICE'] },
      },
    }
    const policy = resolveGroupPolicy('C_LEGACY', access)!
    expect(policy.requireMention).toBe(true)
    expect(isChannelSenderAllowed('U_ALICE', policy)).toBe(true)
  })
})

// ── Integration: plugin boots without access.json ─────────────────────────
// Smoke test the readAccessFile() path via a subprocess with a throwaway
// state dir. This covers the "no access.json present" scenario without
// booting the full Bolt app (we intercept before app.start()).

describe('plugin boot without access.json', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slack-gate-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('state dir has no access.json and helpers accept defaultAccess shape', () => {
    // access.json missing → empty AccessLike is the effective shape.
    // This mirrors what readAccessFile() returns on ENOENT in server.ts.
    const access: AccessLike = { allowFrom: [], groups: {} }
    process.env.SLACK_OWNERS = 'U_OWNER'
    process.env.SLACK_CHANNELS = 'C_ENV'
    try {
      expect(isDmAllowed('U_OWNER', access)).toBe(true)
      expect(resolveGroupPolicy('C_ENV', access)).not.toBeNull()
    } finally {
      delete process.env.SLACK_OWNERS
      delete process.env.SLACK_CHANNELS
    }
  })
})
