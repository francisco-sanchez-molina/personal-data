import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { monthSummary, memoriesFor } from '../server/journal'
import { makeCtx, type TestCtx } from './helpers'

async function pngFile(name = 'captura.png'): Promise<File> {
  const buf = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .png()
    .toBuffer()
  return new File([new Uint8Array(buf)], name, { type: 'image/png' })
}

function multipart(cookie: string, file: File): RequestInit {
  const fd = new FormData()
  fd.append('files', file)
  return { method: 'POST', body: fd, headers: { Cookie: cookie } }
}

describe('imágenes pegadas en notas (context=note)', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  it('sube por /api/attachments, guarda fichero + thumb y marca context=note', async () => {
    const res = await ctx.app.request('/api/attachments', multipart(ctx.cookie, await pngFile()))
    expect(res.status).toBe(201)
    const [saved] = (await res.json()) as { date: string; filename: string; context: string }[]
    expect(saved.context).toBe('note')

    const dir = path.join(ctx.cfg.uploadsDir, saved.date)
    expect(fs.existsSync(path.join(dir, saved.filename))).toBe(true)
    expect(fs.existsSync(path.join(dir, saved.filename.replace(/\.[a-z]+$/, '') + '.thumb.jpg'))).toBe(true)

    // se puede servir
    const fileRes = await ctx.app.request(`/api/files/${saved.date}/${saved.filename}`, {
      headers: { Cookie: ctx.cookie },
    })
    expect(fileRes.status).toBe(200)
  })

  it('no aparece en la rejilla del diario ni en el resumen mensual ni en recuerdos', async () => {
    const res = await ctx.app.request('/api/attachments', multipart(ctx.cookie, await pngFile()))
    const [saved] = (await res.json()) as { date: string }[]

    const day = await ctx.app.request(`/api/journal/${saved.date}`, { headers: { Cookie: ctx.cookie } })
    expect(((await day.json()) as { attachments: unknown[] }).attachments).toEqual([])

    expect(monthSummary(ctx.cfg, ctx.db, saved.date.slice(0, 7))).toEqual([])

    const nextYear = `${Number(saved.date.slice(0, 4)) + 1}${saved.date.slice(4)}`
    expect(memoriesFor(ctx.cfg, ctx.db, nextYear)).toEqual([])
  })

  it('las fotos del diario siguen saliendo (context=journal)', async () => {
    const res = await ctx.app.request('/api/journal/2026-07-13/attachments', multipart(ctx.cookie, await pngFile('foto.png')))
    expect(res.status).toBe(201)
    const [saved] = (await res.json()) as { context: string }[]
    expect(saved.context).toBe('journal')

    const day = await ctx.app.request('/api/journal/2026-07-13', { headers: { Cookie: ctx.cookie } })
    expect(((await day.json()) as { attachments: unknown[] }).attachments).toHaveLength(1)

    const summary = monthSummary(ctx.cfg, ctx.db, '2026-07')
    expect(summary).toEqual([{ date: '2026-07-13', hasNote: false, attachmentCount: 1 }])
  })
})
