import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api'

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start: (src: string) => src.indexOf('[['),
      tokenizer(src: string) {
        const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src)
        if (!m) return undefined
        return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] ?? m[1]).trim() }
      },
      renderer(token) {
        const t = token as unknown as { target: string; label: string }
        return `<a href="#" data-wiki="${t.target.replaceAll('"', '&quot;')}" class="wikilink">${t.label}</a>`
      },
    },
    {
      name: 'hashtag',
      level: 'inline',
      start: (src: string) => src.indexOf('#'),
      tokenizer(src: string) {
        const m = /^#([\p{L}\p{N}][\p{L}\p{N}/_-]*)/u.exec(src)
        if (!m) return undefined
        return { type: 'hashtag', raw: m[0], tag: m[1].toLowerCase() }
      },
      renderer(token) {
        const t = token as unknown as { tag: string; raw: string }
        return `<a href="#" data-tag="${t.tag.replaceAll('"', '&quot;')}" class="tag-chip">${t.raw}</a>`
      },
    },
  ],
})

async function resolveWikiLink(name: string): Promise<string | null> {
  const tree = await api.tree()
  const lower = name.toLowerCase()
  const stack = [...tree]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'note' && n.name.toLowerCase() === lower) return n.path
    if (n.children) stack.push(...n.children)
  }
  return null
}

export default function MarkdownPreview({ content }: { content: string }) {
  const navigate = useNavigate()

  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false })
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-wiki', 'data-tag'] })
  }, [content])

  const onClick = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const tag = a.getAttribute('data-tag')
    if (tag) {
      e.preventDefault()
      navigate(`/search?q=${encodeURIComponent('#' + tag)}`)
      return
    }
    const wiki = a.getAttribute('data-wiki')
    if (wiki) {
      e.preventDefault()
      const path = await resolveWikiLink(wiki)
      if (path) navigate(`/notes/${path}`)
      else if (confirm(`La nota «${wiki}» no existe. ¿Crearla?`)) {
        const newPath = `${wiki}.md`
        await api.createNote(newPath, `# ${wiki}\n\n`)
        navigate(`/notes/${newPath}`)
      }
    } else if (a.host !== location.host) {
      // enlaces externos en pestaña nueva
      e.preventDefault()
      window.open(a.href, '_blank', 'noopener')
    }
  }

  return (
    <div
      onClick={onClick}
      className="prose prose-invert prose-zinc h-full max-w-none overflow-auto p-4 prose-headings:font-semibold prose-a:text-amber-300 prose-img:rounded-lg [&_.wikilink]:cursor-pointer [&_.wikilink]:underline [&_.wikilink]:decoration-dotted [&_.tag-chip]:cursor-pointer [&_.tag-chip]:rounded-full [&_.tag-chip]:bg-zinc-800 [&_.tag-chip]:px-2 [&_.tag-chip]:py-0.5 [&_.tag-chip]:text-xs [&_.tag-chip]:font-medium [&_.tag-chip]:text-amber-200 [&_.tag-chip]:no-underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
