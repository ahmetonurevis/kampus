// PDF çizimi: jsPDF ve Türkçe yazı tipi yalnız bu modülde yüklenir. Modül yalnız dinamik
// `import()` ile çağrılır (`use-document-pdf.ts`); ilk JS paketine girmez.
import type { jsPDF } from 'jspdf'
import type { PdfDocument, PdfOp, TextMeasurer } from './layout.ts'

/** Noto Sans Regular (OFL): Türkçe karakterleri içerir; `public/fonts` altından sunulur. */
const FONT_FILE = 'NotoSans-Regular.ttf'
const FONT_FAMILY = 'NotoSans'

let fontPromise: Promise<string> | undefined

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  return btoa(binary)
}

/** Yazı tipi bir kez indirilir; hata önbellekte kalmaz (yeniden denemede tekrar istenir). */
function loadFont(): Promise<string> {
  fontPromise ??= fetch(`${import.meta.env.BASE_URL}fonts/${FONT_FILE}`)
    .then((response) => {
      if (!response.ok) throw new Error(`Yazı tipi yüklenemedi (${response.status})`)
      return response.arrayBuffer()
    })
    .then(toBase64)
    .catch((cause: unknown) => {
      fontPromise = undefined
      throw cause
    })
  return fontPromise
}

async function createPdf(): Promise<jsPDF> {
  const [{ jsPDF: JsPdf }, font] = await Promise.all([import('jspdf'), loadFont()])
  const pdf = new JsPdf({ compress: true })
  pdf.addFileToVFS(FONT_FILE, font)
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal')
  pdf.setFont(FONT_FAMILY)
  return pdf
}

function measurerFor(pdf: jsPDF): TextMeasurer {
  return {
    wrap(text, width, size) {
      pdf.setFontSize(size)
      return pdf.splitTextToSize(text, width)
    },
    width(text, size) {
      pdf.setFontSize(size)
      return pdf.getTextWidth(text)
    },
  }
}

function draw(pdf: jsPDF, op: PdfOp) {
  switch (op.kind) {
    case 'text':
      pdf.setFontSize(op.size)
      pdf.setTextColor(...op.color)
      pdf.text(op.text, op.x, op.y, { align: op.align })
      return
    case 'rect':
      pdf.setFillColor(...op.fill)
      if (op.radius > 0) pdf.roundedRect(op.x, op.y, op.width, op.height, op.radius, op.radius, 'F')
      else pdf.rect(op.x, op.y, op.width, op.height, 'F')
      return
    case 'line':
      pdf.setDrawColor(...op.color)
      pdf.setLineWidth(op.thickness)
      pdf.line(op.x, op.y, op.x + op.width, op.y)
      return
    default:
      op satisfies never
  }
}

export type RenderedPdf = { blob: Blob; pages: number }

/**
 * Yerleşimi jsPDF ölçüsüyle kurar (`build`) ve PDF Blob'u üretir. Ölçer yazı tipi yüklendikten
 * sonra verildiği için sayfa kırma gerçek metin genişliğine göre yapılır.
 */
export async function renderPdf(
  build: (measurer: TextMeasurer) => PdfDocument,
): Promise<RenderedPdf> {
  const pdf = await createPdf()
  const document = build(measurerFor(pdf))
  document.pages.forEach((page, index) => {
    if (index > 0) pdf.addPage()
    pdf.setPage(index + 1)
    for (const op of page.ops) draw(pdf, op)
  })
  pdf.setProperties(document.metadata)
  return { blob: pdf.output('blob'), pages: document.pages.length }
}
