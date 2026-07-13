import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Collection } from '../api'

const EMPTY_FORM = { name: '', icon: '', template: '' }

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.collections().then(setCollections).catch(() => setCollections([]))
  useEffect(() => {
    refresh()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  const openEdit = (col: Collection) => {
    setEditing(col)
    setForm({ name: col.name, icon: col.icon, template: col.template ?? '' })
    setError(null)
    setShowForm(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      if (editing) {
        await api.updateCollection(editing.id, form)
      } else {
        await api.createCollection(form)
      }
      setShowForm(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const remove = async (col: Collection) => {
    if (!confirm(`¿Quitar la colección «${col.name}»?\n\nLas notas NO se borran: siguen en la carpeta «${col.folder}/» del vault.`))
      return
    await api.deleteCollection(col.id)
    refresh()
  }

  return (
    <div className="mx-auto max-w-3xl overflow-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">🗂 Colecciones</h1>
        <button
          onClick={openCreate}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-amber-300 hover:bg-zinc-700"
        >
          + Nueva colección
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
          <div className="flex gap-2">
            <input
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="📁"
              className="w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-center outline-none focus:border-amber-400"
            />
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nombre (p. ej. Recetas, Médico peque…)"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-400"
            />
          </div>
          <textarea
            value={form.template}
            onChange={(e) => setForm({ ...form, template: e.target.value })}
            placeholder={'Plantilla opcional para notas nuevas. Variables: {{title}} y {{date}}.\nP. ej.:\n# {{title}}\n\n## Ingredientes\n\n## Pasos\n'}
            rows={4}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-amber-400"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950">
              {editing ? 'Guardar' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {collections === null ? (
        <p className="text-sm text-zinc-600">Cargando…</p>
      ) : collections.length === 0 && !showForm ? (
        <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">
          Las colecciones son categorías para tus notas: <b>Recetas 🍲</b>, <b>Médico peque 🩺</b>, <b>Libros 📚</b>…
          <br />
          Por debajo son carpetas normales del vault, así que tus <code>.md</code> siguen siendo portables.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {collections.map((col) => (
            <div key={col.id} className="group relative">
              <Link
                to={`/collections/${col.id}`}
                className="flex flex-col gap-1 rounded-xl border border-zinc-800 p-4 transition-colors hover:border-zinc-600"
              >
                <span className="text-3xl">{col.icon}</span>
                <span className="mt-1 font-medium">{col.name}</span>
                <span className="text-xs text-zinc-500">
                  {col.noteCount} {col.noteCount === 1 ? 'nota' : 'notas'} · {col.folder}/
                </span>
              </Link>
              <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                <button
                  onClick={() => openEdit(col)}
                  title="Editar"
                  className="rounded bg-zinc-900/90 px-1.5 py-0.5 text-xs"
                >
                  ✏️
                </button>
                <button
                  onClick={() => remove(col)}
                  title="Quitar"
                  className="rounded bg-zinc-900/90 px-1.5 py-0.5 text-xs"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
