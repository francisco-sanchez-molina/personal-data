import { useEffect, useRef } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  /** Sube una imagen pegada/arrastrada y devuelve el markdown a insertar (o null si falla). */
  onPasteImage?: (file: File) => Promise<string | null>
  placeholder?: string
}

function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return []
  return [...list.files].filter((f) => f.type.startsWith('image/'))
}

/** Editor CodeMirror no controlado: solo se resetea desde fuera cuando cambia `docKey`. */
export default function Editor({ value, onChange, onSave, onPasteImage, placeholder, docKey }: Props & { docKey: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave, onPasteImage })
  callbacks.current = { onChange, onSave, onPasteImage }

  useEffect(() => {
    if (!host.current) return

    const insertImages = async (view: EditorView, files: File[], at?: number) => {
      const upload = callbacks.current.onPasteImage
      if (!upload) return
      for (const file of files) {
        const md = await upload(file)
        if (!md) continue
        const pos = at ?? view.state.selection.main.head
        view.dispatch({ changes: { from: pos, insert: md }, selection: { anchor: pos + md.length } })
        at = undefined // las siguientes van tras el cursor ya movido
      }
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
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  return <div ref={host} className="h-full overflow-auto" />
}
