import { useState } from 'react'
import type { TreeNode } from '../api'

interface Props {
  nodes: TreeNode[]
  selected: string | null
  onSelect: (path: string) => void
}

function Node({ node, selected, onSelect, depth }: { node: TreeNode; depth: number } & Omit<Props, 'nodes'>) {
  const [open, setOpen] = useState(depth === 0 || (selected?.startsWith(node.path + '/') ?? false))

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-zinc-400 hover:bg-zinc-900"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="text-xs">{open ? '▾' : '▸'}</span>
          <span>📁</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((c) => (
          <Node key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
        selected === node.path ? 'bg-zinc-800 text-amber-300' : 'text-zinc-300 hover:bg-zinc-900'
      }`}
      style={{ paddingLeft: `${depth * 14 + 24}px` }}
    >
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export default function FileTree({ nodes, selected, onSelect }: Props) {
  if (nodes.length === 0) {
    return <p className="px-3 py-4 text-sm text-zinc-600">No hay notas todavía</p>
  }
  return (
    <div className="space-y-0.5">
      {nodes.map((n) => (
        <Node key={n.path} node={n} depth={0} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}
