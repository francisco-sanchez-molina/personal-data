import { useState } from 'react'
import { api, ApiError } from '../api'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onLogin()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error de red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <div className="text-center">
          <div className="text-5xl">📓</div>
          <h1 className="mt-2 text-xl font-semibold">Personal Vault</h1>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base outline-none focus:border-amber-400"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-lg bg-amber-400 py-3 font-medium text-zinc-950 disabled:opacity-50"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
