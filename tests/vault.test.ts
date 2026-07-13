import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safePath, VaultError } from '../server/vault'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('safePath', () => {
  const root = '/vault/root'

  it('acepta rutas normales', () => {
    expect(safePath(root, 'nota.md')).toBe('/vault/root/nota.md')
    expect(safePath(root, 'carpeta/sub/nota.md')).toBe('/vault/root/carpeta/sub/nota.md')
  })

  it('rechaza path traversal', () => {
    expect(() => safePath(root, '../fuera.md')).toThrow(VaultError)
    expect(() => safePath(root, 'a/../../fuera.md')).toThrow(VaultError)
    expect(() => safePath(root, '/etc/passwd.md')).toThrow(VaultError)
    expect(() => safePath(root, 'a/./b.md')).toThrow(VaultError)
  })

  it('rechaza ficheros ocultos y no-markdown', () => {
    expect(() => safePath(root, '.oculto.md')).toThrow(VaultError)
    expect(() => safePath(root, 'a/.git/x.md')).toThrow(VaultError)
    expect(() => safePath(root, 'script.sh')).toThrow(VaultError)
  })
})

describe('CRUD de notas vía API', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('crea, lee, renombra y borra una nota', async () => {
    let res = await ctx.app.request('/api/note', authed(ctx.cookie, {
      method: 'POST',
      body: JSON.stringify({ path: 'ideas/app.md', content: '# Mi app\n\nHola' }),
    }))
    expect(res.status).toBe(201)

    res = await ctx.app.request('/api/note?path=ideas%2Fapp.md', authed(ctx.cookie))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { content: string }).content).toContain('Mi app')

    // el árbol la muestra
    res = await ctx.app.request('/api/tree', authed(ctx.cookie))
    const tree = (await res.json()) as { name: string; children?: { path: string }[] }[]
    expect(JSON.stringify(tree)).toContain('ideas/app.md')

    // crear duplicada → 409
    res = await ctx.app.request('/api/note', authed(ctx.cookie, {
      method: 'POST',
      body: JSON.stringify({ path: 'ideas/app.md' }),
    }))
    expect(res.status).toBe(409)

    res = await ctx.app.request('/api/note/rename', authed(ctx.cookie, {
      method: 'POST',
      body: JSON.stringify({ from: 'ideas/app.md', to: 'proyectos/app.md' }),
    }))
    expect(res.status).toBe(200)

    res = await ctx.app.request('/api/note?path=proyectos%2Fapp.md', authed(ctx.cookie))
    expect(res.status).toBe(200)

    res = await ctx.app.request('/api/note?path=proyectos%2Fapp.md', authed(ctx.cookie, { method: 'DELETE' }))
    expect(res.status).toBe(200)

    res = await ctx.app.request('/api/note?path=proyectos%2Fapp.md', authed(ctx.cookie))
    expect(res.status).toBe(404)
  })
})
