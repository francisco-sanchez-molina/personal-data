import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { slugify } from '../server/collections'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('slugify', () => {
  it('normaliza acentos, espacios y mayúsculas', () => {
    expect(slugify('Médico peque')).toBe('medico-peque')
    expect(slugify('Recetas')).toBe('recetas')
    expect(slugify('  Paella de mi Madre!!  ')).toBe('paella-de-mi-madre')
  })
})

describe('colecciones vía API', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  const post = (url: string, body: unknown) =>
    ctx.app.request(url, authed(ctx.cookie, { method: 'POST', body: JSON.stringify(body) }))

  it('crea una colección y deriva la carpeta del nombre', async () => {
    const res = await post('/api/collections', { name: 'Médico peque', icon: '🩺' })
    expect(res.status).toBe(201)
    const col = (await res.json()) as { folder: string; icon: string }
    expect(col.folder).toBe('medico-peque')
    expect(col.icon).toBe('🩺')
  })

  it('rechaza carpeta reservada y duplicados', async () => {
    expect((await post('/api/collections', { name: 'Journal' })).status).toBe(400)
    expect((await post('/api/collections', { name: 'Recetas' })).status).toBe(201)
    expect((await post('/api/collections', { name: 'Recetas' })).status).toBe(409)
  })

  it('crea notas desde plantilla con {{title}} y {{date}}', async () => {
    const col = (await (
      await post('/api/collections', {
        name: 'Recetas',
        icon: '🍲',
        template: '# {{title}}\n\nAñadida el {{date}}\n\n## Ingredientes\n\n## Pasos\n',
      })
    ).json()) as { id: number }

    const res = await post(`/api/collections/${col.id}/notes`, { title: 'Paella de mi madre' })
    expect(res.status).toBe(201)
    const { path } = (await res.json()) as { path: string }
    expect(path).toBe('recetas/paella-de-mi-madre.md')

    const note = await ctx.app.request(`/api/note?path=${encodeURIComponent(path)}`, authed(ctx.cookie))
    const { content } = (await note.json()) as { content: string }
    expect(content).toContain('# Paella de mi madre')
    expect(content).toContain('## Ingredientes')
    expect(content).toMatch(/Añadida el \d{4}-\d{2}-\d{2}/)

    // título duplicado → 409
    expect((await post(`/api/collections/${col.id}/notes`, { title: 'Paella de mi madre' })).status).toBe(409)
  })

  it('lista notas de la colección ordenadas y cuenta bien', async () => {
    const col = (await (await post('/api/collections', { name: 'Recetas' })).json()) as { id: number }
    await post(`/api/collections/${col.id}/notes`, { title: 'Lentejas' })
    await post(`/api/collections/${col.id}/notes`, { title: 'Tortilla' })

    const list = await ctx.app.request(`/api/collections/${col.id}/notes`, authed(ctx.cookie))
    const { notes } = (await list.json()) as { notes: { title: string }[] }
    expect(notes.map((n) => n.title).sort()).toEqual(['Lentejas', 'Tortilla'])

    const all = await ctx.app.request('/api/collections', authed(ctx.cookie))
    const cols = (await all.json()) as { noteCount: number }[]
    expect(cols[0].noteCount).toBe(2)
  })

  it('quitar la colección no borra las notas del vault', async () => {
    const col = (await (await post('/api/collections', { name: 'Recetas' })).json()) as { id: number }
    await post(`/api/collections/${col.id}/notes`, { title: 'Lentejas' })

    const del = await ctx.app.request(`/api/collections/${col.id}`, authed(ctx.cookie, { method: 'DELETE' }))
    expect(del.status).toBe(200)

    const note = await ctx.app.request('/api/note?path=recetas%2Flentejas.md', authed(ctx.cookie))
    expect(note.status).toBe(200)
  })

  it('las notas de colección salen en la búsqueda global', async () => {
    const col = (await (await post('/api/collections', { name: 'Médico peque' })).json()) as { id: number }
    await post(`/api/collections/${col.id}/notes`, { title: 'Vacuna 12 meses' })

    const res = await ctx.app.request('/api/search?q=vacuna', authed(ctx.cookie))
    const { notes } = (await res.json()) as { notes: { path: string }[] }
    expect(notes.map((h) => h.path)).toEqual(['medico-peque/vacuna-12-meses.md'])
  })
})
