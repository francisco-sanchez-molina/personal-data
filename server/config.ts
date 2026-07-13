import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'

export interface Config {
  port: number
  dataDir: string
  vaultDir: string
  uploadsDir: string
  dbPath: string
  clientDir: string
  appPassword: string
  sessionSecret: string
  mcpToken: string
  isProd: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? './data')
  const cfg: Config = {
    port: Number(env.PORT ?? 8787),
    dataDir,
    vaultDir: path.join(dataDir, 'vault'),
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'db.sqlite'),
    clientDir: path.resolve(env.CLIENT_DIR ?? './dist/client'),
    appPassword: env.APP_PASSWORD ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    mcpToken: env.MCP_TOKEN ?? '',
    isProd: env.NODE_ENV === 'production',
  }
  if (cfg.isProd && (!cfg.appPassword || !cfg.sessionSecret)) {
    throw new Error('APP_PASSWORD y SESSION_SECRET son obligatorias en producción')
  }
  fs.mkdirSync(cfg.vaultDir, { recursive: true })
  fs.mkdirSync(cfg.uploadsDir, { recursive: true })
  return cfg
}
