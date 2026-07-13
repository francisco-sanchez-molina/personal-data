import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractCoverImage, indexNote } from '../server/indexer'
import { collectionNotes, createCollection } from '../server/collections'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('extractCoverImage', () => {
  it('devuelve la url de la primera imagen embebida', () => {
    const md = '# Arroz con shiitake\n\n![arroz|400](/api/files/2026-07-13/1-arroz.jpg)\n\nIngredientes...'
    expect(extractCoverImage(md)).toBe('/api/files/2026-07-13/1-arroz.jpg')
  })

  it('ignora el alt y coge la url aunque no lleve ancho', () => {
    expect(extractCoverImage('texto\n\n![foto](/api/files/x/y.png)\n')).toBe('/api/files/x/y.png')
  })

  it('coge la primera si hay varias imágenes', () => {
    const md = '![a](/api/files/x/a.png)\n![b](/api/files/x/b.png)\n'
    expect(extractCoverImage(md)).toBe('/api/files/x/a.png')
  })

  it('devuelve null si la nota no tiene imágenes', () => {
    expect(extractCoverImage('# Título\n\nSolo texto, sin fotos.')).toBeNull()
  })

  it('no confunde un wikilink [[nota]] con una imagen', () => {
    expect(extractCoverImage('# Título\n\nVer [[otra nota]] para más info.')).toBeNull()
  })
})

describe('portada en el índice y en las colecciones', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('indexNote guarda la portada y collectionNotes la devuelve', () => {
    const col = createCollection(ctx.db, { name: 'Recetas' })
    indexNote(
      ctx.db,
      `${col.folder}/arroz.md`,
      '# Arroz\n\n![arroz|400](/api/files/2026-07-13/foto.jpg)\n\nRico.',
      Date.now(),
      50
    )
    indexNote(ctx.db, `${col.folder}/sin-foto.md`, '# Sin foto\n\nSolo texto.', Date.now(), 20)

    const notes = collectionNotes(ctx.db, col.folder)
    const withCover = notes.find((n) => n.path.endsWith('arroz.md'))
    const withoutCover = notes.find((n) => n.path.endsWith('sin-foto.md'))
    expect(withCover?.cover).toBe('/api/files/2026-07-13/foto.jpg')
    expect(withoutCover?.cover).toBeNull()
  })

  it('reeditar la nota actualiza la portada (o la quita)', () => {
    indexNote(ctx.db, 'x.md', '![a](/api/files/x/a.png)', Date.now(), 5)
    indexNote(ctx.db, 'x.md', 'ya no hay imagen', Date.now(), 5)
    const row = ctx.db.prepare('SELECT cover FROM notes_index WHERE path = ?').get('x.md') as { cover: string | null }
    expect(row.cover).toBeNull()
  })

  it('la API de colecciones expone cover', async () => {
    const col = (await (
      await ctx.app.request(
        '/api/collections',
        authed(ctx.cookie, { method: 'POST', body: JSON.stringify({ name: 'Recetas' }) })
      )
    ).json()) as { id: number; folder: string }
    await ctx.app.request(
      '/api/note',
      authed(ctx.cookie, {
        method: 'POST',
        body: JSON.stringify({
          path: `${col.folder}/tortilla.md`,
          content: '# Tortilla\n\n![tortilla|400](/api/files/2026-07-13/tortilla.jpg)\n',
        }),
      })
    )
    const { notes } = (await (
      await ctx.app.request(`/api/collections/${col.id}/notes`, authed(ctx.cookie))
    ).json()) as { notes: { cover: string | null }[] }
    expect(notes[0].cover).toBe('/api/files/2026-07-13/tortilla.jpg')
  })
})
