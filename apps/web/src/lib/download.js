import { reactive, shallowRef } from 'vue'
import { state, notify, logError } from '../stores/demo.js'
import { documentData } from './document-data.js'
import { renderDocument } from './pdf-layout.js'
function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function exportCsv(name, columns, rows) {
  const cell = (value) =>
    `"${String(value ?? '')
      .replace(/^\s*[=+@-]/, "'$&")
      .replaceAll('"', '""')}"`
  const content = [
    columns.map((c) => cell(c.label)).join(';'),
    ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(';')),
  ].join('\r\n')
  save(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)
  notify('Rapor indirildi.')
}
let fontPromise
export const pendingDocuments = reactive(new Set())
export const pdfPreview = shallowRef(null)
const documentTitles = {
  receipt: 'Tahsilat dekontu',
  contract: 'Eğitim sözleşmesi',
  'payment-plan': 'Taksit taahhütnamesi',
  material: 'Ders çalışma kâğıdı',
  homework: 'Ödev çalışma kâğıdı',
  submission: 'Ödev değerlendirme formu',
}
let previewRequest = 0
async function createPdf(type, recordId, filename, studentId) {
  const data = JSON.parse(JSON.stringify(documentData(state, type, recordId, studentId)))
  const { jsPDF } = await import('jspdf')
  if (!fontPromise)
    fontPromise = fetch('/fonts/NotoSans-Regular.ttf')
      .then((r) => {
        if (!r.ok) throw new Error('Font yüklenemedi')
        return r.arrayBuffer()
      })
      .then((buffer) => {
        let binary = ''
        for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
        return btoa(binary)
      })
  const font = await fontPromise
  const pdf = new jsPDF({ compress: true })
  pdf.addFileToVFS('NotoSans.ttf', font)
  pdf.addFont('NotoSans.ttf', 'NotoSans', 'normal')
  pdf.setFont('NotoSans')
  renderDocument(pdf, type, data)
  const safeName = (filename || `${type}-${recordId}.pdf`)
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 180)
  return {
    blob: pdf.output('blob'),
    filename: safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`,
    pages: pdf.getNumberOfPages(),
  }
}
export function closePdfPreview() {
  previewRequest++
  if (pdfPreview.value?.url) URL.revokeObjectURL(pdfPreview.value.url)
  pdfPreview.value = null
}
export async function previewPdf(type, recordId, filename, studentId) {
  const key = `${type}:${recordId}`
  if (pendingDocuments.has(key)) return
  closePdfPreview()
  const request = previewRequest
  const descriptor = { type, recordId, filename, studentId }
  pdfPreview.value = { ...descriptor, title: documentTitles[type] || 'Belge', loading: true }
  pendingDocuments.add(key)
  try {
    const result = await createPdf(type, recordId, filename, studentId)
    if (request !== previewRequest) return
    pdfPreview.value = {
      ...descriptor,
      ...result,
      title: documentTitles[type],
      url: URL.createObjectURL(result.blob),
      loading: false,
    }
  } catch (error) {
    fontPromise = undefined
    logError(error, 'pdf')
    if (request === previewRequest) {
      pdfPreview.value = {
        ...descriptor,
        title: documentTitles[type] || 'Belge',
        loading: false,
        error: 'Belge hazırlanamadı. Lütfen yeniden deneyin.',
      }
      notify('Belge hazırlanamadı. Lütfen yeniden deneyin.', 'error')
    }
  } finally {
    pendingDocuments.delete(key)
  }
}
export function downloadPreview() {
  if (!pdfPreview.value?.blob) return
  save(pdfPreview.value.blob, pdfPreview.value.filename)
  notify('PDF belgeniz indirildi.')
}
