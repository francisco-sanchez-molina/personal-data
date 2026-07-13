import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Config } from './config'
import type { DB } from './db'
import * as vaultFs from './vault'
import { VaultError } from './vault'
import { indexNote, removeFromIndex, renameInIndex, searchNotes, listTags } from './indexer'
import {
  isValidDate,
  journalRelPath,
  readJournalDay,
  monthSummary,
  memoriesFor,
} from './journal'
import { saveAttachment, deleteAttachment, uploadFilePath } from './attachments'
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  collectionNotes,
  createNoteInCollection,
} from './collections'
import { createEvent, updateEvent, deleteEvent, eventsByMonth, upcomingEvents, searchEvents } from './events'
import { addSubscription, removeSubscription, subscriptionCount, sendToAll, type PushSender } from './push'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  safeEqual,
  requireAuth,
  checkLoginRateLimit,
} from './auth'
import { mcpHandler } from './mcp'

export interface PushContext {
  publicKey: string | null
  sender: PushSender | null
}

export function createApp(cfg: Config, db: DB, push: PushContext = { publicKey: null, sender: null }): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof VaultError) {
      return c.json({ error: err.message }, err.status as 400)
    }
    console.error(err)
    return c.json({ error: 'Error interno' }, 500)
  })

  // ---------- Auth ----------
  app.post('/api/login', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!checkLoginRateLimit(ip)) {
      return c.json({ error: 'Demasiados intentos, espera un minuto' }, 429)
    }
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string })
    if (!cfg.appPassword || !body.password || !safeEqual(body.password, cfg.appPassword)) {
      return c.json({ error: 'Contraseña incorrecta' }, 401)
    }
    setCookie(c, SESSION_COOKIE, signSession(cfg.sessionSecret), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: cfg.isProd,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    })
    return c.json({ ok: true })
  })

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // ---------- API protegida ----------
  const api = new Hono()
  api.use('*', requireAuth(cfg))

  api.get('/me', (c) => c.json({ ok: true }))

  api.get('/tree', (c) => c.json(vaultFs.listTree(cfg.vaultDir)))

  api.get('/note', (c) => {
    const rel = c.req.query('path') ?? ''
    return c.json({ path: rel, content: vaultFs.readNote(cfg.vaultDir, rel) })
  })

  api.put('/note', async (c) => {
    const { path: rel, content } = await c.req.json<{ path: string; content: string }>()
    if (typeof content !== 'string') throw new VaultError('Falta content')
    vaultFs.writeNote(cfg.vaultDir, rel, content)
    indexNote(db, rel, content, Date.now(), Buffer.byteLength(content))
    return c.json({ ok: true })
  })

  api.post('/note', async (c) => {
    const { path: rel, content = '' } = await c.req.json<{ path: string; content?: string }>()
    if (vaultFs.noteExists(cfg.vaultDir, rel)) throw new VaultError('La nota ya existe', 409)
    vaultFs.writeNote(cfg.vaultDir, rel, content)
    indexNote(db, rel, content, Date.now(), Buffer.byteLength(content))
    return c.json({ ok: true, path: rel }, 201)
  })

  api.delete('/note', (c) => {
    const rel = c.req.query('path') ?? ''
    vaultFs.deleteNote(cfg.vaultDir, rel)
    removeFromIndex(db, rel)
    return c.json({ ok: true })
  })

  api.post('/note/rename', async (c) => {
    const { from, to } = await c.req.json<{ from: string; to: string }>()
    vaultFs.renameNote(cfg.vaultDir, from, to)
    renameInIndex(db, from, to)
    return c.json({ ok: true })
  })

  api.get('/search', (c) => {
    const q = c.req.query('q') ?? ''
    if (!q.trim()) return c.json({ notes: [], events: [] })
    const today = new Date().toISOString().slice(0, 10)
    return c.json({ notes: searchNotes(db, q), events: searchEvents(db, q, today) })
  })

  api.get('/tags', (c) => c.json(listTags(db)))

  // ---------- Diario ----------
  api.get('/journal/month', (c) => {
    const month = c.req.query('month') ?? ''
    return c.json(monthSummary(cfg, db, month))
  })

  api.get('/journal/:date', (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) throw new VaultError('Fecha inválida')
    return c.json(readJournalDay(cfg, db, date))
  })

  api.put('/journal/:date', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) throw new VaultError('Fecha inválida')
    const { content } = await c.req.json<{ content: string }>()
    if (typeof content !== 'string') throw new VaultError('Falta content')
    const rel = journalRelPath(date)
    vaultFs.writeNote(cfg.vaultDir, rel, content)
    indexNote(db, rel, content, Date.now(), Buffer.byteLength(content))
    return c.json({ ok: true })
  })

  api.post('/journal/:date/attachments', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) throw new VaultError('Fecha inválida')
    const body = await c.req.parseBody({ all: true })
    const raw = body['files'] ?? body['file']
    const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File)
    if (files.length === 0) throw new VaultError('No se ha enviado ningún archivo')
    const saved = []
    for (const f of files) saved.push(await saveAttachment(cfg, db, date, f))
    return c.json(saved, 201)
  })

  api.delete('/attachments/:id', (c) => {
    deleteAttachment(cfg, db, Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  // ---------- Colecciones ----------
  api.get('/collections', (c) => c.json(listCollections(db)))

  api.post('/collections', async (c) => {
    const body = await c.req.json<{ name?: string; icon?: string; folder?: string; template?: string }>()
    return c.json(createCollection(db, body), 201)
  })

  api.put('/collections/:id', async (c) => {
    const body = await c.req.json<{ name?: string; icon?: string; template?: string; position?: number }>()
    return c.json(updateCollection(db, Number(c.req.param('id')), body))
  })

  api.delete('/collections/:id', (c) => {
    deleteCollection(db, Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  api.get('/collections/:id/notes', (c) => {
    const col = getCollection(db, Number(c.req.param('id')))
    return c.json({ collection: col, notes: collectionNotes(db, col.folder) })
  })

  api.post('/collections/:id/notes', async (c) => {
    const col = getCollection(db, Number(c.req.param('id')))
    const { title } = await c.req.json<{ title: string }>()
    const today = new Date().toISOString().slice(0, 10)
    return c.json(createNoteInCollection(cfg, db, col, title ?? '', today), 201)
  })

  // ---------- Agenda ----------
  api.get('/events', (c) => c.json(eventsByMonth(db, c.req.query('month') ?? '')))

  api.get('/events/upcoming', (c) => {
    const today = new Date().toISOString().slice(0, 10)
    return c.json(upcomingEvents(db, today, Number(c.req.query('limit') ?? 10)))
  })

  api.post('/events', async (c) => c.json(createEvent(db, await c.req.json()), 201))

  api.put('/events/:id', async (c) => c.json(updateEvent(db, Number(c.req.param('id')), await c.req.json())))

  api.delete('/events/:id', (c) => {
    deleteEvent(db, Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  // ---------- Push ----------
  api.get('/push/key', (c) => {
    if (!push.publicKey) return c.json({ error: 'Push no configurado' }, 503)
    return c.json({ publicKey: push.publicKey, devices: subscriptionCount(db) })
  })

  api.post('/push/subscribe', async (c) => {
    addSubscription(db, await c.req.json())
    return c.json({ ok: true, devices: subscriptionCount(db) }, 201)
  })

  api.post('/push/unsubscribe', async (c) => {
    const { endpoint } = await c.req.json<{ endpoint?: string }>()
    if (endpoint) removeSubscription(db, endpoint)
    return c.json({ ok: true })
  })

  api.post('/push/test', async (c) => {
    if (!push.sender) return c.json({ error: 'Push no configurado' }, 503)
    const result = await sendToAll(
      db,
      { title: '📓 Personal Vault', body: 'Los avisos funcionan en este dispositivo 🎉', url: '/calendar' },
      push.sender
    )
    return c.json(result)
  })

  api.get('/memories', (c) => {
    const date = c.req.query('date') ?? ''
    if (!isValidDate(date)) throw new VaultError('Fecha inválida')
    return c.json(memoriesFor(cfg, db, date))
  })

  api.get('/files/:date/:filename', (c) => {
    const abs = uploadFilePath(cfg, c.req.param('date'), c.req.param('filename'))
    const ext = path.extname(abs).toLowerCase()
    const mime =
      { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[
        ext
      ] ?? 'application/octet-stream'
    const data = fs.readFileSync(abs)
    c.header('Content-Type', mime)
    c.header('Cache-Control', 'private, max-age=31536000, immutable')
    return c.body(new Uint8Array(data).buffer as ArrayBuffer)
  })

  app.route('/api', api)

  // ---------- MCP ----------
  app.all('/mcp', mcpHandler(cfg, db))

  // ---------- SPA estática (producción) ----------
  if (fs.existsSync(cfg.clientDir)) {
    const staticRoot = path.relative(process.cwd(), cfg.clientDir) || '.'
    app.use('/*', serveStatic({ root: staticRoot }))
    const indexHtml = fs.readFileSync(path.join(cfg.clientDir, 'index.html'), 'utf-8')
    app.get('*', (c) => c.html(indexHtml))
  }

  return app
}
