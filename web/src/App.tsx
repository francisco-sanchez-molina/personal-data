import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { api, setUnauthorizedHandler, todayStr } from './api'
import Login from './components/Login'
import Layout from './components/Layout'
import NotesPage from './components/NotesPage'
import JournalPage from './components/JournalPage'
import SearchPage from './components/SearchPage'
import MemoriesPage from './components/MemoriesPage'
import CollectionsPage from './components/CollectionsPage'
import CollectionNotesPage from './components/CollectionNotesPage'
import CalendarPage from './components/CalendarPage'

type AuthState = 'checking' | 'anon' | 'authed'

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking')

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('anon'))
    api
      .me()
      .then(() => setAuth('authed'))
      .catch(() => setAuth('anon'))
  }, [])

  if (auth === 'checking') {
    return <div className="flex h-full items-center justify-center text-zinc-500">Cargando…</div>
  }
  if (auth === 'anon') {
    return <Login onLogin={() => setAuth('authed')} />
  }

  return (
    <Routes>
      <Route element={<Layout onLogout={() => setAuth('anon')} />}>
        <Route path="/" element={<Navigate to={`/journal/${todayStr()}`} replace />} />
        <Route path="/journal/:date" element={<JournalPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/*" element={<NotesPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/collections/:id" element={<CollectionNotesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
