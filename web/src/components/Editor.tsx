import { useEffect, useRef } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

export interface EditorApi {
  /** Inserta texto en la posición actual del cursor. */
  insert: (text: string) => void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  /** Sube una imagen pegada/arrastrada y devuelve el markdown a insertar (o null si falla). */
  onPasteImage?: (file: File) => Promise<string | null>
  /** Recibe la API imperativa del editor (para insertar desde botones externos). */
  apiRef?: React.MutableRefObject<EditorApi | null>
  /** Se llama con `true` mientras haya alguna imagen pegada/arrastrada subiéndose. */
  onUploadingChange?: (uploading: boolean) => void
  placeholder?: string
}

function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return []
  return [...list.files].filter((f) => f.type.startsWith('image/'))
}

/** Editor CodeMirror no controlado: solo se resetea desde fuera cuando cambia `docKey`. */
export default function Editor({
  value,
  onChange,
  onSave,
  onPasteImage,
  apiRef,
  onUploadingChange,
  placeholder,
  docKey,
}: Props & { docKey: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave, onPasteImage, onUploadingChange })
  callbacks.current = { onChange, onSave, onPasteImage, onUploadingChange }

  useEffect(() => {
    if (!host.current) return

    const pendingCount = { current: 0 }
    const reportUploading = (delta: number) => {
      pendingCount.current = Math.max(0, pendingCount.current + delta)
      callbacks.current.onUploadingChange?.(pendingCount.current > 0)
    }

    // Inserta un placeholder al pegar/soltar y lo sustituye por el markdown final (o un aviso de error)
    // cuando la subida termina, para que la espera no se sienta como "no ha pasado nada".
    const insertImages = async (view: EditorView, files: File[], at?: number) => {
      const upload = callbacks.current.onPasteImage
      if (!upload) return
      for (const file of files) {
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
        const placeholderText = `⏳ Subiendo ${file.name || 'imagen'}… [${token}]`
        const pos = at ?? view.state.selection.main.head
        view.dispatch({
          changes: { from: pos, insert: placeholderText },
          selection: { anchor: pos + placeholderText.length },
        })
        at = undefined // las siguientes van tras el cursor ya movido

        reportUploading(1)
        const md = await upload(file).finally(() => reportUploading(-1))

        const text = view.state.doc.toString()
        const idx = text.indexOf(placeholderText)
        if (idx === -1) continue // el usuario borró el placeholder mientras subía
        const replacement = md ?? `⚠️ No se pudo subir ${file.name || 'la imagen'}\n`
        view.dispatch({ changes: { from: idx, to: idx + placeholderText.length, insert: replacement } })
      }
      callbacks.current.onSave?.()
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        oneDark,
        EditorView.lineWrapping,
        cmPlaceholder(placeholder ?? 'Escribe en markdown… (puedes pegar imágenes)'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          paste: (e, view) => {
            const files = [...(e.clipboardData?.items ?? [])]
              .filter((i) => i.kind === 'file')
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null && f.type.startsWith('image/'))
            if (files.length === 0 || !callbacks.current.onPasteImage) return false
            e.preventDefault()
            void insertImages(view, files)
            return true
          },
          drop: (e, view) => {
            const files = imageFiles(e.dataTransfer)
            if (files.length === 0 || !callbacks.current.onPasteImage) return false
            e.preventDefault()
            e.stopPropagation()
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined
            void insertImages(view, files, pos)
            return true
          },
        }),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              callbacks.current.onSave?.()
              return true
            },
          },
        ]),
      ],
    })
    const view = new EditorView({ state, parent: host.current })
    viewRef.current = view
    if (apiRef) {
      apiRef.current = {
        insert: (text) => {
          const pos = view.state.selection.main.head
          view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
          view.focus()
        },
      }
    }
    return () => {
      view.destroy()
      viewRef.current = null
      if (apiRef) apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  return <div ref={host} className="h-full overflow-auto" />
}
