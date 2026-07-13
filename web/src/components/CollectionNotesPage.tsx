import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Collection, type CollectionNote } from '../api'
import TagChip from './TagChip'

function relativeDate(mtime: number): string {
  const days = Math.floor((Date.now() - mtime) / 86_400_000)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  return new Date(mtime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

function NoteCard({ note }: { note: CollectionNote }) {
  const [imgError, setImgError] = useState(false)
  const showCover = note.cover && !imgError

  return (
    <Link
      to={`/notes/${note.path}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 hover:border-zinc-600"
    >
      <div className="aspect-video w-full overflow-hidden bg-zinc-900">
        {showCover ? (
          <img
            src={note.cover!}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-zinc-700">📝</div>
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-sm font-medium">{note.title}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-zinc-500">
            {note.tags.length > 0 ? note.tags.map((t) => `#${t}`).join(' ') : ' '}
          </p>
          <p className="shrink-0 text-xs text-zinc-600">{relativeDate(note.mtime)}</p>
        </div>
      </div>
    </Link>
  )
}

export default function CollectionNotesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [notes, setNotes] = useState<CollectionNote[]>([])
  const [filter, setFilter] = useState('')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .collectionNotes(Number(id))
      .then((r) => {
        setCollection(r.collection)
        setNotes(r.notes)
      })
      .catch(() => navigate('/collections'))
  }, [id, navigate])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return notes.filter(
      (n) =>
        (!f || n.title.toLowerCase().includes(f) || n.path.toLowerCase().includes(f)) &&
        [...activeTags].every((t) => n.tags.includes(t))
    )
  }, [notes, filter, activeTags])

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const { path } = await api.createCollectionNote(Number(id), title)
      navigate(`/notes/${path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  if (!collection) return <div className="p-4 text-sm text-zinc-600">Cargando…</div>

  return (
    <div className="mx-auto max-w-4xl overflow-auto p-4">
      <div className="mb-1 flex items-center gap-2">
        <Link to="/collections" className="rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-900">
          ‹
        </Link>
        <h1 className="flex-1 text-lg font-semibold">
          {collection.icon} {collection.name}
        </h1>
        <button
          onClick={() => {
            setCreating(!creating)
            setTitle('')
            setError(null)
          }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-amber-300 hover:bg-zinc-700"
        >
          + Nueva
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-600">carpeta «{collection.folder}/» del vault</p>

      {creating && (
        <form onSubmit={create} className="mb-3 flex gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Título de la nueva nota en ${collection.name}…`}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            Crear
          </button>
        </form>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {tagCounts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tagCounts.map(([tag, count]) => (
            <TagChip key={tag} tag={tag} count={count} active={activeTags.has(tag)} onClick={() => toggleTag(tag)} />
          ))}
        </div>
      )}

      {notes.length > 5 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar…"
          className="mb-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-amber-400"
        />
      )}

      {notes.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">
          Aún no hay notas. Crea la primera con «+ Nueva»
          {collection.template ? ' y se rellenará con tu plantilla.' : '.'}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-600">Nada coincide con «{filter}»</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((n) => (
            <NoteCard key={n.path} note={n} />
          ))}
        </div>
      )}
    </div>
  )
}
