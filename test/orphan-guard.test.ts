import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isLiveBunServerTs,
  killStalePlugin,
  writePidFile,
  removePidFile,
  type ProcessClient,
} from '../orphan-guard.ts'

// ── Fake ProcessClient ──────────────────────────────────────────────────────

type FakeProcess = {
  pid: number
  cmd: string
  alive: boolean
  cooperative: boolean  // exits on SIGTERM if true, needs SIGKILL if false
}

function makeFakeClient(
  procs: FakeProcess[],
  opts: { onKill?: (pid: number, signal: number | NodeJS.Signals) => void } = {},
): {
  client: ProcessClient
  killCalls: Array<{ pid: number; signal: number | NodeJS.Signals }>
  sleeps: number[]
} {
  const killCalls: Array<{ pid: number; signal: number | NodeJS.Signals }> = []
  const sleeps: number[] = []
  const client: ProcessClient = {
    kill: (pid, signal) => {
      killCalls.push({ pid, signal })
      opts.onKill?.(pid, signal)
      const p = procs.find((x) => x.pid === pid)
      if (!p || !p.alive) {
        // signal 0 on dead pid → ESRCH
        const err = new Error('ESRCH') as Error & { code?: string }
        err.code = 'ESRCH'
        throw err
      }
      if (signal === 0) return
      if (signal === 'SIGTERM' && p.cooperative) p.alive = false
      if (signal === 'SIGKILL') p.alive = false
    },
    lookupCommand: (pid) => {
      const p = procs.find((x) => x.pid === pid && x.alive)
      return p ? p.cmd : null
    },
    listBunServerTsPids: () =>
      procs.filter((p) => p.alive && p.cmd.includes('bun') && p.cmd.includes('server.ts')).map((p) => p.pid),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }
  return { client, killCalls, sleeps }
}

// ── Temp pidfile helper ─────────────────────────────────────────────────────

let tmpRoot: string
let pidFile: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'orphan-guard-'))
  pidFile = join(tmpRoot, 'plugin.pid')
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

// ── isLiveBunServerTs ───────────────────────────────────────────────────────

