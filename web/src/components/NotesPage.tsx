import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, imageMarkdown, type TreeNode } from '../api'
import Editor, { type EditorApi } from './Editor'
import MarkdownPreview from './MarkdownPreview'
import FileTree from './FileTree'

type Mode = 'edit' | 'preview'

export default function NotesPage() {
  const params = useParams()
  const notePath = params['*'] || null
  const navigate = useNavigate()

  const [tree, setTree] = useState<TreeNode[]>([])
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showTree, setShowTree] = useState(!notePath)
  const [uploadingImage, setUploadingImage] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editorApi = useRef<EditorApi | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const refreshTree = useCallback(() => {
    api.tree().then(setTree).catch(() => {})
  }, [])

  useEffect(refreshTree, [refreshTree])

  useEffect(() => {
    if (!notePath) {
      setLoaded(null)
      setContent('')
      return
    }
    api
      .readNote(notePath)
      .then((n) => {
        setContent(n.content)
        setLoaded(notePath)
        setDirty(false)
        setShowTree(false)
      })
      .catch(() => navigate('/notes'))
  }, [notePath, navigate])

  const save = useCallback(async () => {
    if (!notePath) return
    setSaving(true)
    try {
      await api.saveNote(notePath, contentRef.current)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [notePath])

  const contentRef = useRef(content)
  contentRef.current = content

  const onChange = (v: string) => {
    setContent(v)
    setDirty(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1500)
  }

  const onPasteImage = async (file: File): Promise<string | null> => {
    try {
      const [saved] = await api.uploadNoteImages([file])
      return imageMarkdown(saved)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error subiendo la imagen')
      return null
    }
  }

  const uploadFromPicker = async (files: File[]) => {
    if (files.length === 0) return
    setUploadingImage(true)
    try {
      for (const f of files) {
        const md = await onPasteImage(f)
        if (md) editorApi.current?.insert(md)
      }
    } finally {
      setUploadingImage(false)
    }
  }

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const createNote = async () => {
    const name = prompt('Ruta de la nueva nota (p. ej. "ideas.md" o "proyectos/casa.md"):')
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    try {
      await api.createNote(path, `# ${path.split('/').pop()!.replace(/\.md$/, '')}\n\n`)
      refreshTree()
      navigate(`/notes/${path}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  const renameNote = async () => {
    if (!notePath) return
    const to = prompt('Nueva ruta:', notePath)
    if (!to || to === notePath) return
    const toPath = to.endsWith('.md') ? to : `${to}.md`
    try {
      await api.renameNote(notePath, toPath)
      refreshTree()
      navigate(`/notes/${toPath}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  const deleteNote = async () => {
    if (!notePath || !confirm(`¿Borrar «${notePath}»?`)) return
    await api.deleteNote(notePath)
    refreshTree()
    navigate('/notes')
  }

  return (
    <div className="flex h-full">
      {/* Árbol */}
      <aside
        className={`${
          showTree ? 'flex' : 'hidden'
        } w-full shrink-0 flex-col border-r border-zinc-800 md:flex md:w-64`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-3">
          <h2 className="text-sm font-semibold text-zinc-400">Notas</h2>
          <button
            onClick={createNote}
            className="rounded-lg bg-zinc-800 px-2.5 py-1 text-sm text-amber-300 hover:bg-zinc-700"
            title="Nueva nota"
          >
            + Nueva
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <FileTree nodes={tree} selected={notePath} onSelect={(p) => navigate(`/notes/${p}`)} />
        </div>
      </aside>

      {/* Editor */}
      <section className={`${showTree ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        {loaded ? (
          <>
            <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <button
                onClick={() => setShowTree(true)}
                className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-900 md:hidden"
              >
                ☰
              </button>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{loaded}</span>
              <span className="text-xs text-zinc-600">
                {saving ? 'Guardando…' : dirty ? '● sin guardar' : 'Guardado'}
              </span>
              <div className="flex rounded-lg bg-zinc-900 p-0.5 text-xs">
                {(['edit', 'preview'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2.5 py-1 ${
                      mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'
                    }`}
                  >
                    {m === 'edit' ? 'Editar' : 'Vista'}
                  </button>
                ))}
              </div>
              {mode === 'edit' && (
                <>
                  <button
                    onClick={() => imageInput.current?.click()}
                    disabled={uploadingImage}
                    className="px-1.5 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                    title="Insertar imagen (también puedes pegarla o arrastrarla)"
                  >
                    {uploadingImage ? '⏳' : '📷'}
                  </button>
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      uploadFromPicker([...(e.target.files ?? [])])
                      e.target.value = ''
                    }}
                  />
                </>
              )}
              <button onClick={renameNote} className="px-1.5 text-sm text-zinc-500 hover:text-zinc-300" title="Renombrar">
                ✏️
              </button>
              <button onClick={deleteNote} className="px-1.5 text-sm text-zinc-500 hover:text-red-400" title="Borrar">
                🗑
              </button>
            </header>
            <div className="min-h-0 flex-1">
              {mode === 'edit' ? (
                <Editor
                  docKey={loaded}
                  value={content}
                  onChange={onChange}
                  onSave={save}
                  onPasteImage={onPasteImage}
                  apiRef={editorApi}
                />
              ) : (
                <MarkdownPreview content={content} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-600">
            <p>Selecciona una nota o crea una nueva</p>
            <button
              onClick={createNote}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-amber-300 hover:bg-zinc-700"
            >
              + Nueva nota
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
