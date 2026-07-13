import { NavLink, Outlet } from 'react-router'
import { api, todayStr } from '../api'

const tabs = [
  { to: `/journal/${todayStr()}`, match: '/journal', label: 'Diario', icon: '📅' },
  { to: '/calendar', match: '/calendar', label: 'Agenda', icon: '🗓' },
  { to: '/notes', match: '/notes', label: 'Notas', icon: '📝' },
  { to: '/collections', match: '/collections', label: 'Colecciones', short: 'Colecc.', icon: '🗂' },
  { to: '/search', match: '/search', label: 'Buscar', icon: '🔍' },
  { to: '/memories', match: '/memories', label: 'Recuerdos', icon: '✨' },
]

export default function Layout({ onLogout }: { onLogout: () => void }) {
  const logout = async () => {
    await api.logout().catch(() => {})
    onLogout()
  }

  const link = (active: boolean) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
      active ? 'bg-zinc-800 text-amber-300' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
    }`

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar escritorio */}
      <aside className="hidden w-48 shrink-0 flex-col border-r border-zinc-800 p-3 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
          <span>📓</span> Vault
        </div>
        <nav className="flex flex-col gap-1">
          {tabs.map((t) => (
            <NavLink key={t.match} to={t.to} className={({ isActive }) => link(isActive)}>
              <span>{t.icon}</span> {t.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="mt-auto rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
        >
          Salir
        </button>
      </aside>

      {/* Contenido */}
      <main className="min-h-0 flex-1 overflow-hidden pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Nav inferior móvil */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <NavLink
            key={t.match}
            to={t.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                isActive ? 'text-amber-300' : 'text-zinc-500'
              }`
            }
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {(t as { short?: string }).short ?? t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