describe('isLiveBunServerTs', () => {
  it('returns false for self pid', () => {
    const { client } = makeFakeClient([
      { pid: 100, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    expect(isLiveBunServerTs(100, 100, client)).toBe(false)
  })

  it('returns false for non-finite / non-positive pid', () => {
    const { client } = makeFakeClient([])
    expect(isLiveBunServerTs(0, 999, client)).toBe(false)
    expect(isLiveBunServerTs(-1, 999, client)).toBe(false)
    expect(isLiveBunServerTs(Number.NaN, 999, client)).toBe(false)
  })

  it('returns false when signal 0 throws (process dead)', () => {
    const { client } = makeFakeClient([
      { pid: 100, cmd: 'bun server.ts', alive: false, cooperative: true },
    ])
    expect(isLiveBunServerTs(100, 999, client)).toBe(false)
  })

  it('returns false when command lookup returns null', () => {
    const procs: FakeProcess[] = [
      { pid: 100, cmd: 'bun server.ts', alive: true, cooperative: true },
    ]
    const { client } = makeFakeClient(procs)
    // Custom: simulate ps failing for an otherwise-alive pid.
    client.lookupCommand = () => null
    expect(isLiveBunServerTs(100, 999, client)).toBe(false)
  })

  it('returns false for alive pid running different command', () => {
    const { client } = makeFakeClient([
      { pid: 100, cmd: 'node other.js', alive: true, cooperative: true },
    ])
    expect(isLiveBunServerTs(100, 999, client)).toBe(false)
  })

  it('returns true for alive bun server.ts process', () => {
    const { client } = makeFakeClient([
      { pid: 100, cmd: '/usr/local/bin/bun server.ts', alive: true, cooperative: true },
    ])
    expect(isLiveBunServerTs(100, 999, client)).toBe(true)
  })
})

// ── killStalePlugin ─────────────────────────────────────────────────────────

describe('killStalePlugin', () => {
  it('no-ops when pidfile missing and no other bun server.ts processes', async () => {
    const { client, killCalls } = makeFakeClient([])
    await killStalePlugin({ pidFile, self: 999, client })
    expect(killCalls.filter((c) => c.signal !== 0)).toHaveLength(0)
  })

  it('no-ops when pidfile contains a dead pid and pgrep finds nothing', async () => {
    writeFileSync(pidFile, '100')
    const { client, killCalls } = makeFakeClient([
      { pid: 100, cmd: 'bun server.ts', alive: false, cooperative: true },
    ])
    await killStalePlugin({ pidFile, self: 999, client })
    // No SIGTERM or SIGKILL issued (only signal-0 probes).
    expect(killCalls.some((c) => c.signal === 'SIGTERM' || c.signal === 'SIGKILL')).toBe(false)
  })

  it('kills cooperative pid via SIGTERM — no SIGKILL needed', async () => {
    writeFileSync(pidFile, '100')
    const { client, killCalls, sleeps } = makeFakeClient([
      { pid: 100, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({
      pidFile, self: 999, client,
      sigtermWaitMs: 200, sigtermStepMs: 50,
    })
    expect(killCalls.some((c) => c.pid === 100 && c.signal === 'SIGTERM')).toBe(true)
    expect(killCalls.some((c) => c.pid === 100 && c.signal === 'SIGKILL')).toBe(false)
    // Should not have waited the full 200ms — exits on first check after SIGTERM.
    expect(sleeps.length).toBeLessThan(4)
  })

  it('escalates to SIGKILL when process ignores SIGTERM', async () => {
    writeFileSync(pidFile, '100')
    const { client, killCalls } = makeFakeClient([
      { pid: 100, cmd: 'bun server.ts', alive: true, cooperative: false },
    ])
    await killStalePlugin({
      pidFile, self: 999, client,
      sigtermWaitMs: 100, sigtermStepMs: 50, sigkillSettleMs: 10,
    })
    expect(killCalls.some((c) => c.pid === 100 && c.signal === 'SIGTERM')).toBe(true)
    expect(killCalls.some((c) => c.pid === 100 && c.signal === 'SIGKILL')).toBe(true)
  })

  it('skips when pidfile points to self', async () => {
    writeFileSync(pidFile, '999')
    const { client, killCalls } = makeFakeClient([
      { pid: 999, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({ pidFile, self: 999, client })
    expect(killCalls.some((c) => c.signal === 'SIGTERM' || c.signal === 'SIGKILL')).toBe(false)
  })

  it('kills legacy orphan NOT in pidfile via pgrep scan — first-flight gap fix', async () => {
    // Pidfile doesn't exist — simulates legacy orphan from pre-guard version.
    const { client, killCalls } = makeFakeClient([
      { pid: 54283, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({
      pidFile, self: 67311, client,
      sigtermWaitMs: 100, sigtermStepMs: 50,
    })
    expect(killCalls.some((c) => c.pid === 54283 && c.signal === 'SIGTERM')).toBe(true)
  })

  it('kills multiple legacy orphans in a single pass', async () => {
    const { client, killCalls } = makeFakeClient([
      { pid: 54283, cmd: 'bun server.ts', alive: true, cooperative: true },
      { pid: 54284, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({
      pidFile, self: 67311, client,
      sigtermWaitMs: 100, sigtermStepMs: 50,
    })
    expect(killCalls.some((c) => c.pid === 54283 && c.signal === 'SIGTERM')).toBe(true)
    expect(killCalls.some((c) => c.pid === 54284 && c.signal === 'SIGTERM')).toBe(true)
  })

  it('does not kill self when pgrep returns self pid', async () => {
    const { client, killCalls } = makeFakeClient([
      { pid: 67311, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({ pidFile, self: 67311, client })
    expect(killCalls.some((c) => c.pid === 67311 && c.signal === 'SIGTERM')).toBe(false)
    expect(killCalls.some((c) => c.pid === 67311 && c.signal === 'SIGKILL')).toBe(false)
  })

  it('ignores non-bun-server.ts processes returned by pgrep', async () => {
    // Defensive: even if pgrep mis-matches, lookupCommand filter should reject.
    const procs: FakeProcess[] = [
      { pid: 100, cmd: 'node other.js', alive: true, cooperative: true },
    ]
    const { client, killCalls } = makeFakeClient(procs)
    // Force listBunServerTsPids to return pid 100 anyway.
    client.listBunServerTsPids = () => [100]
    await killStalePlugin({ pidFile, self: 999, client })
    expect(killCalls.some((c) => c.pid === 100 && c.signal === 'SIGTERM')).toBe(false)
  })

  it('deduplicates pidfile pid and pgrep pid (kills once, not twice)', async () => {
    writeFileSync(pidFile, '54283')
    const { client, killCalls } = makeFakeClient([
      { pid: 54283, cmd: 'bun server.ts', alive: true, cooperative: true },
    ])
    await killStalePlugin({
      pidFile, self: 999, client,
      sigtermWaitMs: 100, sigtermStepMs: 50,
    })
    const sigterms = killCalls.filter((c) => c.pid === 54283 && c.signal === 'SIGTERM')
    expect(sigterms).toHaveLength(1)
  })
})

// ── writePidFile / removePidFile ────────────────────────────────────────────

describe('writePidFile', () => {
  it('writes pid to file', () => {
    writePidFile(pidFile, 12345)
    expect(readFileSync(pidFile, 'utf8')).toBe('12345')
  })

  it('creates parent directory if missing', () => {
    const nested = join(tmpRoot, 'a', 'b', 'plugin.pid')
    writePidFile(nested, 12345)
    expect(existsSync(nested)).toBe(true)
  })
})

describe('removePidFile', () => {
  it('removes file when owner matches self', () => {
    writeFileSync(pidFile, '12345')
    removePidFile(pidFile, 12345)
    expect(existsSync(pidFile)).toBe(false)
  })

  it('leaves file intact when owner differs from self', () => {
    writeFileSync(pidFile, '67311')
    removePidFile(pidFile, 12345)
    expect(existsSync(pidFile)).toBe(true)
  })

  it('no-ops when file missing', () => {
    removePidFile(pidFile, 12345)
    expect(existsSync(pidFile)).toBe(false)
  })
})
