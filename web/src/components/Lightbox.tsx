import { useEffect } from 'react'
import { fileUrl, type Attachment } from '../api'

export default function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: Attachment[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onNavigate])

  const a = items[index]
  if (!a) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={onClose}>
      <img
        src={fileUrl(a)}
        alt={a.original_name ?? ''}
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {index > 0 && (
        <button
          onClick={(e) => (e.stopPropagation(), onNavigate(index - 1))}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/80 px-3 py-2 text-xl"
        >
          ‹
        </button>
      )}
      {index < items.length - 1 && (
        <button
          onClick={(e) => (e.stopPropagation(), onNavigate(index + 1))}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/80 px-3 py-2 text-xl"
        >
          ›
        </button>
      )}
      <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-zinc-900/80 px-3 py-1.5 text-lg">
        ✕
      </button>
    </div>
  )
}
