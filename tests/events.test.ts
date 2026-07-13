import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { processDueReminders } from '../server/scheduler'
import { createEvent, updateEvent, offsetLabel, eventBaseMs } from '../server/events'
import { addSubscription, sendToAll, subscriptionCount, type PushSender } from '../server/push'
import { makeCtx, authed, type TestCtx } from './helpers'

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k1', auth: 'k2' } }

describe('eventos vía API', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  const post = (url: string, body: unknown) =>
    ctx.app.request(url, authed(ctx.cookie, { method: 'POST', body: JSON.stringify(body) }))

  it('crea un evento con varios avisos y los devuelve ordenados', async () => {
    const base = eventBaseMs('2099-08-03', '10:30')
    const res = await post('/api/events', {
      title: 'Pediatra',
      date: '2099-08-03',
      time: '10:30',
      reminders: [
        { offsetMin: 1440, remindAtMs: base - 1440 * 60_000 },
        { offsetMin: 10, remindAtMs: base - 10 * 60_000 },
      ],
    })
    expect(res.status).toBe(201)
    const ev = (await res.json()) as { id: number; reminders: { offset_min: number; notified_at: null }[] }
    expect(ev.reminders.map((r) => r.offset_min)).toEqual([10, 1440])
    expect(ev.reminders.every((r) => r.notified_at === null)).toBe(true)
  })

  it('valida antelaciones y deduplica', async () => {
    const base = eventBaseMs('2099-08-03', null)
    const bad = await post('/api/events', {
      title: 'x',
      date: '2099-08-03',
      reminders: [{ offsetMin: -5, remindAtMs: base }],
    })
    expect(bad.status).toBe(400)

    const dup = (await (
      await post('/api/events', {
        title: 'x',
        date: '2099-08-03',
        reminders: [
          { offsetMin: 10, remindAtMs: base - 600_000 },
          { offsetMin: 10, remindAtMs: base - 600_000 },
        ],
      })
    ).json()) as { reminders: unknown[] }
    expect(dup.reminders).toHaveLength(1)
  })

  it('un aviso ya pasado al crear queda marcado y no se dispara', async () => {
    const now = Date.now()
    const ev = createEvent(
      ctx.db,
      {
        title: 'hoy mismo',
        date: '2026-07-12',
        time: '18:00',
        reminders: [{ offsetMin: 1440, remindAtMs: now - 3600_000 }],
      },
      now
    )
    expect(ev.reminders[0].notified_at).not.toBeNull()
  })

  it('editar la fecha sin tocar avisos conserva antelaciones y recalcula', () => {
    const base = eventBaseMs('2099-08-03', '10:00')
    const ev = createEvent(ctx.db, {
      title: 'x',
      date: '2099-08-03',
      time: '10:00',
      reminders: [{ offsetMin: 60, remindAtMs: base - 3600_000 }],
    })
    const moved = updateEvent(ctx.db, ev.id, { date: '2099-09-01' })
    expect(moved.reminders[0].offset_min).toBe(60)
    expect(moved.reminders[0].remind_at).toBe(eventBaseMs('2099-09-01', '10:00') - 3600_000)
  })

  it('editar solo el título no reactiva avisos ya enviados', () => {
    const base = eventBaseMs('2099-08-03', '10:00')
    const ev = createEvent(ctx.db, {
      title: 'x',
      date: '2099-08-03',
      time: '10:00',
      reminders: [{ offsetMin: 10, remindAtMs: base - 600_000 }],
    })
    ctx.db.prepare('UPDATE event_reminders SET notified_at = 123 WHERE event_id = ?').run(ev.id)
    const edited = updateEvent(ctx.db, ev.id, {
      title: 'y',
      reminders: [{ offsetMin: 10, remindAtMs: base - 600_000 }],
    })
    expect(edited.reminders[0].notified_at).toBe(123)
  })

  it('borrar el evento arrastra sus avisos (cascade)', async () => {
    const base = eventBaseMs('2099-08-03', null)
    const ev = (await (
      await post('/api/events', {
        title: 'x',
        date: '2099-08-03',
        reminders: [{ offsetMin: 0, remindAtMs: base }],
      })
    ).json()) as { id: number }
    await ctx.app.request(`/api/events/${ev.id}`, authed(ctx.cookie, { method: 'DELETE' }))
    const left = ctx.db.prepare('SELECT COUNT(*) AS n FROM event_reminders').get() as { n: number }
    expect(left.n).toBe(0)
  })

  it('etiquetas de antelación legibles', () => {
    expect(offsetLabel(0)).toBe('a la hora')
    expect(offsetLabel(10)).toBe('10 min antes')
    expect(offsetLabel(90)).toBe('90 min antes')
    expect(offsetLabel(120)).toBe('2 h antes')
    expect(offsetLabel(1440)).toBe('1 día antes')
    expect(offsetLabel(2880)).toBe('2 días antes')
    expect(offsetLabel(10080)).toBe('1 semana antes')
  })
})

