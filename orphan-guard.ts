// Orphan guard for the Slack plugin.
//
// Before starting our Socket Mode connection, terminate any prior
// `bun … server.ts` plugin instance still holding a websocket. Prevents two
// plugins racing on the same bot token after a crash or unclean claude
// restart.
//
// Two sources of stale pids are checked:
//  1. The authoritative `plugin.pid` file written by the previous healthy
//     instance. Fast path when the prior plugin had the guard code.
//  2. A `pgrep`-style scan of all live `bun … server.ts` processes. Catches
//     legacy orphans from pre-guard versions that never wrote a pidfile
//     (see: 2026-04-16 first-flight gap).
//
// All I/O — process.kill, ps command lookup, pgrep, sleep — is routed through
// an injectable `ProcessClient` so branches are unit-testable without touching
// real processes.
//
// Tests: test/orphan-guard.test.ts

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { execSync } from 'child_process'

export type ProcessClient = {
  kill: (pid: number, signal: number | NodeJS.Signals) => void
  lookupCommand: (pid: number) => string | null
  listBunServerTsPids: () => number[]
  sleep: (ms: number) => Promise<void>
}

export const defaultProcessClient: ProcessClient = {
  kill: (pid, signal) => {
    process.kill(pid, signal)
  },
  lookupCommand: (pid) => {
    try {
      return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  },
  listBunServerTsPids: () => {
    try {
      const out = execSync('pgrep -f "bun.*server\\.ts" || true', {
        encoding: 'utf8',
      })
      return out
        .trim()
        .split('\n')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    } catch {
      return []
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export function isLiveBunServerTs(
  pid: number,
  self: number,
  client: ProcessClient,
): boolean {
  if (!Number.isFinite(pid) || pid <= 0 || pid === self) return false
  try {
    client.kill(pid, 0)
  } catch {
    return false
  }
  const cmd = client.lookupCommand(pid)
  if (!cmd) return false
  return cmd.includes('bun') && cmd.includes('server.ts')
}

export type KillStalePluginOpts = {
  pidFile: string
  self: number
  client: ProcessClient
  log?: (msg: string) => void
  // Overridable for deterministic tests; defaults match v0.8.2 behaviour.
  sigtermWaitMs?: number
  sigtermStepMs?: number
  sigkillSettleMs?: number
}

export async function killStalePlugin(opts: KillStalePluginOpts): Promise<void> {
  const {
    pidFile,
    self,
    client,
    log = () => {},
    sigtermWaitMs = 2000,
    sigtermStepMs = 100,
    sigkillSettleMs = 300,
  } = opts

  const candidates = new Set<number>()

  if (existsSync(pidFile)) {
    try {
      const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
      if (Number.isFinite(pid) && pid > 0 && pid !== self) candidates.add(pid)
    } catch {}
  }

  for (const pid of client.listBunServerTsPids()) {
    if (pid !== self) candidates.add(pid)
  }

  for (const pid of candidates) {
    if (!isLiveBunServerTs(pid, self, client)) continue
    log(`slack channel: stale plugin PID ${pid} detected — terminating`)
    try {
      client.kill(pid, 'SIGTERM')
    } catch {}
    const steps = Math.max(1, Math.ceil(sigtermWaitMs / sigtermStepMs))
    let exited = false
    for (let i = 0; i < steps; i++) {
      if (!isLiveBunServerTs(pid, self, client)) {
        exited = true
        break
      }
      await client.sleep(sigtermStepMs)
    }
    if (!exited && isLiveBunServerTs(pid, self, client)) {
      log(`slack channel: PID ${pid} ignored SIGTERM — sending SIGKILL`)
      try {
        client.kill(pid, 'SIGKILL')
      } catch {}
      await client.sleep(sigkillSettleMs)
    }
  }
}

export function writePidFile(
  pidFile: string,
  self: number,
  log: (msg: string) => void = () => {},
): void {
  try {
    mkdirSync(dirname(pidFile), { recursive: true })
    writeFileSync(pidFile, String(self), { mode: 0o600 })
  } catch (err) {
    log(`slack channel: pidfile write failed: ${err}`)
  }
}

export function removePidFile(pidFile: string, self: number): void {
  try {
    if (!existsSync(pidFile)) return
    const owner = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
    if (owner === self) unlinkSync(pidFile)
  } catch {}
}
