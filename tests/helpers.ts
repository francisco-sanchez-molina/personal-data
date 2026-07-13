import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Config } from '../server/config'
import { openDb, type DB } from '../server/db'
import { createApp, type PushContext } from '../server/app'
import { signSession, SESSION_COOKIE, resetRateLimit } from '../server/auth'
import type { Hono } from 'hono'

export interface TestCtx {
  cfg: Config
  db: DB
  app: Hono
  cookie: string
  pushSent: { endpoint: string; payload: string }[]
  cleanup: () => void
}

export function makeCtx(overrides: Partial<Config> = {}): TestCtx {
  resetRateLimit()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
  const cfg: Config = {
    port: 0,
    dataDir,
    vaultDir: path.join(dataDir, 'vault'),
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'db.sqlite'),
    clientDir: path.join(dataDir, 'nonexistent-client'),
    appPassword: 'test-password',
    sessionSecret: 'test-secret-0123456789abcdef',
    mcpToken: 'test-mcp-token',
    isProd: false,
    ...overrides,
  }
  fs.mkdirSync(cfg.vaultDir, { recursive: true })
  fs.mkdirSync(cfg.uploadsDir, { recursive: true })
  const db = openDb(cfg.dbPath)
  const pushSent: { endpoint: string; payload: string }[] = []
  const push: PushContext = {
    publicKey: 'test-public-key',
    sender: async (sub, payload) => {
      pushSent.push({ endpoint: sub.endpoint, payload })
    },
  }
  const app = createApp(cfg, db, push)
  const cookie = `${SESSION_COOKIE}=${signSession(cfg.sessionSecret)}`
  return {
    cfg,
    db,
    app,
    cookie,
    pushSent,
    cleanup: () => {
      db.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Cookie: cookie, 'Content-Type': 'application/json' },
  }
}
