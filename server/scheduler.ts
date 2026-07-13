import type { DB } from './db'
import { offsetLabel } from './events'
import { sendToAll, type PushSender } from './push'

/** Avisos más viejos que esto (servidor apagado mucho tiempo) se marcan sin enviar, para no spamear. */
const MAX_REMINDER_AGE_MS = 24 * 60 * 60 * 1000

interface DueRow {
  rid: number
  remind_at: number
  offset_min: number
  event_id: number
  title: string
  date: string
  time: string | null
}

export async function processDueReminders(db: DB, sender: PushSender, now = Date.now()): Promise<number> {
  const due = db
    .prepare(
      `SELECT r.id AS rid, r.remind_at, r.offset_min, r.event_id, e.title, e.date, e.time
       FROM event_reminders r JOIN events e ON e.id = r.event_id
       WHERE r.notified_at IS NULL AND r.remind_at <= ?
       ORDER BY r.remind_at`
    )
    .all(now) as DueRow[]
  let sent = 0
  for (const r of due) {
    if (now - r.remind_at <= MAX_REMINDER_AGE_MS) {
      const when = r.time ? `${r.date} · ${r.time}` : r.date
      await sendToAll(
        db,
        {
          title: `⏰ ${r.title}`,
          body: r.offset_min === 0 ? when : `${when} (${offsetLabel(r.offset_min)})`,
          url: `/calendar?date=${r.date}`,
          tag: `reminder-${r.rid}`,
        },
        sender
      )
      sent++
    }
    db.prepare('UPDATE event_reminders SET notified_at = ? WHERE id = ?').run(now, r.rid)
  }
  return sent
}

export function startReminderLoop(db: DB, sender: PushSender, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    processDueReminders(db, sender).catch((err) => console.error('recordatorios:', err))
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
