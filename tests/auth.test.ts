import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signSession, verifySession } from '../server/auth'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('sesiones', () => {
  const secret = 'secreto'

  it('firma y verifica un token válido', () => {
    const token = signSession(secret)
    expect(verifySession(secret, token)).toBe(true)
  })

  it('rechaza un token manipulado', () => {
    const token = signSession(secret)
    expect(verifySession(secret, token + 'x')).toBe(false)
    expect(verifySession(secret, 'x' + token)).toBe(false)
  })

  it('rechaza un token expirado', () => {
    const past = Date.now() - 60 * 24 * 60 * 60 * 1000
    const token = signSession(secret, past)
    expect(verifySession(secret, token)).toBe(false)
  })

  it('rechaza un token firmado con otro secreto', () => {
    expect(verifySession('otro', signSession(secret))).toBe(false)
  })
})

describe('endpoints de auth', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('login incorrecto devuelve 401', async () => {
    const res = await ctx.app.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'mal' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('login correcto devuelve cookie de sesión', async () => {
    const res = await ctx.app.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-password' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('vault_session=')
  })

  it('rate limit tras 5 intentos', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.app.request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'mal' }),
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const res = await ctx.app.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-password' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(429)
  })

  it('la API exige sesión', async () => {
    expect((await ctx.app.request('/api/tree')).status).toBe(401)
    expect((await ctx.app.request('/api/tree', authed(ctx.cookie))).status).toBe(200)
  })
})
