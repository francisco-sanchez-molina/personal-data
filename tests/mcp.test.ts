import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { writeNote } from '../server/vault'
import { makeCtx, type TestCtx } from './helpers'

describe('servidor MCP', () => {
  let ctx: TestCtx
  let server: ReturnType<typeof serve>
  let baseUrl: string

  beforeAll(async () => {
    ctx = makeCtx()
    await new Promise<void>((resolve) => {
      server = serve({ fetch: ctx.app.fetch, port: 0 }, (info) => {
        baseUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    ctx.cleanup()
  })

  it('rechaza peticiones sin token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
    })
    expect(res.status).toBe(401)
  })

  it('un cliente MCP puede listar herramientas y usarlas', async () => {
    writeNote(ctx.cfg.vaultDir, 'ideas.md', '# Ideas\n\nMontar un huerto.')

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer test-mcp-token' } },
    })
    const client = new Client({ name: 'test-client', version: '0.0.1' })
    await client.connect(transport)

    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain('read_note')
    expect(names).toContain('append_journal')
    expect(names).toContain('get_memories')
    expect(names).toContain('search_notes')

    const read = await client.callTool({ name: 'read_note', arguments: { path: 'ideas.md' } })
    expect(JSON.stringify(read.content)).toContain('huerto')

    await client.callTool({
      name: 'append_journal',
      arguments: { date: '2026-07-12', text: 'Sesión de fuerza: press banca 4x8.' },
    })
    const journal = await client.callTool({
      name: 'read_journal',
      arguments: { date: '2026-07-12' },
    })
    expect(JSON.stringify(journal.content)).toContain('press banca')

    // lo escrito por MCP queda indexado para búsqueda
    const found = await client.callTool({ name: 'search_notes', arguments: { query: 'banca' } })
    expect(JSON.stringify(found.content)).toContain('journal/2026/2026-07-12.md')

    await client.close()
  })
})
