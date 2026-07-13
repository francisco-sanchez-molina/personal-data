import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Config } from './config'

export const SESSION_COOKIE = 'vault_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 días

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function signSession(secret: string, now = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS)
  return `${exp}.${hmac(secret, exp)}`
}

export function verifySession(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false
  const expected = hmac(secret, exp)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  // Compara contra sí mismo si las longitudes difieren, para no filtrar la longitud por timing
  return ba.length === bb.length ? timingSafeEqual(ba, bb) : (timingSafeEqual(ba, ba), false)
}

export function requireAuth(cfg: Config) {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (!verifySession(cfg.sessionSecret, token)) {
      return c.json({ error: 'No autenticado' }, 401)
    }
    await next()
  }
}

// Rate limit sencillo en memoria: N intentos de login por minuto por IP
const attempts = new Map<string, number[]>()

export function checkLoginRateLimit(ip: string, max = 5, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    attempts.set(ip, recent)
    return false
  }
  recent.push(now)
  attempts.set(ip, recent)
  return true
}

export function resetRateLimit(): void {
  attempts.clear()
}
