export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'note'
  children?: TreeNode[]
}

export interface Attachment {
  id: number
  date: string
  filename: string
  original_name: string | null
  mime: string
  width: number | null
  height: number | null
}

export interface JournalDay {
  date: string
  content: string | null
  attachments: Attachment[]
}

export interface MonthDay {
  date: string
  hasNote: boolean
  attachmentCount: number
}

export interface Memory {
  date: string
  yearsAgo: number
  excerpt: string | null
  attachments: Attachment[]
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
  tags: string[]
}

export interface TagCount {
  tag: string
  count: number
}

export interface VReminder {
  id: number
  event_id: number
  offset_min: number
  remind_at: number
  notified_at: number | null
}

export interface VEvent {
  id: number
  title: string
  date: string
  time: string | null
  notes: string | null
  reminders: VReminder[]
}

export interface ReminderInput {
  offsetMin: number
  remindAtMs: number
}

export interface Collection {
  id: number
  name: string
  icon: string
  folder: string
  template: string | null
  position: number
  noteCount: number
}

export interface CollectionNote {
  path: string
  title: string
  mtime: number
  tags: string[]
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401 && !url.endsWith('/login')) onUnauthorized?.()
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError((body as { error?: string }).error ?? 'Error', res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: (password: string) => req<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST' }),
  me: () => req<{ ok: true }>('/api/me'),
  tree: () => req<TreeNode[]>('/api/tree'),
  readNote: (path: string) => req<{ path: string; content: string }>(`/api/note?path=${encodeURIComponent(path)}`),
  saveNote: (path: string, content: string) =>
    req<{ ok: true }>('/api/note', { method: 'PUT', body: JSON.stringify({ path, content }) }),
  createNote: (path: string, content = '') =>
    req<{ ok: true; path: string }>('/api/note', { method: 'POST', body: JSON.stringify({ path, content }) }),
  deleteNote: (path: string) => req<{ ok: true }>(`/api/note?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameNote: (from: string, to: string) =>
    req<{ ok: true }>('/api/note/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),
  search: (q: string) => req<{ notes: SearchHit[]; events: VEvent[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  tags: () => req<TagCount[]>('/api/tags'),
  journal: (date: string) => req<JournalDay>(`/api/journal/${date}`),
  saveJournal: (date: string, content: string) =>
    req<{ ok: true }>(`/api/journal/${date}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  journalMonth: (month: string) => req<MonthDay[]>(`/api/journal/month?month=${month}`),
  memories: (date: string) => req<Memory[]>(`/api/memories?date=${date}`),
  uploadAttachments: (date: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return req<Attachment[]>(`/api/journal/${date}/attachments`, { method: 'POST', body: fd })
  },
  uploadNoteImages: (files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return req<Attachment[]>('/api/attachments', { method: 'POST', body: fd })
  },
  deleteAttachment: (id: number) => req<{ ok: true }>(`/api/attachments/${id}`, { method: 'DELETE' }),
  collections: () => req<Collection[]>('/api/collections'),
  createCollection: (input: { name: string; icon?: string; folder?: string; template?: string }) =>
    req<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(input) }),
  updateCollection: (id: number, input: { name?: string; icon?: string; template?: string }) =>
    req<Collection>(`/api/collections/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteCollection: (id: number) => req<{ ok: true }>(`/api/collections/${id}`, { method: 'DELETE' }),
  collectionNotes: (id: number) =>
    req<{ collection: Collection; notes: CollectionNote[] }>(`/api/collections/${id}/notes`),
  createCollectionNote: (id: number, title: string) =>
    req<{ path: string }>(`/api/collections/${id}/notes`, { method: 'POST', body: JSON.stringify({ title }) }),
  events: (month: string) => req<VEvent[]>(`/api/events?month=${month}`),
  upcomingEvents: (limit = 10) => req<VEvent[]>(`/api/events/upcoming?limit=${limit}`),
  createEvent: (input: { title: string; date: string; time?: string | null; notes?: string | null; reminders?: ReminderInput[] }) =>
    req<VEvent>('/api/events', { method: 'POST', body: JSON.stringify(input) }),
  updateEvent: (id: number, input: Partial<{ title: string; date: string; time: string | null; notes: string | null; reminders: ReminderInput[] }>) =>
    req<VEvent>(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteEvent: (id: number) => req<{ ok: true }>(`/api/events/${id}`, { method: 'DELETE' }),
  pushKey: () => req<{ publicKey: string; devices: number }>('/api/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) =>
    req<{ ok: true; devices: number }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: true }>('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  pushTest: () => req<{ sent: number }>('/api/push/test', { method: 'POST' }),
}

export function fileUrl(a: Attachment): string {
  return `/api/files/${a.date}/${a.filename}`
}

/** Markdown de imagen para insertar en el editor tras subirla. */
export function imageMarkdown(a: Attachment): string {
  const alt = (a.original_name ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '')
  return `![${alt}](${fileUrl(a)})\n`
}

export function thumbUrl(a: Attachment): string {
  return `/api/files/${a.date}/${a.filename.replace(/\.[a-z]+$/, '')}.thumb.jpg`
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDateEs(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
