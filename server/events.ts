import type { DB } from './db'
import { VaultError } from './vault'

export interface ReminderRow {
  id: number
  event_id: number
  offset_min: number
  remind_at: number
  notified_at: number | null
}

export interface EventRow {
  id: number
  title: string
  date: string
  time: string | null
  notes: string | null
  created_at: string
  reminders: ReminderRow[]
}

export interface ReminderInput {
  offsetMin: number
  remindAtMs: number
}

export interface EventInput {
  title?: string
  date?: string
  time?: string | null
  notes?: string | null
  /** undefined = no tocar los avisos existentes; [] = quitarlos todos */
  reminders?: ReminderInput[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_OFFSET_MIN = 60 * 24 * 30 // 30 días
const MAX_REMINDERS = 8
/** Un aviso ya pasado al crear/editar se marca enviado (con este margen) para no disparar en el acto. */
const PAST_GRACE_MS = 60_000

function validate(input: EventInput): { title: string; date: string; time: string | null; notes: string | null } {
  const title = (input.title ?? '').trim()
  if (!title) throw new VaultError('Falta el título')
  if (title.length > 200) throw new VaultError('Título demasiado largo')
  const date = input.date ?? ''
  if (!DATE_RE.test(date)) throw new VaultError('Fecha inválida (YYYY-MM-DD)')
  const time = input.time || null
  if (time && !TIME_RE.test(time)) throw new VaultError('Hora inválida (HH:MM)')
  return { title, date, time, notes: input.notes?.trim() || null }
}

function validateReminders(reminders: ReminderInput[]): ReminderInput[] {
  if (reminders.length > MAX_REMINDERS) throw new VaultError(`Máximo ${MAX_REMINDERS} avisos por evento`)
  const seen = new Set<number>()
  const clean: ReminderInput[] = []
  for (const r of reminders) {
    if (!Number.isInteger(r?.offsetMin) || r.offsetMin < 0 || r.offsetMin > MAX_OFFSET_MIN) {
      throw new VaultError('Antelación de aviso inválida')
    }
    if (!Number.isFinite(r?.remindAtMs) || r.remindAtMs <= 0) throw new VaultError('Hora de aviso inválida')
    if (!seen.has(r.offsetMin)) {
      seen.add(r.offsetMin)
      clean.push({ offsetMin: r.offsetMin, remindAtMs: Math.floor(r.remindAtMs) })
    }
  }
  return clean
}

export function eventBaseMs(date: string, time: string | null): number {
  return new Date(`${date}T${time ?? '09:00'}:00`).getTime()
}

function remindersOf(db: DB, eventIds: number[]): Map<number, ReminderRow[]> {
  const map = new Map<number, ReminderRow[]>()
  if (eventIds.length === 0) return map
  const rows = db
    .prepare(
      `SELECT * FROM event_reminders WHERE event_id IN (${eventIds.map(() => '?').join(',')}) ORDER BY offset_min`
    )
    .all(...eventIds) as ReminderRow[]
  for (const r of rows) map.set(r.event_id, [...(map.get(r.event_id) ?? []), r])
  return map
}

function attach(db: DB, rows: Omit<EventRow, 'reminders'>[]): EventRow[] {
  const map = remindersOf(db, rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, reminders: map.get(r.id) ?? [] }))
}

function setReminders(db: DB, eventId: number, reminders: ReminderInput[], now: number): void {
  const existing = (db.prepare('SELECT * FROM event_reminders WHERE event_id = ?').all(eventId) as ReminderRow[])
  db.prepare('DELETE FROM event_reminders WHERE event_id = ?').run(eventId)
  const ins = db.prepare(
    'INSERT INTO event_reminders (event_id, offset_min, remind_at, notified_at) VALUES (?, ?, ?, ?)'
  )
  for (const r of reminders) {
    const prev = existing.find((e) => e.offset_min === r.offsetMin && e.remind_at === r.remindAtMs)
    let notifiedAt = prev?.notified_at ?? null
    if (notifiedAt === null && r.remindAtMs < now - PAST_GRACE_MS) notifiedAt = now
    ins.run(eventId, r.offsetMin, r.remindAtMs, notifiedAt)
  }
}

export function getEvent(db: DB, id: number): EventRow {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Omit<EventRow, 'reminders'> | undefined
  if (!row) throw new VaultError('El evento no existe', 404)
  return attach(db, [row])[0]
}

