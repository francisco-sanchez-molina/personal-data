import type { Config } from './config'
import type { DB } from './db'
import { VaultError, noteExists, writeNote } from './vault'
import { indexNote } from './indexer'

export interface CollectionRow {
  id: number
  name: string
  icon: string
  folder: string
  template: string | null
  position: number
  created_at: string
}

export interface CollectionWithCount extends CollectionRow {
  noteCount: number
}

export interface CollectionNote {
  path: string
  title: string
  mtime: number
  tags: string[]
}

const RESERVED_FOLDERS = new Set(['journal'])
const DEFAULT_TEMPLATE = '# {{title}}\n\n'

/** "Médico peque" → "medico-peque" */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function validFolder(folder: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(folder) && !RESERVED_FOLDERS.has(folder)
}

export function listCollections(db: DB): CollectionWithCount[] {
  const rows = db
    .prepare('SELECT * FROM collections ORDER BY position, id')
    .all() as CollectionRow[]
  const count = db.prepare("SELECT COUNT(*) AS n FROM notes_index WHERE path LIKE ? || '/%'")
  return rows.map((r) => ({ ...r, noteCount: (count.get(r.folder) as { n: number }).n }))
}

export function getCollection(db: DB, id: number): CollectionRow {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as CollectionRow | undefined
  if (!row) throw new VaultError('La colección no existe', 404)
  return row
}

export function createCollection(
  db: DB,
  input: { name?: string; icon?: string; folder?: string; template?: string | null }
): CollectionRow {
  const name = (input.name ?? '').trim()
  if (!name) throw new VaultError('Falta el nombre')
  const folder = input.folder?.trim() || slugify(name)
  if (!validFolder(folder)) {
    throw new VaultError(`Carpeta inválida: «${folder}» (minúsculas, números y guiones; «journal» está reservada)`)
  }
  const exists = db.prepare('SELECT 1 FROM collections WHERE folder = ?').get(folder)
  if (exists) throw new VaultError('Ya hay una colección en esa carpeta', 409)
  const position =
    ((db.prepare('SELECT MAX(position) AS p FROM collections').get() as { p: number | null }).p ?? 0) + 1
  const info = db
    .prepare('INSERT INTO collections (name, icon, folder, template, position) VALUES (?, ?, ?, ?, ?)')
    .run(name, input.icon?.trim() || '📁', folder, input.template || null, position)
  return getCollection(db, Number(info.lastInsertRowid))
}

export function updateCollection(
  db: DB,
  id: number,
  input: { name?: string; icon?: string; template?: string | null; position?: number }
): CollectionRow {
  const current = getCollection(db, id)
  const name = input.name?.trim() || current.name
  const icon = input.icon?.trim() || current.icon
  const template = input.template !== undefined ? input.template || null : current.template
  const position = input.position ?? current.position
  db.prepare('UPDATE collections SET name = ?, icon = ?, template = ?, position = ? WHERE id = ?').run(
    name,
    icon,
    template,
    position,
    id
  )
  return getCollection(db, id)
}

/** Borra solo el registro: las notas siguen en el vault. */
export function deleteCollection(db: DB, id: number): void {
  getCollection(db, id)
  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
}

export function collectionNotes(db: DB, folder: string): CollectionNote[] {
  const notes = db
    .prepare("SELECT path, title, mtime FROM notes_index WHERE path LIKE ? || '/%' ORDER BY mtime DESC")
    .all(folder) as Omit<CollectionNote, 'tags'>[]
  const tagRows = db
    .prepare("SELECT path, tag FROM note_tags WHERE path LIKE ? || '/%' ORDER BY tag")
    .all(folder) as { path: string; tag: string }[]
  const byPath = new Map<string, string[]>()
  for (const r of tagRows) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r.tag])
  return notes.map((n) => ({ ...n, tags: byPath.get(n.path) ?? [] }))
}

export function createNoteInCollection(
  cfg: Config,
  db: DB,
  collection: CollectionRow,
  title: string,
  today: string
): { path: string } {
  const clean = title.trim()
  if (!clean) throw new VaultError('Falta el título')
  const slug = slugify(clean)
  if (!slug) throw new VaultError('El título no genera un nombre de archivo válido')
  const rel = `${collection.folder}/${slug}.md`
  if (noteExists(cfg.vaultDir, rel)) throw new VaultError('Ya existe una nota con ese título', 409)
  const content = (collection.template || DEFAULT_TEMPLATE)
    .replaceAll('{{title}}', clean)
    .replaceAll('{{date}}', today)
  writeNote(cfg.vaultDir, rel, content)
  indexNote(db, rel, content, Date.now(), Buffer.byteLength(content))
  return { path: rel }
}
