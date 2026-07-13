import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isValidDate, journalRelPath, memoriesFor, monthSummary } from '../server/journal'
import { writeNote } from '../server/vault'
import { makeCtx, authed, type TestCtx } from './helpers'

describe('fechas', () => {
  it('valida fechas', () => {
    expect(isValidDate('2026-07-12')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false) // 2026 no es bisiesto
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('12-07-2026')).toBe(false)
    expect(isValidDate('x')).toBe(false)
  })

  it('genera la ruta del diario por año', () => {
    expect(journalRelPath('2026-07-12')).toBe('journal/2026/2026-07-12.md')
  })
})

describe('diario vía API', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('guarda y lee una entrada', async () => {
    let res = await ctx.app.request('/api/journal/2026-07-12', authed(ctx.cookie, {
      method: 'PUT',
      body: JSON.stringify({ content: '# 2026-07-12\n\nDía de series de 400m.' }),
    }))
    expect(res.status).toBe(200)

    res = await ctx.app.request('/api/journal/2026-07-12', authed(ctx.cookie))
    const day = (await res.json()) as { content: string; attachments: unknown[] }
    expect(day.content).toContain('series de 400m')
    expect(day.attachments).toEqual([])
  })

  it('rechaza fechas inválidas', async () => {
    const res = await ctx.app.request('/api/journal/2026-13-40', authed(ctx.cookie))
    expect(res.status).toBe(400)
  })

  it('una entrada sin crear devuelve content null', async () => {
    const res = await ctx.app.request('/api/journal/2020-01-01', authed(ctx.cookie))
    expect(((await res.json()) as { content: null }).content).toBeNull()
  })
})

describe('recuerdos y resumen mensual', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('encuentra entradas del mismo día en años anteriores', () => {
    writeNote(ctx.cfg.vaultDir, 'journal/2024/2024-07-12.md', '# 2024-07-12\n\nCarrera por el pantano.')
    writeNote(ctx.cfg.vaultDir, 'journal/2025/2025-07-12.md', '# 2025-07-12\n\nPaella en casa.')
    writeNote(ctx.cfg.vaultDir, 'journal/2025/2025-07-11.md', '# otro día\n\nNo debería salir.')
    ctx.db
      .prepare(
        "INSERT INTO attachments (date, filename, mime, size) VALUES ('2023-07-12', 'x.jpg', 'image/jpeg', 100)"
      )
      .run()

    const mems = memoriesFor(ctx.cfg, ctx.db, '2026-07-12')
    expect(mems.map((m) => m.date)).toEqual(['2025-07-12', '2024-07-12', '2023-07-12'])
    expect(mems[0].yearsAgo).toBe(1)
    expect(mems[0].excerpt).toContain('Paella')
    expect(mems[2].excerpt).toBeNull()
    expect(mems[2].attachments).toHaveLength(1)
  })

  it('ignora el 29 de febrero en años no bisiestos', () => {
    writeNote(ctx.cfg.vaultDir, 'journal/2024/2024-02-29.md', '# bisiesto\n\nSalto extra.')
    const mems = memoriesFor(ctx.cfg, ctx.db, '2026-02-28')
    expect(mems).toEqual([])
  })

  it('resumen mensual marca días con nota y con fotos', () => {
    writeNote(ctx.cfg.vaultDir, 'journal/2026/2026-07-12.md', 'hola')
    ctx.db
      .prepare(
        "INSERT INTO attachments (date, filename, mime, size) VALUES ('2026-07-03', 'y.jpg', 'image/jpeg', 100)"
      )
      .run()
    const days = monthSummary(ctx.cfg, ctx.db, '2026-07')
    expect(days).toEqual([
      { date: '2026-07-03', hasNote: false, attachmentCount: 1 },
      { date: '2026-07-12', hasNote: true, attachmentCount: 0 },
    ])
  })
})