export function createEvent(db: DB, input: EventInput, now = Date.now()): EventRow {
  const v = validate(input)
  const reminders = validateReminders(input.reminders ?? [])
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO events (title, date, time, notes) VALUES (?, ?, ?, ?)')
      .run(v.title, v.date, v.time, v.notes)
    const id = Number(info.lastInsertRowid)
    setReminders(db, id, reminders, now)
    return id
  })
  return getEvent(db, tx())
}

export function updateEvent(db: DB, id: number, input: EventInput, now = Date.now()): EventRow {
  const current = getEvent(db, id)
  const v = validate({
    title: input.title ?? current.title,
    date: input.date ?? current.date,
    time: input.time !== undefined ? input.time : current.time,
    notes: input.notes !== undefined ? input.notes : current.notes,
  })
  const dateTimeChanged = v.date !== current.date || v.time !== current.time
  const tx = db.transaction(() => {
    db.prepare('UPDATE events SET title=?, date=?, time=?, notes=? WHERE id=?').run(
      v.title,
      v.date,
      v.time,
      v.notes,
      id
    )
    if (input.reminders !== undefined) {
      setReminders(db, id, validateReminders(input.reminders), now)
    } else if (dateTimeChanged) {
      // Sin lista nueva de avisos: conserva las antelaciones y recálcalas sobre la nueva fecha/hora
      const base = eventBaseMs(v.date, v.time)
      setReminders(
        db,
        id,
        current.reminders.map((r) => ({ offsetMin: r.offset_min, remindAtMs: base - r.offset_min * 60_000 })),
        now
      )
    }
  })
  tx()
  return getEvent(db, id)
}

export function deleteEvent(db: DB, id: number): void {
  getEvent(db, id)
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
}

export function eventsByMonth(db: DB, month: string): EventRow[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new VaultError('Mes inválido (YYYY-MM)')
  return attach(
    db,
    db
      .prepare("SELECT * FROM events WHERE date LIKE ? || '-%' ORDER BY date, time IS NULL, time, id")
      .all(month) as Omit<EventRow, 'reminders'>[]
  )
}

export function eventsInRange(db: DB, from: string, to: string): EventRow[] {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new VaultError('Rango inválido')
  return attach(
    db,
    db
      .prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, time IS NULL, time, id')
      .all(from, to) as Omit<EventRow, 'reminders'>[]
  )
}

export function upcomingEvents(db: DB, fromDate: string, limit = 10): EventRow[] {
  return attach(
    db,
    db
      .prepare('SELECT * FROM events WHERE date >= ? ORDER BY date, time IS NULL, time, id LIMIT ?')
      .all(fromDate, Math.min(limit, 100)) as Omit<EventRow, 'reminders'>[]
  )
}

/**
 * Busca eventos por texto libre en título y notas (sin distinguir acentos ni mayúsculas).
 * Los filtros #tag no aplican a eventos: si la consulta los lleva, no devuelve nada.
 * Orden: próximos primero (más cercano antes), luego pasados (más reciente antes).
 */
export function searchEvents(db: DB, query: string, today: string, limit = 10): EventRow[] {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  const tokens: string[] = []
  for (const raw of query.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('#')) return []
    const clean = raw.replace(/["*]/g, '')
    if (clean) tokens.push(norm(clean))
  }
  if (tokens.length === 0) return []

  const all = db.prepare('SELECT * FROM events').all() as Omit<EventRow, 'reminders'>[]
  const matches = all.filter((e) => {
    const haystack = norm(`${e.title} ${e.notes ?? ''}`)
    return tokens.every((t) => haystack.includes(t))
  })
  const upcoming = matches.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = matches.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date))
  return attach(db, [...upcoming, ...past].slice(0, limit))
}

/** "10 min antes", "1 día antes", "a la hora"… para cuerpos de notificación y UI. */
export function offsetLabel(min: number): string {
  if (min === 0) return 'a la hora'
  if (min % 10080 === 0) {
    const w = min / 10080
    return `${w} semana${w > 1 ? 's' : ''} antes`
  }
  if (min % 1440 === 0) {
    const d = min / 1440
    return `${d} día${d > 1 ? 's' : ''} antes`
  }
  if (min % 60 === 0) return `${min / 60} h antes`
  return `${min} min antes`
}
