import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'
import type { Config } from './config'
import type { DB } from './db'
import { VaultError } from './vault'

export interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

/** Envía un payload a una suscripción. Debe lanzar con .statusCode en errores HTTP. */
export type PushSender = (sub: SubscriptionRow, payload: string) => Promise<unknown>

interface VapidKeys {
  publicKey: string
  privateKey: string
}

/** Carga las claves VAPID de data/vapid.json, generándolas la primera vez. */
export function ensureVapidKeys(dataDir: string): VapidKeys {
  const file = path.join(dataDir, 'vapid.json')
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as VapidKeys
  }
  const keys = webpush.generateVAPIDKeys()
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 })
  return keys
}

export function initWebPush(cfg: Config): { publicKey: string; sender: PushSender } {
  const keys = ensureVapidKeys(cfg.dataDir)
  const subject = process.env.VAPID_SUBJECT || 'mailto:vault@localhost.local'
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey)
  const sender: PushSender = (sub, payload) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
  return { publicKey: keys.publicKey, sender }
}

export function addSubscription(db: DB, sub: unknown): void {
  const s = sub as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) {
    throw new VaultError('Suscripción push inválida')
  }
  db.prepare(
    'INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth'
  ).run(s.endpoint, s.keys.p256dh, s.keys.auth)
}

export function removeSubscription(db: DB, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}

export function subscriptionCount(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n
}

/** Envía a todos los dispositivos suscritos; purga las suscripciones caducadas (404/410). */
export async function sendToAll(
  db: DB,
  payload: PushPayload,
  sender: PushSender
): Promise<{ sent: number; removed: number }> {
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as SubscriptionRow[]
  const body = JSON.stringify(payload)
  let sent = 0
  let removed = 0
  for (const sub of subs) {
    try {
      await sender(sub, body)
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        removeSubscription(db, sub.endpoint)
        removed++
      } else {
        console.error(`push a ${sub.endpoint.slice(0, 40)}… falló:`, err instanceof Error ? err.message : err)
      }
    }
  }
  return { sent, removed }
}
