import type { PdfDocument, TextMeasurer } from '../../src/lib/pdf/layout.ts'

/** Sahte ölçer: karakter başına sabit genişlik (jsPDF ve yazı tipi gerekmez). */
export const measurer: TextMeasurer = {
  width: (text, size) => text.length * size * 0.18,
  wrap(text, width, size) {
    const perLine = Math.max(1, Math.floor(width / (size * 0.18)))
    const lines: string[] = []
    let current = ''
    for (const word of text.split(' ')) {
      const next = current ? `${current} ${word}` : word
      if (next.length > perLine && current) {
        lines.push(current)
        current = word
      } else current = next
    }
    lines.push(current)
    return lines
  },
}

export type Page = PdfDocument['pages'][number]

export function texts(page: Page) {
  return page.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
}

export function allTexts(document: PdfDocument) {
  return document.pages.flatMap(texts)
}
