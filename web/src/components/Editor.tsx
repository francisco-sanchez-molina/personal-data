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
  placeholder?: string
}

/** Editor CodeMirror no controlado: solo se resetea desde fuera cuando cambia `docKey`. */
export default function Editor({ value, onChange, onSave, placeholder, docKey }: Props & { docKey: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        oneDark,
        EditorView.lineWrapping,
        cmPlaceholder(placeholder ?? 'Escribe en markdown…'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
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
