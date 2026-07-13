import { useState } from 'react'
import { Link } from 'react-router'
import { thumbUrl, type Attachment, type Memory } from '../api'
import Lightbox from './Lightbox'

export default function MemoriesStrip({ memories }: { memories: Memory[] }) {
  const [lightbox, setLightbox] = useState<{ items: Attachment[]; index: number } | null>(null)

  if (memories.length === 0) return null

  return (
    <div className="space-y-3">
      {memories.map((mem) => (
        <div key={mem.date} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <Link to={`/journal/${mem.date}`} className="text-sm font-medium text-amber-300 hover:underline">
            ✨ Hace {mem.yearsAgo} {mem.yearsAgo === 1 ? 'año' : 'años'} — {mem.date}
          </Link>
          {mem.excerpt && <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{mem.excerpt}</p>}
          {mem.attachments.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {mem.attachments.map((a, i) => (
                <img
                  key={a.id}
                  src={thumbUrl(a)}
                  alt=""
                  loading="lazy"
                  onClick={() => setLightbox({ items: mem.attachments, index: i })}
                  className="h-20 w-20 shrink-0 cursor-pointer rounded-lg object-cover"
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox({ ...lightbox, index: i })}
        />
      )}
    </div>
  )
}
