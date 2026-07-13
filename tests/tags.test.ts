import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractTags, indexNote, listTags, renameInIndex, removeFromIndex, searchNotes, tagsOf } from '../server/indexer'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('extractTags', () => {
  it('extrae hashtags inline sin confundir títulos', () => {
    const md = '# Lentejas\n\nUn clásico de invierno. #comida #legumbres #olla-rapida\n\n## Pasos\n'
    expect(extractTags(md)).toEqual(['comida', 'legumbres', 'olla-rapida'])
  })

  it('admite acentos, ñ y tags anidados estilo Obsidian', () => {
    expect(extractTags('receta de #niños con #puré #medico/vacunas')).toEqual(['medico/vacunas', 'niños', 'puré'])
  })

  it('extrae tags del frontmatter YAML (inline y lista)', () => {
    expect(extractTags('---\ntags: [comida, Cena]\n---\n# x\n')).toEqual(['cena', 'comida'])
    expect(extractTags('---\ntags:\n  - comida\n  - pollo\n---\n# x\n')).toEqual(['comida', 'pollo'])
  })

  it('deduplica y pasa a minúsculas', () => {
    expect(extractTags('#Comida y más #comida')).toEqual(['comida'])
  })

  it('ignora # sueltos, encabezados y texto sin tags', () => {
    expect(extractTags('# Título\n\n## Otro\n\nnada que ver # suelto')).toEqual([])
  })
})

describe('tags en el índice y búsqueda', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  const seed = () => {
    indexNote(ctx.db, 'recetas/lentejas.md', '# Lentejas\n\nCon chorizo. #comida #legumbres', Date.now(), 10)
    indexNote(ctx.db, 'recetas/crema.md', '# Crema de verduras\n\nLigerita. #cena #verduras', Date.now(), 10)
    indexNote(ctx.db, 'recetas/arroz.md', '# Arroz al horno\n\nDe aprovechamiento. #comida #arroz', Date.now(), 10)
  }

  it('indexa y cuenta tags', () => {
    seed()
    expect(tagsOf(ctx.db, 'recetas/lentejas.md')).toEqual(['comida', 'legumbres'])
    const tags = listTags(ctx.db)
    expect(tags.find((t) => t.tag === 'comida')?.count).toBe(2)
  })

  it('busca solo por tags (intersección)', () => {
    seed()
    expect(searchNotes(ctx.db, '#comida').map((h) => h.path).sort()).toEqual(['recetas/arroz.md', 'recetas/lentejas.md'])
    expect(searchNotes(ctx.db, '#comida #arroz').map((h) => h.path)).toEqual(['recetas/arroz.md'])
    expect(searchNotes(ctx.db, '#comida #verduras')).toEqual([])
  })

  it('combina texto libre con filtro de tag', () => {
    seed()
    const hits = searchNotes(ctx.db, '#comida horno')
    expect(hits.map((h) => h.path)).toEqual(['recetas/arroz.md'])
    expect(hits[0].tags).toEqual(['arroz', 'comida'])
    expect(hits[0].snippet).toContain('<mark>')
    // sin el tag, el texto encuentra lo mismo pero con más ámbito
    expect(searchNotes(ctx.db, 'horno').map((h) => h.path)).toEqual(['recetas/arroz.md'])
    // texto que existe pero en nota sin el tag
    expect(searchNotes(ctx.db, '#cena horno')).toEqual([])
  })

  it('renombrar y borrar mantienen los tags en orden', () => {
    seed()
    renameInIndex(ctx.db, 'recetas/lentejas.md', 'recetas/lentejas-abuela.md')
    expect(tagsOf(ctx.db, 'recetas/lentejas-abuela.md')).toEqual(['comida', 'legumbres'])
    removeFromIndex(ctx.db, 'recetas/lentejas-abuela.md')
    expect(listTags(ctx.db).find((t) => t.tag === 'legumbres')).toBeUndefined()
  })

  it('reeditar una nota sustituye sus tags', () => {
    indexNote(ctx.db, 'x.md', 'hola #viejo', Date.now(), 5)
    indexNote(ctx.db, 'x.md', 'hola #nuevo', Date.now(), 5)
    expect(tagsOf(ctx.db, 'x.md')).toEqual(['nuevo'])
  })

  it('los tags salen en la API de colecciones y en /api/tags', async () => {
    const col = (await (
      await ctx.app.request('/api/collections', authed(ctx.cookie, { method: 'POST', body: JSON.stringify({ name: 'Recetas' }) }))
    ).json()) as { id: number }
    await ctx.app.request('/api/note', authed(ctx.cookie, {
      method: 'POST',
      body: JSON.stringify({ path: 'recetas/tortilla.md', content: '# Tortilla\n\n#cena #huevos' }),
    }))
    const { notes } = (await (
      await ctx.app.request(`/api/collections/${col.id}/notes`, authed(ctx.cookie))
    ).json()) as { notes: { path: string; tags: string[] }[] }
    expect(notes[0].tags).toEqual(['cena', 'huevos'])

    const tags = (await (await ctx.app.request('/api/tags', authed(ctx.cookie))).json()) as { tag: string }[]
    expect(tags.map((t) => t.tag).sort()).toEqual(['cena', 'huevos'])
  })
})
