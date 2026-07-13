# Personal Vault

> Tus notas markdown y tu diario personal, centralizados entre móvil y ordenador. Una especie de Obsidian self-hosted: vault de ficheros `.md` reales, diario por fechas con fotos, "recuerdos" tipo *tal día como hoy*, búsqueda full-text y un servidor MCP para que la IA lea y escriba tus notas.

**Qué es**: un proyecto personal para tener tus notas accesibles desde cualquier dispositivo sin depender de Obsidian Sync ni de la nube de nadie. Login con una contraseña, editor markdown con preview, diario con fotos, y deploy a Coolify con un Dockerfile.

**Qué no es**: multi-usuario, ni colaborativo, ni un clon completo de Obsidian (no hay grafo, plugins ni canvas).

---

## Features

- 🔐 **Login con contraseña única** (env var) + cookie firmada HMAC + rate-limit 5 intentos/min/IP
- 📝 **Vault de ficheros `.md` reales** en disco: portable, backup = copiar carpeta, compatible con Obsidian/cualquier editor
- ✍️ **Editor CodeMirror 6** con resaltado markdown, autosave (1,5 s) y `Cmd+S`, más vista renderizada (GFM)
- 🔗 **Wikilinks** `[[nota]]` en la vista: navegan a la nota, y ofrecen crearla si no existe
- 🗂 **Colecciones genéricas**: categorías que defines tú (Recetas 🍲, Médico peque 🩺, Libros 📚…) con icono y plantilla opcional (`{{title}}`, `{{date}}`); por debajo son carpetas normales del vault, y quitar una colección nunca borra sus notas
- 🗓 **Agenda con alarmas**: calendario mensual de eventos (con o sin hora) con **varios avisos por evento** — combina «a la hora», 10/30 min, 1 h, 1 día o 1 semana antes (por defecto, 10 min antes). Cada aviso se dispara por separado. La rejilla marca también los días con **diario** (punto verde) y **fotos** (punto azul), y al seleccionar un día se muestra la entrada del diario con sus fotos, enlazada. Las claves VAPID se generan solas en `data/vapid.json`; el planificador comprueba cada minuto y los avisos que pillan al servidor apagado se recuperan al arrancar (hasta 24 h)
- 📅 **Diario por fechas** (`journal/YYYY/YYYY-MM-DD.md` dentro del vault) con calendario mensual y puntos en los días con contenido
- 📷 **Fotos y capturas por día**: drag&drop o botón de subir; recompresión a JPEG ≤2560 px con `sharp` (las capturas PNG pequeñas se quedan en PNG), thumbnails, lightbox
- ✨ **Recuerdos**: "tal día como hoy hace N años" — entradas y fotos del mismo día en años anteriores, en el diario y en su propia pestaña
- 🏷 **Tags estilo Obsidian**: escribe `#comida`, `#cena` o `#pollo` en cualquier nota (o frontmatter YAML `tags:`) y el índice los extrae solo — viajan dentro del `.md`, sin base de datos propietaria. Chips de filtro en la búsqueda y en cada colección, tags clicables en la vista renderizada, y tags anidados (`#medico/vacunas`)
- 🔍 **Búsqueda full-text** (SQLite FTS5, sin distinguir acentos, por prefijo) combinable con tags: `#cena arroz` busca "arroz" solo en notas etiquetadas `#cena`
- 🤖 **Servidor MCP embebido** (`/mcp`, streamable HTTP + Bearer token): la IA puede listar, leer, escribir y buscar notas, añadir al diario y consultar recuerdos
- 📱 **PWA instalable**: añádela a la pantalla de inicio del móvil y se abre a pantalla completa
- 🔄 **Índice autoreparable**: al arrancar se reconcilia con los `.md` del disco, así puedes editar el vault por fuera (Syncthing, ssh, Obsidian…)
- 🐳 **Dockerfile multi-stage** listo para Coolify, con volumen `/data` para persistencia

## Stack

