import { describe, expect, it } from 'vitest'
import { imageMarkdown, fileUrl, DEFAULT_IMAGE_WIDTH, type Attachment } from '../web/src/api'

const attachment: Attachment = {
  id: 1,
  date: '2026-07-13',
  filename: '1234-foto.jpg',
  original_name: 'Foto Receta.jpg',
  mime: 'image/jpeg',
  width: 800,
  height: 600,
}

describe('imageMarkdown', () => {
  it('inserta el ancho por defecto con sintaxis estilo Obsidian (alt|ancho)', () => {
    expect(imageMarkdown(attachment)).toBe(`![Foto Receta|${DEFAULT_IMAGE_WIDTH}](${fileUrl(attachment)})\n`)
  })

  it('admite un ancho distinto o ninguno', () => {
    expect(imageMarkdown(attachment, 800)).toBe(`![Foto Receta|800](${fileUrl(attachment)})\n`)
    expect(imageMarkdown(attachment, null)).toBe(`![Foto Receta](${fileUrl(attachment)})\n`)
  })

  it('quita corchetes y barras del alt para no romper la sintaxis de ancho', () => {
    const weird = { ...attachment, original_name: 'a|b[c].png' }
    expect(imageMarkdown(weird)).toBe(`![abc|${DEFAULT_IMAGE_WIDTH}](${fileUrl(weird)})\n`)
  })

  it('sin nombre original, el alt queda vacío pero mantiene el ancho', () => {
    const noName = { ...attachment, original_name: null }
    expect(imageMarkdown(noName)).toBe(`![|${DEFAULT_IMAGE_WIDTH}](${fileUrl(noName)})\n`)
  })
})
