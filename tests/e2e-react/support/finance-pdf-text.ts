import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Download } from '@playwright/test'

// Kayıt ve finans belgelerinin (sözleşme, öğrenci belgesi) indirilen PDF metni.

/** pdfjs kök pakette kurulu olmadığı için türü yalnız okunan yüzey kadar yazılır. */
type PdfJs = {
  getDocument: (source: { data: Uint8Array; useSystemFonts: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (index: number) => Promise<{
        getTextContent: () => Promise<{ items: { str?: string }[] }>
      }>
    }>
  }
}

/** İndirilen gerçek PDF'in metni; pdfjs yalnız web paketinin bağımlılığıdır. */
export async function pdfText(download: Download): Promise<string> {
  const web = createRequire(resolve('apps/web-react/package.json'))
  const { getDocument } = (await import(
    pathToFileURL(web.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
  )) as PdfJs
  const data = new Uint8Array(await readFile(await download.path()))
  const document = await getDocument({ data, useSystemFonts: true }).promise
  const lines: string[] = []
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent()
    lines.push(...content.items.flatMap((item) => item.str ?? []))
  }
  return lines.join(' ')
}