- **Hono** + `@hono/node-server` (API, estáticos y MCP en un solo proceso Node 22)
- **React 19** + **Vite** + **Tailwind v4** (SPA)
- **CodeMirror 6** para el editor, **marked** + **DOMPurify** para el preview
- **better-sqlite3** para índice FTS5 y metadata de fotos (`data/db.sqlite`)
- **sharp** para recompresión y thumbnails
- **@hono/mcp** + `@modelcontextprotocol/sdk` para el servidor MCP

## Estructura de datos

```
data/
├── vault/                    # tus notas .md (esto ES tu vault)
│   ├── loquesea.md
│   └── journal/
│       └── 2026/
│           └── 2026-07-12.md # entradas de diario, una por día
├── uploads/
│   └── 2026-07-12/           # fotos del día + thumbnails
└── db.sqlite                 # índice de búsqueda + metadata de fotos
```

Hacer backup = copiar `data/`. El vault son ficheros de texto normales: puedes abrirlo con Obsidian en el ordenador si te apetece.

## Setup local

```bash
pnpm install
cp .env.example .env
# Edita .env:
#   APP_PASSWORD=loquequieras
#   SESSION_SECRET=$(openssl rand -hex 32)
#   MCP_TOKEN=$(openssl rand -hex 32)
```

## Desarrollo

```bash
pnpm dev
# Frontend con HMR en http://localhost:5173 (proxy → API en :8787)
```

## Producción (local)

```bash
pnpm build
pnpm start
# http://localhost:8787
```

## Deploy en Coolify

1. Sube el repo a un Git que vea tu Coolify.
2. Nueva app → **Dockerfile**. Puerto expuesto: `8787`.
3. Variables de entorno: `APP_PASSWORD`, `SESSION_SECRET`, `MCP_TOKEN` y `TZ=Europe/Madrid` (para que las alarmas usen tu hora).
4. **Volumen persistente**: monta `/data` (aquí viven las notas, las fotos y la base de datos).
5. Deploy. Con dominio + HTTPS delante, la cookie sale con `Secure` automáticamente (`NODE_ENV=production`).

También puedes probar la imagen en local:

```bash
pnpm docker:build
pnpm docker:run
```

## Conectar la IA por MCP

El endpoint es `https://tu-dominio/mcp` con auth `Bearer`. Para Claude Code:

```bash
claude mcp add --transport http vault https://tu-dominio/mcp \
  --header "Authorization: Bearer TU_MCP_TOKEN"
```

Herramientas disponibles: `list_notes`, `read_note`, `write_note`, `delete_note`, `search_notes` (admite filtros `#tag`), `list_tags`, `list_collections`, `read_journal`, `append_journal`, `get_memories`, `list_events`, `create_event`, `delete_event`.

Ejemplos de lo que puedes pedirle a la IA:

- «Apunta en mi diario de hoy que hice 5×400 m en 1:32»
- «Añade a Recetas la paella de mi madre: …»
- «¿Cuándo fue la última vacuna del peque?» (busca en la colección Médico peque)
- «Recuérdame mañana a las 10 la revisión del pediatra» (crea evento con aviso push)
- «¿Qué recuerdos tengo de un 12 de julio?»

## Avisos push en el móvil

1. Despliega con HTTPS (Coolify + dominio ya te lo da; los push **no funcionan por http** salvo en localhost).
2. En el móvil, abre la app y ve a **Agenda → 🔕 Activar avisos**. Acepta el permiso de notificaciones.
   - **iPhone**: primero instala la PWA (Safari → Compartir → «Añadir a pantalla de inicio») y actívalos desde la app instalada (requisito de iOS 16.4+).
   - **Android**: funciona directamente en Chrome, con o sin instalar.
3. Prueba con el botón **Probar**: debería llegarte una notificación al momento.
4. Cada dispositivo se suscribe por separado (puedes tener móvil + ordenador). Las suscripciones caducadas se limpian solas.

## Tests

```bash
pnpm test        # vitest: auth, vault, diario, recuerdos, búsqueda y MCP end-to-end
pnpm typecheck
```

## Licencia

MIT
