import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fullScan, indexNote, searchNotes } from '../server/indexer'
import { createEvent, searchEvents, eventBaseMs } from '../server/events'
import { writeNote } from '../server/vault'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('índice y búsqueda', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('busca sin distinguir acentos y por prefijo', () => {
    indexNote(ctx.db, 'cafes.md', '# Cafeterías\n\nEl mejor café de Móstoles.', Date.now(), 10)
    indexNote(ctx.db, 'otra.md', '# Otra\n\nNada que ver.', Date.now(), 10)

    expect(searchNotes(ctx.db, 'cafe').map((h) => h.path)).toEqual(['cafes.md'])
    expect(searchNotes(ctx.db, 'mostoles')[0].snippet).toContain('<mark>')
    expect(searchNotes(ctx.db, 'inexistente')).toEqual([])
  })

  it('no revienta con consultas raras', () => {
    expect(searchNotes(ctx.db, '"*')).toEqual([])
    expect(searchNotes(ctx.db, '   ')).toEqual([])
  })

  it('fullScan indexa notas escritas fuera de la app y purga borradas', () => {
    writeNote(ctx.cfg.vaultDir, 'externa.md', '# Externa\n\nEscrita con Obsidian.')
    let result = fullScan(ctx.db, ctx.cfg.vaultDir)
    expect(result.indexed).toBe(1)
    expect(searchNotes(ctx.db, 'obsidian')).toHaveLength(1)

    fs.rmSync(path.join(ctx.cfg.vaultDir, 'externa.md'))
    result = fullScan(ctx.db, ctx.cfg.vaultDir)
    expect(result.removed).toBe(1)
    expect(searchNotes(ctx.db, 'obsidian')).toEqual([])
  })

  it('la búsqueda vía API devuelve notas y eventos', async () => {
    await ctx.app.request('/api/note', authed(ctx.cookie, {
      method: 'POST',
      body: JSON.stringify({ path: 'entreno.md', content: '# Entreno\n\nSentadilla 5x5 con 100kg' }),
    }))
    const res = await ctx.app.request('/api/search?q=sentadilla', authed(ctx.cookie))
    const body = (await res.json()) as { notes: { path: string }[]; events: unknown[] }
    expect(body.notes.map((h) => h.path)).toEqual(['entreno.md'])
    expect(body.events).toEqual([])
  })
})

describe('búsqueda de eventos', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  const TODAY = '2026-07-13'

  const seed = () => {
    const base = eventBaseMs('2026-07-15', '09:30')
    createEvent(ctx.db, {
      title: 'Pediatra: revisión 18 meses',
      date: '2026-07-15',
      time: '09:30',
      notes: 'Llevar cartilla',
      reminders: [{ offsetMin: 60, remindAtMs: base - 3600_000 }],
    })
    createEvent(ctx.db, { title: 'Cumple de la abuela', date: '2026-07-20' })
    createEvent(ctx.db, { title: 'Revisión caldera', date: '2026-06-01' })
  }

  it('encuentra eventos sin distinguir acentos y devuelve sus recordatorios', () => {
    seed()
    const hits = searchEvents(ctx.db, 'revision', TODAY)
    expect(hits.map((e) => e.title)).toEqual(['Pediatra: revisión 18 meses', 'Revisión caldera'])
    expect(hits[0].reminders.map((r) => r.offset_min)).toEqual([60])
  })

  it('busca también en las notas del evento y ordena próximos primero', () => {
    seed()
    expect(searchEvents(ctx.db, 'cartilla', TODAY).map((e) => e.title)).toEqual(['Pediatra: revisión 18 meses'])
    expect(searchEvents(ctx.db, 'e', TODAY).map((e) => e.date)).toEqual(['2026-07-15', '2026-07-20', '2026-06-01'])
  })

  it('las consultas con #tag no devuelven eventos', () => {
    seed()
    expect(searchEvents(ctx.db, '#comida pediatra', TODAY)).toEqual([])
    expect(searchEvents(ctx.db, '   ', TODAY)).toEqual([])
  })
})