describe('avisos push', () => {
  let ctx: TestCtx
  beforeEach(() => (ctx = makeCtx()))
  afterEach(() => ctx.cleanup())

  const fakeSender: PushSender = async (sub, payload) => {
    ctx.pushSent.push({ endpoint: sub.endpoint, payload })
  }

  it('suscribe dispositivos vía API y envía prueba', async () => {
    let res = await ctx.app.request('/api/push/subscribe', authed(ctx.cookie, { method: 'POST', body: JSON.stringify(SUB) }))
    expect(res.status).toBe(201)
    expect(subscriptionCount(ctx.db)).toBe(1)

    res = await ctx.app.request('/api/push/test', authed(ctx.cookie, { method: 'POST' }))
    expect(((await res.json()) as { sent: number }).sent).toBe(1)
    expect(ctx.pushSent[0].payload).toContain('Personal Vault')
  })

  it('cada aviso de un evento se dispara por separado y una sola vez', async () => {
    addSubscription(ctx.db, SUB)
    const now = Date.now()
    const base = now + 30 * 60_000 // evento en 30 min
    createEvent(
      ctx.db,
      {
        title: 'Pediatra',
        date: '2026-07-12',
        time: '10:00',
        reminders: [
          { offsetMin: 1440, remindAtMs: now - 60_000 * 5 }, // venció hace 5 min
          { offsetMin: 10, remindAtMs: base - 600_000 }, // vence en 20 min
        ],
      },
      now - 10 * 60_000 // creado hace 10 min, cuando ambos avisos aún eran futuros
    )
    expect(await processDueReminders(ctx.db, fakeSender, now)).toBe(1)
    expect(ctx.pushSent).toHaveLength(1)
    expect(ctx.pushSent[0].payload).toContain('1 día antes')

    // el segundo aviso aún no toca
    expect(await processDueReminders(ctx.db, fakeSender, now + 60_000)).toBe(0)

    // llega su hora → se envía, y no se repite
    expect(await processDueReminders(ctx.db, fakeSender, base - 500_000)).toBe(1)
    expect(ctx.pushSent).toHaveLength(2)
    expect(await processDueReminders(ctx.db, fakeSender, base)).toBe(0)
  })

  it('avisos de hace más de 24h se descartan sin enviar', async () => {
    addSubscription(ctx.db, SUB)
    const now = Date.now()
    createEvent(
      ctx.db,
      {
        title: 'viejo',
        date: '2026-07-01',
        reminders: [{ offsetMin: 0, remindAtMs: now - 25 * 3600 * 1000 }],
      },
      now - 26 * 3600 * 1000
    )
    expect(await processDueReminders(ctx.db, fakeSender, now)).toBe(0)
    expect(ctx.pushSent).toHaveLength(0)
    expect(await processDueReminders(ctx.db, fakeSender, now + 1000)).toBe(0)
  })

  it('purga suscripciones caducadas (410)', async () => {
    addSubscription(ctx.db, SUB)
    addSubscription(ctx.db, { endpoint: 'https://push.example/dead', keys: { p256dh: 'a', auth: 'b' } })
    const sender: PushSender = async (sub, payload) => {
      if (sub.endpoint.endsWith('/dead')) {
        const err = new Error('gone') as Error & { statusCode: number }
        err.statusCode = 410
        throw err
      }
      ctx.pushSent.push({ endpoint: sub.endpoint, payload })
    }
    const result = await sendToAll(ctx.db, { title: 't', body: 'b', url: '/' }, sender)
    expect(result).toEqual({ sent: 1, removed: 1 })
    expect(subscriptionCount(ctx.db)).toBe(1)
  })
})
