import fs from 'node:fs'
import path from 'node:path'
import type { Config } from './config'
import type { DB } from './db'
import { readNote, noteExists } from './vault'
import type { AttachmentRow } from './attachments'
import { attachmentsForDate } from './attachments'

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function journalRelPath(date: string): string {
  return `journal/${date.slice(0, 4)}/${date}.md`
}

export interface JournalDay {
  date: string
  content: string | null
  attachments: AttachmentRow[]
}

export function readJournalDay(cfg: Config, db: DB, date: string): JournalDay {
  const rel = journalRelPath(date)
  const content = noteExists(cfg.vaultDir, rel) ? readNote(cfg.vaultDir, rel) : null
  return { date, content, attachments: attachmentsForDate(db, date) }
}

export interface MonthDay {
  date: string
  hasNote: boolean
  attachmentCount: number
}

/** Días de un mes (YYYY-MM) que tienen nota de diario o adjuntos. */
export function monthSummary(cfg: Config, db: DB, month: string): MonthDay[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const days = new Map<string, MonthDay>()
  const yearDir = path.join(cfg.vaultDir, 'journal', month.slice(0, 4))
  if (fs.existsSync(yearDir)) {
    for (const f of fs.readdirSync(yearDir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
      if (m && m[1].startsWith(month)) {
        days.set(m[1], { date: m[1], hasNote: true, attachmentCount: 0 })
      }
    }
  }
  const rows = db
    .prepare("SELECT date, COUNT(*) AS n FROM attachments WHERE date LIKE ? || '-%' GROUP BY date")
    .all(month) as { date: string; n: number }[]
  for (const r of rows) {
    const d = days.get(r.date) ?? { date: r.date, hasNote: false, attachmentCount: 0 }
    d.attachmentCount = r.n
    days.set(r.date, d)
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface Memory {
  date: string
  yearsAgo: number
  excerpt: string | null
  attachments: AttachmentRow[]
}

/** "Tal día como hoy": entradas y fotos del mismo día MM-DD en años anteriores. */
export function memoriesFor(cfg: Config, db: DB, date: string): Memory[] {
  const monthDay = date.slice(5)
  const currentYear = Number(date.slice(0, 4))
  const years = new Set<number>()

  const journalDir = path.join(cfg.vaultDir, 'journal')
  if (fs.existsSync(journalDir)) {
    for (const y of fs.readdirSync(journalDir)) {
      if (/^\d{4}$/.test(y)) years.add(Number(y))
    }
  }
  const attachYears = db
    .prepare("SELECT DISTINCT substr(date, 1, 4) AS y FROM attachments WHERE substr(date, 6) = ?")
    .all(monthDay) as { y: string }[]
  for (const r of attachYears) years.add(Number(r.y))

  const memories: Memory[] = []
  for (const year of [...years].filter((y) => y < currentYear).sort((a, b) => b - a)) {
    const pastDate = `${year}-${monthDay}`
    if (!isValidDate(pastDate)) continue // 29 de febrero en años no bisiestos
    const rel = journalRelPath(pastDate)
    const attachments = attachmentsForDate(db, pastDate)
    let excerpt: string | null = null
    if (noteExists(cfg.vaultDir, rel)) {
      excerpt = makeExcerpt(readNote(cfg.vaultDir, rel))
    }
    if (excerpt || attachments.length > 0) {
      memories.push({ date: pastDate, yearsAgo: currentYear - year, excerpt, attachments })
    }
  }
  return memories
}

function makeExcerpt(content: string, maxLen = 280): string | null {
  const text = content
    .replace(/^#{1,6}\s+.*$/gm, '') // fuera títulos
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // fuera imágenes
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (!text) return null
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text
}
