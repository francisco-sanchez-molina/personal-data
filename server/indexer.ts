import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'
import { listAllNotes } from './vault'

function titleOf(relPath: string, content: string): string {
  const m = content.match(/^#\s+(.+)$/m)
  if (m) return m[1].trim()
  return path.basename(relPath, '.md')
}

/**
 * Extrae tags de una nota, al estilo Obsidian:
 * - hashtags inline: #comida, #medico/vacunas (no confunde títulos "# Título")
 * - frontmatter YAML: `tags: [a, b]` o lista con guiones
 */
export function extractTags(content: string): string[] {
  const tags = new Set<string>()
  const add = (raw: string) => {
    const t = raw.trim().replace(/^["']|["']$/g, '').replace(/^#/, '').toLowerCase()
    if (t) tags.add(t)
  }

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    const inline = fm[1].match(/^tags:\s*\[(.*?)\]\s*$/m)
    if (inline) {
      inline[1].split(',').forEach(add)
    } else {
      const block = fm[1].match(/^tags:\s*\r?\n((?:[ \t]+-[ \t]*.+\r?\n?)+)/m)
      if (block) for (const m of block[1].matchAll(/-[ \t]*(.+)/g)) add(m[1])
    }
  }

  for (const m of content.matchAll(/(?<=^|[\s(>])#([\p{L}\p{N}][\p{L}\p{N}/_-]*)/gmu)) {
    add(m[1])
  }
  return [...tags].sort()
}

/** Primera imagen embebida en la nota (portada para tarjetas), o null si no tiene. */
export function extractCoverImage(content: string): string | null {
  const m = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(content)
  return m ? m[1] : null
}

export function tagsOf(db: DB, relPath: string): string[] {
  return (db.prepare('SELECT tag FROM note_tags WHERE path = ? ORDER BY tag').all(relPath) as { tag: string }[]).map(
    (r) => r.tag
  )
}

export function listTags(db: DB): { tag: string; count: number }[] {
  return db
    .prepare('SELECT tag, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY count DESC, tag')
    .all() as { tag: string; count: number }[]
}

export function indexNote(db: DB, relPath: string, content: string, mtime: number, size: number): void {
  const title = titleOf(relPath, content)
  const tags = extractTags(content)
  const cover = extractCoverImage(content)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM notes_fts WHERE path = ?').run(relPath)
    db.prepare('INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)').run(relPath, title, content)
    db.prepare(
      'INSERT INTO notes_index (path, title, mtime, size, cover) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET title=excluded.title, mtime=excluded.mtime, size=excluded.size, cover=excluded.cover'
    ).run(relPath, title, mtime, size, cover)
    db.prepare('DELETE FROM note_tags WHERE path = ?').run(relPath)
    const ins = db.prepare('INSERT INTO note_tags (path, tag) VALUES (?, ?)')
    for (const tag of tags) ins.run(relPath, tag)
  })
  tx()
}

export function removeFromIndex(db: DB, relPath: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM notes_fts WHERE path = ?').run(relPath)
    db.prepare('DELETE FROM notes_index WHERE path = ?').run(relPath)
    db.prepare('DELETE FROM note_tags WHERE path = ?').run(relPath)
  })
  tx()
}

export function renameInIndex(db: DB, from: string, to: string): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE notes_fts SET path = ? WHERE path = ?').run(to, from)
    db.prepare('UPDATE notes_index SET path = ? WHERE path = ?').run(to, from)
    db.prepare('UPDATE note_tags SET path = ? WHERE path = ?').run(to, from)
  })
  tx()
}

/** Reconcilia el índice con los .md en disco (arranque o edición externa del vault). */
export function fullScan(db: DB, vaultRoot: string): { indexed: number; removed: number } {
  const onDisk = listAllNotes(vaultRoot)
  const known = new Map<string, number>(
    (db.prepare('SELECT path, mtime FROM notes_index').all() as { path: string; mtime: number }[]).map(
      (r) => [r.path, r.mtime]
    )
  )
  let indexed = 0
  for (const f of onDisk) {
    if (known.get(f.path) !== f.mtime) {
      const content = fs.readFileSync(path.join(vaultRoot, f.path), 'utf-8')
      indexNote(db, f.path, content, f.mtime, f.size)
      indexed++
    }
    known.delete(f.path)
  }
  for (const gone of known.keys()) removeFromIndex(db, gone)
  return { indexed, removed: known.size }
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
  tags: string[]
}

/**
 * Búsqueda combinada: texto libre (FTS5, prefijos, sin acentos) + filtros `#tag`.
 * "#cena arroz" → notas con el tag "cena" cuyo texto contiene "arroz".
 * Solo tags → todas las notas con TODOS esos tags, por fecha de edición.
 */
export function searchNotes(db: DB, query: string, limit = 30): SearchHit[] {
  const tagFilters: string[] = []
  const textTokens: string[] = []
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('#') && token.length > 1) tagFilters.push(token.slice(1).toLowerCase())
    else {
      const clean = token.replace(/["*]/g, '')
      if (clean) textTokens.push(clean)
    }
  }
  if (tagFilters.length === 0 && textTokens.length === 0) return []

  let hits: Omit<SearchHit, 'tags'>[]
  if (textTokens.length > 0) {
    const ftsQuery = textTokens.map((t) => `"${t}"*`).join(' ')
    try {
      hits = db
        .prepare(
          `SELECT path, title, snippet(notes_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet
           FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
        )
        .all(ftsQuery, tagFilters.length > 0 ? limit * 5 : limit) as Omit<SearchHit, 'tags'>[]
    } catch {
      return []
    }
    if (tagFilters.length > 0) {
      const hasAll = db.prepare(
        `SELECT COUNT(*) AS n FROM note_tags WHERE path = ? AND tag IN (${tagFilters.map(() => '?').join(',')})`
      )
      hits = hits
        .filter((h) => (hasAll.get(h.path, ...tagFilters) as { n: number }).n === tagFilters.length)
        .slice(0, limit)
    }
  } else {
    hits = db
      .prepare(
        `SELECT ni.path AS path, ni.title AS title, '' AS snippet
         FROM notes_index ni
         WHERE (SELECT COUNT(*) FROM note_tags nt
                WHERE nt.path = ni.path AND nt.tag IN (${tagFilters.map(() => '?').join(',')})) = ?
         ORDER BY ni.mtime DESC LIMIT ?`
      )
      .all(...tagFilters, tagFilters.length, limit) as Omit<SearchHit, 'tags'>[]
  }

  return hits.map((h) => ({ ...h, tags: tagsOf(db, h.path) }))
}
