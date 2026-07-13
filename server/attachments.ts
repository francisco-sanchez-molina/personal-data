import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Config } from './config'
import type { DB } from './db'
import { VaultError } from './vault'

export interface AttachmentRow {
  id: number
  date: string
  filename: string
  original_name: string | null
  mime: string
  size: number
  width: number | null
  height: number | null
  context: 'journal' | 'note'
  created_at: string
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_UPLOAD = 50 * 1024 * 1024
const MAX_DIM = 2560
const KEEP_PNG_UNDER = 1.5 * 1024 * 1024 // capturas de pantalla pequeñas se quedan en PNG

/** Fotos del diario de un día (excluye imágenes pegadas en notas). */
export function attachmentsForDate(db: DB, date: string): AttachmentRow[] {
  return db
    .prepare("SELECT * FROM attachments WHERE date = ? AND context = 'journal' ORDER BY created_at, id")
    .all(date) as AttachmentRow[]
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'img'
  )
}

export async function saveAttachment(
  cfg: Config,
  db: DB,
  date: string,
  file: File,
  context: 'journal' | 'note' = 'journal'
): Promise<AttachmentRow> {
  if (!ALLOWED.has(file.type)) {
    throw new VaultError(`Formato no soportado: ${file.type || 'desconocido'}. Usa JPEG, PNG, WebP o GIF.`, 415)
  }
  if (file.size > MAX_UPLOAD) throw new VaultError('Archivo demasiado grande (máx. 50 MB)', 413)

  const input = Buffer.from(await file.arrayBuffer())
  const dir = path.join(cfg.uploadsDir, date)
  fs.mkdirSync(dir, { recursive: true })

  const base = `${Date.now()}-${slugify(path.parse(file.name || 'img').name)}`
  let filename: string
  let mime: string
  let output: Buffer
  let width: number | null = null
  let height: number | null = null

  if (file.type === 'image/gif') {
    // Los GIF se guardan tal cual para no perder la animación
    filename = `${base}.gif`
    mime = 'image/gif'
    output = input
    const meta = await sharp(input).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
  } else {
    const img = sharp(input, { failOn: 'none' }).rotate()
    const meta = await img.metadata()
    const keepPng = file.type === 'image/png' && input.length <= KEEP_PNG_UNDER
    const resized = img.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    if (keepPng) {
      filename = `${base}.png`
      mime = 'image/png'
      output = await resized.png().toBuffer()
    } else {
      filename = `${base}.jpg`
      mime = 'image/jpeg'
      output = await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    }
    const outMeta = await sharp(output).metadata()
    width = outMeta.width ?? meta.width ?? null
    height = outMeta.height ?? meta.height ?? null
  }

  fs.writeFileSync(path.join(dir, filename), output)

  const thumb = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer()
  fs.writeFileSync(path.join(dir, `${base}.thumb.jpg`), thumb)

  const info = db
    .prepare(
      'INSERT INTO attachments (date, filename, original_name, mime, size, width, height, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(date, filename, file.name || null, mime, output.length, width, height, context)
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid) as AttachmentRow
}

export function deleteAttachment(cfg: Config, db: DB, id: number): void {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined
  if (!row) throw new VaultError('El adjunto no existe', 404)
  const dir = path.join(cfg.uploadsDir, row.date)
  const base = row.filename.replace(/\.[a-z]+$/, '')
  for (const f of [row.filename, `${base}.thumb.jpg`]) {
    const abs = path.join(dir, f)
    if (fs.existsSync(abs)) fs.rmSync(abs)
  }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
}

/** Ruta absoluta de un fichero subido, validando date y filename. */
export function uploadFilePath(cfg: Config, date: string, filename: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new VaultError('Fecha inválida')
  if (!/^[a-z0-9._-]+$/i.test(filename) || filename.includes('..')) throw new VaultError('Nombre inválido')
  const abs = path.join(cfg.uploadsDir, date, filename)
  if (!fs.existsSync(abs)) throw new VaultError('No existe', 404)
  return abs
}
