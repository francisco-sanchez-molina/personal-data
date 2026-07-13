import fs from 'node:fs'
import path from 'node:path'

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'note'
  children?: TreeNode[]
}

export class VaultError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** Valida una ruta relativa dentro del vault y devuelve la ruta absoluta. */
export function safePath(root: string, rel: string, { mustBeNote = true } = {}): string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) {
    throw new VaultError('Ruta inválida')
  }
  const normalized = rel.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new VaultError('Ruta inválida')
  }
  if (normalized.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || seg.startsWith('.'))) {
    throw new VaultError('Ruta inválida')
  }
  if (mustBeNote && !normalized.endsWith('.md')) {
    throw new VaultError('Las notas deben terminar en .md')
  }
  const abs = path.resolve(root, normalized)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new VaultError('Ruta fuera del vault')
  }
  return abs
}

export function noteExists(root: string, rel: string): boolean {
  return fs.existsSync(safePath(root, rel))
}

export function readNote(root: string, rel: string): string {
  const abs = safePath(root, rel)
  if (!fs.existsSync(abs)) throw new VaultError('La nota no existe', 404)
  return fs.readFileSync(abs, 'utf-8')
}

export function writeNote(root: string, rel: string, content: string): void {
  const abs = safePath(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf-8')
}

export function deleteNote(root: string, rel: string): void {
  const abs = safePath(root, rel)
  if (!fs.existsSync(abs)) throw new VaultError('La nota no existe', 404)
  fs.rmSync(abs)
  // Limpia directorios que hayan quedado vacíos
  let dir = path.dirname(abs)
  while (dir !== root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
}

export function renameNote(root: string, from: string, to: string): void {
  const absFrom = safePath(root, from)
  const absTo = safePath(root, to)
  if (!fs.existsSync(absFrom)) throw new VaultError('La nota no existe', 404)
  if (fs.existsSync(absTo)) throw new VaultError('Ya existe una nota con ese nombre', 409)
  fs.mkdirSync(path.dirname(absTo), { recursive: true })
  fs.renameSync(absFrom, absTo)
}

export function listTree(root: string): TreeNode[] {
  const walk = (dir: string, relBase: string): TreeNode[] => {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const nodes: TreeNode[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: rel, type: 'dir', children: walk(path.join(dir, e.name), rel) })
      } else if (e.isFile() && e.name.endsWith('.md')) {
        nodes.push({ name: e.name.replace(/\.md$/, ''), path: rel, type: 'note' })
      }
    }
    nodes.sort((a, b) =>
      a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'es')
    )
    return nodes
  }
  return walk(root, '')
}

export function listAllNotes(root: string): { path: string; mtime: number; size: number }[] {
  const out: { path: string; mtime: number; size: number }[] = []
  const walk = (dir: string, relBase: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs, rel)
      else if (e.isFile() && e.name.endsWith('.md')) {
        const st = fs.statSync(abs)
        out.push({ path: rel, mtime: Math.floor(st.mtimeMs), size: st.size })
      }
    }
  }
  walk(root, '')
  return out
}
