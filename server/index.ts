import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { openDb } from './db'
import { fullScan } from './indexer'
import { createApp } from './app'
import { initWebPush, subscriptionCount } from './push'
import { startReminderLoop } from './scheduler'

const cfg = loadConfig()

if (!cfg.appPassword) {
  console.warn('⚠️  APP_PASSWORD no está definida: el login no funcionará. Copia .env.example a .env')
}
if (!cfg.sessionSecret) {
  console.warn('⚠️  SESSION_SECRET no está definida. Genera una con: openssl rand -hex 32')
}
if (!cfg.mcpToken) {
  console.warn('ℹ️  MCP_TOKEN no está definida: el endpoint /mcp queda deshabilitado')
}

const db = openDb(cfg.dbPath)
const scan = fullScan(db, cfg.vaultDir)
console.log(`🗂  Índice sincronizado: ${scan.indexed} notas indexadas, ${scan.removed} eliminadas`)

const push = initWebPush(cfg)
startReminderLoop(db, push.sender)
console.log(`🔔 Avisos push activos (${subscriptionCount(db)} dispositivos suscritos)`)

serve({ fetch: createApp(cfg, db, push).fetch, port: cfg.port }, (info) => {
  console.log(`📓 personal-vault escuchando en http://localhost:${info.port}`)
})
