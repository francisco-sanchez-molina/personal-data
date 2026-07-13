// Genera los iconos PWA a partir de un SVG inline. Uso: node scripts/build-icons.mjs
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public')
fs.mkdirSync(out, { recursive: true })

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#27272a"/>
      <stop offset="1" stop-color="#09090b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <rect x="136" y="104" width="240" height="304" rx="24" fill="#fbbf24"/>
  <rect x="136" y="104" width="48" height="304" rx="24" fill="#f59e0b"/>
  <line x1="216" y1="176" x2="344" y2="176" stroke="#78350f" stroke-width="18" stroke-linecap="round"/>
  <line x1="216" y1="232" x2="344" y2="232" stroke="#78350f" stroke-width="18" stroke-linecap="round"/>
  <line x1="216" y1="288" x2="304" y2="288" stroke="#78350f" stroke-width="18" stroke-linecap="round"/>
</svg>`

const buf = Buffer.from(svg)
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(buf).resize(size, size).png().toFile(path.join(out, name))
  console.log(`✓ ${name}`)
}
