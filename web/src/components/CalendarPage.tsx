import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  api,
  todayStr,
  formatDateEs,
  thumbUrl,
  type JournalDay,
  type MonthDay,
  type ReminderInput,
  type VEvent,
} from '../api'

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const REMINDER_OPTIONS = [
  { min: 0, label: 'A la hora' },
  { min: 10, label: '10 min antes' },
  { min: 30, label: '30 min antes' },
  { min: 60, label: '1 h antes' },
  { min: 1440, label: '1 día antes' },
  { min: 10080, label: '1 semana antes' },
]

const DEFAULT_ALARMS = new Set([10]) // por defecto: aviso 10 min antes

export function offsetLabel(min: number): string {
  const known = REMINDER_OPTIONS.find((o) => o.min === min)
  if (known) return known.label
  if (min % 1440 === 0) return `${min / 1440} días antes`
  if (min % 60 === 0) return `${min / 60} h antes`
  return `${min} min antes`
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

function buildReminders(date: string, time: string | null, alarms: Set<number>): ReminderInput[] {
  const base = new Date(`${date}T${time || '09:00'}:00`).getTime()
  return [...alarms].sort((a, b) => a - b).map((offsetMin) => ({ offsetMin, remindAtMs: base - offsetMin * 60_000 }))
}

/** Extracto de una nota de diario para la tarjeta de la agenda. */
function journalExcerpt(content: string, maxLen = 180): string | null {
  const text = content
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`>]/g, '')
    .trim()
    .replace(/\n{2,}/g, ' · ')
    .replace(/\n/g, ' ')
  if (!text) return null
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text
}

const EMPTY_FORM = { title: '', time: '', notes: '' }

type PushState = 'unsupported' | 'off' | 'on' | 'busy'

export default function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const selected = params.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('date')!) ? params.get('date')! : todayStr()
  const [month, setMonth] = useState(selected.slice(0, 7))
  const [events, setEvents] = useState<VEvent[]>([])
  const [upcoming, setUpcoming] = useState<VEvent[]>([])
  const [journalDays, setJournalDays] = useState<Map<string, MonthDay>>(new Map())
  const [dayJournal, setDayJournal] = useState<JournalDay | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [alarms, setAlarms] = useState<Set<number>>(new Set(DEFAULT_ALARMS))
  const [error, setError] = useState<string | null>(null)
  const [push, setPush] = useState<PushState>('off')
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.events(month).then(setEvents).catch(() => {})
    api.upcomingEvents(8).then(setUpcoming).catch(() => {})
    api
      .journalMonth(month)
      .then((list) => setJournalDays(new Map(list.map((d) => [d.date, d]))))
      .catch(() => {})
  }, [month])

  useEffect(refresh, [refresh])

  useEffect(() => {
    setDayJournal(null)
    api.journal(selected).then(setDayJournal).catch(() => {})
  }, [selected])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPush('unsupported')
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPush(sub ? 'on' : 'off'))
      .catch(() => setPush('off'))
  }, [])

  const byDate = useMemo(() => {
    const map = new Map<string, VEvent[]>()
    for (const ev of events) {
      map.set(ev.date, [...(map.get(ev.date) ?? []), ev])
    }
    return map
  }, [events])

  const dayEvents = byDate.get(selected) ?? []

  const pick = (date: string) => {
    setParams({ date }, { replace: true })
    setMonth(date.slice(0, 7))
    setShowForm(false)
    setEditingId(null)
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setAlarms(new Set(DEFAULT_ALARMS))
    setEditingId(null)
    setError(null)
    setShowForm(true)
  }

  const openEdit = (ev: VEvent) => {
    setForm({ title: ev.title, time: ev.time ?? '', notes: ev.notes ?? '' })
    setAlarms(new Set(ev.reminders.map((r) => r.offset_min)))
    setEditingId(ev.id)
    setError(null)
    setShowForm(true)
  }

  const toggleAlarm = (min: number) => {
    setAlarms((prev) => {
      const next = new Set(prev)
      if (next.has(min)) next.delete(min)
      else next.add(min)
      return next
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const input = {
      title: form.title,
      date: selected,
      time: form.time || null,
      notes: form.notes || null,
      reminders: buildReminders(selected, form.time || null, alarms),
    }
    try {
      if (editingId !== null) await api.updateEvent(editingId, input)
      else await api.createEvent(input)
      setShowForm(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const remove = async (ev: VEvent) => {
    if (!confirm(`¿Borrar «${ev.title}»?`)) return
    await api.deleteEvent(ev.id)
    refresh()
  }

  const enablePush = async () => {
    setPush('busy')
    setPushMsg(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPush('off')
        setPushMsg('Permiso denegado: revisa los ajustes del navegador')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await api.pushKey()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      await api.pushSubscribe(sub.toJSON())
      setPush('on')
      setPushMsg('Avisos activados en este dispositivo ✅')
    } catch (err) {
      setPush('off')
      setPushMsg(err instanceof Error ? err.message : 'No se pudo activar')
    }
  }

  const disablePush = async () => {
    setPush('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => {})
        await sub.unsubscribe()
      }
      setPush('off')
      setPushMsg('Avisos desactivados en este dispositivo')
    } catch {
      setPush('on')
    }
  }

  const testPush = async () => {
    try {
      const { sent } = await api.pushTest()
      setPushMsg(sent > 0 ? `Aviso de prueba enviado a ${sent} dispositivo(s) 📬` : 'No hay dispositivos suscritos')
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : 'Error')
    }
  }

  // --- calendario ---
  const [y, m] = month.split('-').map(Number)
  const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const shiftMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const today = todayStr()

  return (
    <div className="mx-auto max-w-3xl overflow-auto p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">🗓 Agenda</h1>
        <div className="flex items-center gap-1.5">
          {push === 'on' && (
            <button onClick={testPush} className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800" title="Enviar aviso de prueba">
              Probar
            </button>
          )}
          {push !== 'unsupported' && (
            <button
              onClick={push === 'on' ? disablePush : enablePush}
              disabled={push === 'busy'}
              className={`rounded-lg px-2.5 py-1.5 text-xs ${
                push === 'on' ? 'bg-amber-400/15 text-amber-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              } disabled:opacity-50`}
            >
              {push === 'on' ? '🔔 Avisos activos' : push === 'busy' ? '…' : '🔕 Activar avisos'}
            </button>
          )}
        </div>
      </div>
      {push === 'unsupported' && (
        <p className="mb-3 rounded-lg border border-zinc-800 p-2.5 text-xs text-zinc-500">
          Este navegador no soporta avisos push. En iPhone: instala la app en la pantalla de inicio (Compartir →
          «Añadir a pantalla de inicio») y actívalos desde ahí.
        </p>
      )}
      {pushMsg && <p className="mb-3 text-xs text-zinc-400">{pushMsg}</p>}

      {/* Rejilla mensual */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => shiftMonth(-1)} className="rounded px-2.5 py-1 text-zinc-400 hover:bg-zinc-800">‹</button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">{monthLabel}</span>
            {month !== today.slice(0, 7) && (
              <button onClick={() => pick(today)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-amber-300">Hoy</button>
            )}
          </div>
          <button onClick={() => shiftMonth(1)} className="rounded px-2.5 py-1 text-zinc-400 hover:bg-zinc-800">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1 text-zinc-600">{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`e${i}`} />
            const evs = byDate.get(date) ?? []
            const journal = journalDays.get(date)
            const isSel = date === selected
            const isToday = date === today
            return (
              <button
                key={date}
                onClick={() => pick(date)}
                className={`flex min-h-12 flex-col items-center rounded-lg p-1 sm:min-h-16 ${
                  isSel ? 'bg-amber-400 text-zinc-950' : isToday ? 'bg-zinc-800' : 'hover:bg-zinc-800/70'
                }`}
              >
                <span className={`text-xs ${isSel ? 'font-semibold' : ''}`}>{Number(date.slice(8))}</span>
                {evs.length > 0 && (
                  <>
                    <span className="mt-0.5 flex gap-0.5 sm:hidden">
                      {evs.slice(0, 3).map((ev) => (
                        <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${isSel ? 'bg-zinc-900' : 'bg-amber-400'}`} />
                      ))}
                    </span>
                    <span className="mt-0.5 hidden w-full flex-col gap-0.5 sm:flex">
                      {evs.slice(0, 2).map((ev) => (
                        <span
                          key={ev.id}
                          className={`truncate rounded px-1 text-left text-[10px] leading-4 ${
                            isSel ? 'bg-zinc-900/20' : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {ev.title}
                        </span>
                      ))}
                      {evs.length > 2 && <span className="text-[10px] text-zinc-500">+{evs.length - 2}</span>}
                    </span>
                  </>
                )}
                {journal && (journal.hasNote || journal.attachmentCount > 0) && (
                  <span className="mt-0.5 flex gap-0.5">
                    {journal.hasNote && (
                      <span className={`h-1.5 w-1.5 rounded-full ${isSel ? 'bg-emerald-800' : 'bg-emerald-400'}`} />
                    )}
                    {journal.attachmentCount > 0 && (
                      <span className={`h-1.5 w-1.5 rounded-full ${isSel ? 'bg-sky-800' : 'bg-sky-400'}`} />
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-2 flex items-center justify-center gap-3 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> evento</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> diario</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> fotos</span>
        </p>
      </div>

      {/* Día seleccionado */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium capitalize">{formatDateEs(selected)}</h2>
          <button onClick={openCreate} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-amber-300 hover:bg-zinc-700">
            + Evento
          </button>
        </div>

        {/* Diario del día */}
        {dayJournal && (dayJournal.content || dayJournal.attachments.length > 0) && (
          <button
            onClick={() => navigate(`/journal/${selected}`)}
            className="mb-3 block w-full rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-left hover:border-emerald-400/40"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              📓 Diario del día
              {dayJournal.attachments.length > 0 &&
                ` · ${dayJournal.attachments.length} ${dayJournal.attachments.length === 1 ? 'foto' : 'fotos'}`}
              <span className="float-right font-normal normal-case text-zinc-500">abrir →</span>
            </p>
            {dayJournal.content && journalExcerpt(dayJournal.content) && (
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{journalExcerpt(dayJournal.content)}</p>
            )}
            {dayJournal.attachments.length > 0 && (
              <span className="mt-2 flex gap-2 overflow-hidden">
                {dayJournal.attachments.slice(0, 4).map((a) => (
                  <img key={a.id} src={thumbUrl(a)} alt="" loading="lazy" className="h-14 w-14 rounded-lg object-cover" />
                ))}
                {dayJournal.attachments.length > 4 && (
                  <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-800 text-xs text-zinc-400">
                    +{dayJournal.attachments.length - 4}
                  </span>
                )}
              </span>
            )}
          </button>
        )}

        {showForm && (
          <form onSubmit={submit} className="mb-3 space-y-2 rounded-xl border border-zinc-700 bg-zinc-900/60 p-3">
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Título (p. ej. Pediatra vacuna 18 meses)"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <div>
              <p className="mb-1.5 text-xs text-zinc-500">
                🔔 Avisos{!form.time && ' (sin hora, se calculan sobre las 09:00)'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map((o) => (
                  <button
                    key={o.min}
                    type="button"
                    onClick={() => toggleAlarm(o.min)}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                      alarms.has(o.min)
                        ? 'bg-amber-400 font-medium text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas (opcional)"
              rows={2}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950">
                {editingId !== null ? 'Guardar' : 'Crear'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {dayEvents.length === 0 && !showForm ? (
          <p className="rounded-xl border border-zinc-800 p-4 text-center text-sm text-zinc-600">Sin eventos este día</p>
        ) : (
          <div className="space-y-1.5">
            {dayEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 rounded-xl border border-zinc-800 px-3 py-2.5">
                <span className="w-12 shrink-0 pt-0.5 text-sm text-zinc-500">{ev.time ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{ev.title}</p>
                  {ev.reminders.length > 0 && (
                    <p className="mt-0.5 text-xs text-amber-300/80">
                      🔔 {ev.reminders.map((r) => offsetLabel(r.offset_min)).join(' · ')}
                    </p>
                  )}
                  {ev.notes && <p className="mt-0.5 text-xs text-zinc-500">{ev.notes}</p>}
                </div>
                <button onClick={() => openEdit(ev)} className="px-1 text-sm text-zinc-500 hover:text-zinc-300">✏️</button>
                <button onClick={() => remove(ev)} className="px-1 text-sm text-zinc-500 hover:text-red-400">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Próximos */}
      {upcoming.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Próximos</h2>
          <div className="space-y-1">
            {upcoming.map((ev) => (
              <button
                key={ev.id}
                onClick={() => pick(ev.date)}
                className="flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-900"
              >
                <span className="w-24 shrink-0 text-xs text-zinc-500">
                  {ev.date === today ? 'hoy' : new Date(ev.date + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  {ev.time ? ` · ${ev.time}` : ''}
                </span>
                <span className="min-w-0 truncate text-sm">
                  {ev.title} {ev.reminders.length > 0 && '🔔'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
