export default function TagChip({
  tag,
  count,
  active = false,
  onClick,
}: {
  tag: string
  count?: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'bg-amber-400 font-medium text-zinc-950'
          : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      #{tag}
      {count !== undefined && <span className={active ? 'ml-1 opacity-70' : 'ml-1 text-zinc-500'}>{count}</span>}
    </button>
  )
}
