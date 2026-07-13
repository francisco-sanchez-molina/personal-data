import { useEffect, useState } from 'react'
import { api, type MonthDay } from '../api'

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export default function CalendarMonth({
  date,
  onPick,
}: {
  date: string
  onPick: (date: string) => void
}) {
  const [month, setMonth] = useState(date.slice(0, 7))
  const [days, setDays] = useState<Map<string, MonthDay>>(new Map())

  useEffect(() => {
    api
      .journalMonth(month)
      .then((list) => setDays(new Map(list.map((d) => [d.date, d]))))
      .catch(() => {})
  }, [month])

  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const startOffset = (first.getDay() + 6) % 7 // lunes = 0
  const daysInMonth = new Date(y, m, 0).getDate()

  const shiftMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const monthLabel = first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">
          ‹
        </button>
        <span className="text-sm font-medium capitalize">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-zinc-600">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />
          const ds = `${month}-${String(day).padStart(2, '0')}`
          const info = days.get(ds)
          const isSelected = ds === date
          return (
            <button
              key={ds}
              onClick={() => onPick(ds)}
              className={`relative rounded-lg py-1.5 ${
                isSelected ? 'bg-amber-400 font-semibold text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {day}
              {info && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                  {info.hasNote && <span className="h-1 w-1 rounded-full bg-amber-400" />}
                  {info.attachmentCount > 0 && <span className="h-1 w-1 rounded-full bg-sky-400" />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
