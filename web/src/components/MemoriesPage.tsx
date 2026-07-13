import { useEffect, useState } from 'react'
import { api, formatDateEs, todayStr, type Memory } from '../api'
import MemoriesStrip from './MemoriesStrip'

export default function MemoriesPage() {
  const today = todayStr()
  const [memories, setMemories] = useState<Memory[] | null>(null)

  useEffect(() => {
    api.memories(today).then(setMemories).catch(() => setMemories([]))
  }, [today])

  return (
    <div className="mx-auto max-w-2xl overflow-auto p-4">
      <h1 className="text-lg font-semibold">✨ Recuerdos</h1>
      <p className="mb-4 text-sm capitalize text-zinc-500">{formatDateEs(today)}</p>
      {memories === null ? (
        <p className="text-sm text-zinc-600">Cargando…</p>
      ) : memories.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">
          No hay recuerdos de un {new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} en años
          anteriores.
          <br />
          Escribe hoy en el diario y el año que viene aparecerá aquí. 😉
        </div>
      ) : (
        <MemoriesStrip memories={memories} />
      )}
    </div>
  )
}
