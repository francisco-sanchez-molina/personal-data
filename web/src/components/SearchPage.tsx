import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import DOMPurify from 'dompurify'
import { api, todayStr, type SearchHit, type TagCount, type VEvent } from '../api'
import TagChip from './TagChip'
import { offsetLabel } from './CalendarPage'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [input, setInput] = useState(q)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [events, setEvents] = useState<VEvent[]>([])
  const [searched, setSearched] = useState(false)
  const [allTags, setAllTags] = useState<TagCount[]>([])

  useEffect(() => {
    api.tags().then(setAllTags).catch(() => {})
  }, [q]) // recarga al buscar, por si se han añadido tags

  useEffect(() => setInput(q), [q])

  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== q) setParams(input ? { q: input } : {}, { replace: true })
    }, 350)
    return () => clearTimeout(t)
  }, [input, q, setParams])

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      setEvents([])
      setSearched(false)
      return
    }
    api.search(q).then((r) => {
      setHits(r.notes)
      setEvents(r.events)
      setSearched(true)
    })
  }, [q])

  const activeTags = new Set(
    input
      .split(/\s+/)
      .filter((t) => t.startsWith('#') && t.length > 1)
      .map((t) => t.slice(1).toLowerCase())
  )

  const toggleTag = (tag: string) => {
    const next = activeTags.has(tag)
      ? input
          .split(/\s+/)
          .filter((t) => t.toLowerCase() !== `#${tag}`)
          .join(' ')
      : `${input} #${tag}`.trim()
    setInput(next)
    setParams(next ? { q: next } : {}, { replace: true })
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Buscar… (texto libre y/o #tags, p. ej. «#cena arroz»)"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-amber-400"
      />

      {allTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allTags.slice(0, 24).map((t) => (
            <TagChip key={t.tag} tag={t.tag} count={t.count} active={activeTags.has(t.tag)} onClick={() => toggleTag(t.tag)} />
          ))}
        </div>
      )}

      <div className="mt-4 flex-1 space-y-2 overflow-auto">
        {events.length > 0 && (
          <>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">🗓 En la agenda</h2>
            {events.map((ev) => (
              <Link
                key={`ev-${ev.id}`}
                to={`/calendar?date=${ev.date}`}
                className="block rounded-xl border border-zinc-800 p-3 hover:border-zinc-600"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-amber-300">{ev.title}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {ev.date === todayStr()
                      ? 'hoy'
                      : new Date(ev.date + 'T12:00:00').toLocaleDateString('es-ES', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                    {ev.time ? ` · ${ev.time}` : ''}
                  </span>
                </div>
                {ev.reminders.length > 0 && (
                  <p className="mt-1 text-xs text-amber-300/80">
                    🔔 {ev.reminders.map((r) => offsetLabel(r.offset_min)).join(' · ')}
                  </p>
                )}
                {ev.notes && <p className="mt-1 text-xs text-zinc-500">{ev.notes}</p>}
              </Link>
            ))}
            {hits.length > 0 && (
              <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">📝 En las notas</h2>
            )}
          </>
        )}
        {hits.map((h) => (
          <Link
            key={h.path}
            to={
              h.path.startsWith('journal/')
                ? `/journal/${h.path.split('/').pop()!.replace(/\.md$/, '')}`
                : `/notes/${h.path}`
            }
            className="block rounded-xl border border-zinc-800 p-3 hover:border-zinc-600"
          >
            <div className="text-sm font-medium text-amber-300">{h.title}</div>
            <div className="text-xs text-zinc-600">{h.path}</div>
            {h.snippet && (
              <p
                className="mt-1 text-sm text-zinc-400"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(h.snippet, { ALLOWED_TAGS: ['mark'] }),
                }}
              />
            )}
            {h.tags.length > 0 && (
              <p className="mt-1.5 text-xs text-zinc-500">{h.tags.map((t) => `#${t}`).join('  ')}</p>
            )}
          </Link>
        ))}
        {searched && hits.length === 0 && events.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-600">Sin resultados para «{q}»</p>
        )}
        {!q.trim() && allTags.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-600">
            Escribe <code className="rounded bg-zinc-900 px-1">#tags</code> en tus notas (p. ej.{' '}
            <code className="rounded bg-zinc-900 px-1">#comida #pollo</code>) y aparecerán aquí como filtros.
          </p>
        )}
      </div>
    </div>
  )
}
