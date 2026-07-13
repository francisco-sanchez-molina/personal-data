import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  api,
  formatDateEs,
  shiftDate,
  thumbUrl,
  fileUrl,
  todayStr,
  type Attachment,
  type Memory,
} from '../api'
import Editor from './Editor'
import MarkdownPreview from './MarkdownPreview'
import CalendarMonth from './CalendarMonth'
import MemoriesStrip from './MemoriesStrip'
import Lightbox from './Lightbox'

export default function JournalPage() {
  const { date = todayStr() } = useParams()
  const navigate = useNavigate()

  const [content, setContent] = useState('')
  const [loadedDate, setLoadedDate] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [showCalendar, setShowCalendar] = useState(false)
  const [showMemories, setShowMemories] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const contentRef = useRef(content)
  contentRef.current = content
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoadedDate(null)
    setShowCalendar(false)
    api.journal(date).then((day) => {
      setContent(day.content ?? '')
      setAttachments(day.attachments)
      setLoadedDate(date)
      setDirty(false)
    })
    api.memories(date).then(setMemories).catch(() => setMemories([]))
  }, [date])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await api.saveJournal(date, contentRef.current)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [date])

  const onChange = (v: string) => {
    setContent(v)
    setDirty(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1500)
  }

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const upload = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      const saved = await api.uploadAttachments(date, files)
      setAttachments((prev) => [...prev, ...saved])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error subiendo')
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = async (a: Attachment) => {
    if (!confirm('¿Borrar esta foto?')) return
    await api.deleteAttachment(a.id)
    setAttachments((prev) => prev.filter((x) => x.id !== a.id))
  }

  const insertInNote = (a: Attachment) => {
    const md = `\n![${a.original_name ?? ''}](${fileUrl(a)})\n`
    onChange(contentRef.current.replace(/\n*$/, '\n') + md)
  }

  const isToday = date === todayStr()

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        upload([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')))
      }}
    >
      {/* Cabecera de fecha */}
      <header className="border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate(`/journal/${shiftDate(date, -1)}`)}
            className="rounded-lg px-2.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
          >
            ‹
          </button>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-center text-sm font-medium capitalize hover:bg-zinc-900"
          >
            {formatDateEs(date)} {showCalendar ? '▴' : '▾'}
          </button>
          <button
            onClick={() => navigate(`/journal/${shiftDate(date, 1)}`)}
            className="rounded-lg px-2.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
          >
            ›
          </button>
          {!isToday && (
            <button
              onClick={() => navigate(`/journal/${todayStr()}`)}
              className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-zinc-700"
            >
              Hoy
            </button>
          )}
          <span className="hidden text-xs text-zinc-600 sm:block">
            {saving ? 'Guardando…' : dirty ? '●' : ''}
          </span>
          <div className="flex rounded-lg bg-zinc-900 p-0.5 text-xs">
            {(['edit', 'preview'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 ${mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
              >
                {m === 'edit' ? 'Editar' : 'Vista'}
              </button>
            ))}
          </div>
        </div>
        {showCalendar && (
          <div className="mx-auto mt-2 max-w-sm">
            <CalendarMonth date={date} onPick={(d) => navigate(`/journal/${d}`)} />
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Recuerdos */}
        {memories.length > 0 && (
          <div className="border-b border-zinc-800 p-3">
            <button
              onClick={() => setShowMemories(!showMemories)}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"
            >
              ✨ Tal día como hoy {showMemories ? '▴' : `(${memories.length}) ▾`}
            </button>
            {showMemories && <MemoriesStrip memories={memories} />}
          </div>
        )}

        {/* Editor / vista */}
        <div className="min-h-[45vh]">
          {loadedDate === date ? (
            mode === 'edit' ? (
              <Editor
                docKey={`journal:${date}`}
                value={content}
                onChange={onChange}
                onSave={save}
                placeholder={`¿Qué tal el ${formatDateEs(date)}?`}
              />
            ) : (
              <MarkdownPreview content={content} />
            )
          ) : (
            <div className="p-4 text-sm text-zinc-600">Cargando…</div>
          )}
        </div>

        {/* Adjuntos */}
        <div className={`border-t border-zinc-800 p-3 ${dragOver ? 'bg-amber-400/10' : ''}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              📷 Fotos ({attachments.length})
            </h3>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-zinc-700 disabled:opacity-50"
            >
              {uploading ? 'Subiendo…' : '+ Subir fotos'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                upload([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          {attachments.length === 0 ? (
            <p className="py-2 text-center text-xs text-zinc-700">
              Arrastra imágenes aquí o pulsa «Subir fotos»
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {attachments.map((a, i) => (
                <div key={a.id} className="group relative">
                  <img
                    src={thumbUrl(a)}
                    alt={a.original_name ?? ''}
                    loading="lazy"
                    onClick={() => setLightboxIndex(i)}
                    className="aspect-square w-full cursor-pointer rounded-lg object-cover"
                  />
                  <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                    <button
                      onClick={() => insertInNote(a)}
                      title="Insertar en la nota"
                      className="rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs"
                    >
                      📝
                    </button>
                    <button
                      onClick={() => removeAttachment(a)}
                      title="Borrar"
                      className="rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          items={attachments}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  )
}
