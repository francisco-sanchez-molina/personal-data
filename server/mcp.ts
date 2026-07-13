import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Config } from './config'
import type { DB } from './db'
import * as vault from './vault'
import { indexNote, removeFromIndex, searchNotes, listTags } from './indexer'
import { isValidDate, journalRelPath, readJournalDay, memoriesFor } from './journal'
import { listCollections } from './collections'
import { createEvent, deleteEvent, eventsInRange, eventBaseMs, searchEvents } from './events'
import { safeEqual } from './auth'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD')

function text(data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    ],
  }
}

export function buildMcpServer(cfg: Config, db: DB): McpServer {
  const server = new McpServer({ name: 'personal-vault', version: '0.1.0' })

  const write = (rel: string, content: string) => {
    vault.writeNote(cfg.vaultDir, rel, content)
    indexNote(db, rel, content, Date.now(), Buffer.byteLength(content))
  }

  server.registerTool(
    'list_notes',
    {
      title: 'Listar notas',
      description:
        'Lista todas las notas del vault (rutas relativas .md). Las notas de diario viven en journal/YYYY/YYYY-MM-DD.md.',
      inputSchema: {},
    },
    async () => text(vault.listAllNotes(cfg.vaultDir).map((n) => n.path))
  )

  server.registerTool(
    'read_note',
    {
      title: 'Leer nota',
      description: 'Devuelve el contenido markdown de una nota por su ruta relativa.',
      inputSchema: { path: z.string().describe('Ruta relativa, p. ej. "proyectos/casa.md"') },
    },
    async ({ path: rel }) => text(vault.readNote(cfg.vaultDir, rel))
  )

  server.registerTool(
    'write_note',
    {
      title: 'Escribir nota',
      description: 'Crea o sobreescribe una nota markdown en la ruta indicada (crea carpetas si hacen falta).',
      inputSchema: {
        path: z.string().describe('Ruta relativa terminada en .md'),
        content: z.string().describe('Contenido markdown completo'),
      },
    },
    async ({ path: rel, content }) => {
      write(rel, content)
      return text(`Nota guardada en ${rel}`)
    }
  )

  server.registerTool(
    'delete_note',
    {
      title: 'Borrar nota',
      description: 'Elimina una nota del vault.',
      inputSchema: { path: z.string() },
    },
    async ({ path: rel }) => {
      vault.deleteNote(cfg.vaultDir, rel)
      removeFromIndex(db, rel)
      return text(`Nota ${rel} eliminada`)
    }
  )

  server.registerTool(
    'search_notes',
    {
      title: 'Buscar notas y eventos',
      description:
        'Búsqueda de texto completo (FTS5, sin distinguir acentos) sobre todas las notas, y también sobre los eventos de la agenda (título y notas del evento, con sus recordatorios). Admite filtros de tag con #: "#cena arroz" busca "arroz" solo en notas con el tag "cena"; solo tags (p. ej. "#comida #pollo") lista las notas que tienen todos esos tags (los eventos no tienen tags).',
      inputSchema: { query: z.string().describe('Términos de búsqueda y/o filtros #tag') },
    },
    async ({ query }) => {
      const today = new Date().toISOString().slice(0, 10)
      return text({ notes: searchNotes(db, query), events: searchEvents(db, query, today) })
    }
  )

  server.registerTool(
    'list_tags',
    {
      title: 'Listar tags',
      description:
        'Lista todos los tags usados en las notas (hashtags #asi o frontmatter YAML) con su número de notas. Útil para saber cómo clasifica el usuario (p. ej. #comida, #cena, #pollo en Recetas).',
      inputSchema: {},
    },
    async () => text(listTags(db))
  )

  server.registerTool(
    'read_journal',
    {
      title: 'Leer diario',
      description: 'Devuelve la entrada de diario de una fecha (contenido y lista de fotos adjuntas).',
      inputSchema: { date: dateSchema },
    },
    async ({ date }) => {
      if (!isValidDate(date)) throw new Error('Fecha inválida')
      return text(readJournalDay(cfg, db, date))
    }
  )

  server.registerTool(
    'append_journal',
    {
      title: 'Añadir al diario',
      description:
        'Añade un bloque de texto al final de la entrada de diario de una fecha. Si no existe, la crea con un título "# YYYY-MM-DD".',
      inputSchema: { date: dateSchema, text: z.string().describe('Texto markdown a añadir') },
    },
    async ({ date, text: block }) => {
      if (!isValidDate(date)) throw new Error('Fecha inválida')
      const rel = journalRelPath(date)
      const existing = vault.noteExists(cfg.vaultDir, rel) ? vault.readNote(cfg.vaultDir, rel) : `# ${date}\n`
      write(rel, existing.replace(/\n*$/, '\n\n') + block.trim() + '\n')
      return text(`Añadido a ${rel}`)
    }
  )

  server.registerTool(
    'list_collections',
    {
      title: 'Listar colecciones',
      description:
        'Lista las colecciones del usuario (categorías como "Recetas" o "Médico peque") con su carpeta y nº de notas. Para añadir una nota a una colección, usa write_note con ruta "<folder>/<nombre>.md".',
      inputSchema: {},
    },
    async () =>
      text(
        listCollections(db).map((col) => ({
          name: col.name,
          icon: col.icon,
          folder: col.folder,
          noteCount: col.noteCount,
        }))
      )
  )

  server.registerTool(
    'list_events',
    {
      title: 'Listar eventos',
      description:
        'Lista los eventos de la agenda entre dos fechas (por defecto, los próximos 30 días). Cada evento puede tener hora y aviso push.',
      inputSchema: {
        from: dateSchema.optional().describe('Desde (YYYY-MM-DD), por defecto hoy'),
        to: dateSchema.optional().describe('Hasta (YYYY-MM-DD), por defecto hoy + 30 días'),
      },
    },
    async ({ from, to }) => {
      const today = new Date()
      const defFrom = today.toISOString().slice(0, 10)
      const defTo = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
      return text(eventsInRange(db, from ?? defFrom, to ?? defTo))
    }
  )

  server.registerTool(
    'create_event',
    {
      title: 'Crear evento',
      description:
        'Crea un evento en la agenda con avisos push al móvil. remindMinutesBefore admite uno o varios valores en minutos de antelación (p. ej. [10, 1440] = 10 min antes y 1 día antes); si se omite, se pone el aviso por defecto de 10 min antes; pásalo como [] para no avisar. Sin hora, los avisos se calculan sobre las 09:00.',
      inputSchema: {
        title: z.string().describe('Título del evento'),
        date: dateSchema,
        time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Hora HH:MM, opcional'),
        notes: z.string().optional(),
        remindMinutesBefore: z
          .union([z.number().int().min(0), z.array(z.number().int().min(0))])
          .optional()
          .describe('Antelación en minutos, valor único o lista; omitir = [10]; [] = sin aviso'),
      },
    },
    async ({ title, date, time, notes, remindMinutesBefore }) => {
      const offsets =
        remindMinutesBefore === undefined
          ? [10]
          : Array.isArray(remindMinutesBefore)
            ? remindMinutesBefore
            : [remindMinutesBefore]
      const base = eventBaseMs(date, time ?? null)
      const reminders = offsets.map((offsetMin) => ({ offsetMin, remindAtMs: base - offsetMin * 60_000 }))
      return text(createEvent(db, { title, date, time: time ?? null, notes: notes ?? null, reminders }))
    }
  )

  server.registerTool(
    'delete_event',
    {
      title: 'Borrar evento',
      description: 'Elimina un evento de la agenda por su id.',
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      deleteEvent(db, id)
      return text(`Evento ${id} eliminado`)
    }
  )

  server.registerTool(
    'get_memories',
    {
      title: 'Recuerdos',
      description:
        'Devuelve los "recuerdos" de una fecha: entradas de diario y fotos del mismo día/mes en años anteriores.',
      inputSchema: { date: dateSchema },
    },
    async ({ date }) => {
      if (!isValidDate(date)) throw new Error('Fecha inválida')
      return text(memoriesFor(cfg, db, date))
    }
  )

  return server
}

export function mcpHandler(cfg: Config, db: DB) {
  return async (c: Context) => {
    if (!cfg.mcpToken) return c.json({ error: 'MCP deshabilitado (falta MCP_TOKEN)' }, 404)
    const auth = c.req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token || !safeEqual(token, cfg.mcpToken)) {
      return c.json({ error: 'Token MCP inválido' }, 401)
    }
    // Stateless: servidor y transporte nuevos por petición
    const server = buildMcpServer(cfg, db)
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    return transport.handleRequest(c)
  }
}
