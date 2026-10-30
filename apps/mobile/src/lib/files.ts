import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as Print from 'expo-print'
import { Platform } from 'react-native'
import { randomUUID } from 'expo-crypto'
import type { State } from '@kampus/school-core/data/seed.ts'
import { documentData, type DocumentType } from '@kampus/school-core/lib/document-data.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { PickedFile } from '../model/operations.ts'

// Oluşturulan belge; web'de dosya yolu yerine HTML döner.
export type PdfDocument = { uri: string; name: string; html?: string }

const fileSelectionMessages: Record<string, string> = {
  FILE_TYPE: 'PDF, JPG veya PNG dosyası seçin.',
  FILE_SIZE: 'Dosya en fazla 10 MB olabilir.',
}
export const fileSelectionMessage = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  return (
    (typeof code === 'string' ? fileSelectionMessages[code] : undefined) ||
    'Dosya açılamadı. Dosyanın cihazınızda bulunduğunu kontrol edip yeniden deneyin.'
  )
}

export async function pickFile({
  homework = false,
}: { homework?: boolean } = {}): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      ...(!homework
        ? ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        : []),
    ],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled) return null
  const file = result.assets[0]
  if (!file) throw new Error('Dosya seçilemedi.')
  if (homework && !/\.(pdf|png|jpe?g)$/i.test(file.name))
    throw Object.assign(new Error('PDF, JPG veya PNG dosyası seçin.'), { code: 'FILE_TYPE' })
  if ((file.size || 0) > 10 * 1024 * 1024)
    throw Object.assign(new Error('Dosya en fazla 10 MB olabilir.'), { code: 'FILE_SIZE' })
  if (Platform.OS === 'web') return { name: file.name, size: file.size, uri: file.uri }
  const directory = FileSystem.documentDirectory + 'uploads/'
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const extension = (file.name.split('.').at(-1) ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8)
  const uri = directory + randomUUID() + '.' + extension
  await FileSystem.copyAsync({ from: file.uri, to: uri })
  return { name: file.name, size: file.size || 0, uri }
}
const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const esc = (value: unknown) =>
  String(value ?? '—').replace(/[&<>"']/g, (char) => escapes[char] ?? char)
const titles: Record<DocumentType, string> = {
  receipt: 'TAHSİLAT DEKONTU',
  contract: 'EĞİTİM SÖZLEŞMESİ',
  'payment-plan': 'TAKSİT TAAHHÜTNAMESİ',
  homework: 'ÖDEV ÇALIŞMA KÂĞIDI',
  submission: 'ÖDEV DEĞERLENDİRME FORMU',
  material: 'DERS ÇALIŞMA KÂĞIDI',
}
const pair = (label: string, value: unknown) =>
  `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`
const paragraph = (value: unknown) => `<p>${esc(value).replace(/\n/g, '<br>')}</p>`
type DocumentRecord = ReturnType<typeof documentData>
const hasKey = <K extends string>(
  data: DocumentRecord,
  key: K,
): data is Extract<DocumentRecord, Record<K, unknown>> => key in data
// Çekirdek her belge türü için ilgili alanları üretir; eşleşmezse üretim durur.
function shaped<K extends string>(data: DocumentRecord, key: K) {
  if (!hasKey(data, key)) throw new Error('Belge verisi beklenen biçimde değil.')
  return data
}
export function documentHtml(state: State, type: DocumentType, id: string, studentId?: string) {
  const data = documentData(state, type, id, studentId)
  let content: string
  const identity =
    'student' in data && data.student
      ? `<table>${pair('Öğrenci', data.student.name)}${pair('Veli', data.parent?.name)}${pair('Sınıf', data.classroom?.name)}${pair('Kampüs', data.branch?.name)}</table>`
      : ''
  if (type === 'receipt') {
    const receipt = shaped(data, 'invoice')
    content = `<h2>İşlem başarıyla tamamlandı</h2><div class="amount">${esc(money(receipt.invoice.amount))}</div>${identity}<table>${pair('İşlem referansı', receipt.reference)}${pair('İşlem tarihi', dateLabel(receipt.invoice.paidAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${pair('Ödeme yöntemi', receipt.invoice.method)}${pair('Taksit', receipt.invoice.installment)}${pair('Alıcı kurum', 'Akademi Özel Okulları')}${pair('İşlem açıklaması', 'Eğitim bedeli tahsilatı')}</table><div class="notice">Bu belge örnek bir tahsilatı gösterir. Gerçek banka işlemi veya para transferi yapılmamıştır.</div>`
  } else if (type === 'contract' || type === 'payment-plan') {
    const plan = shaped(data, 'invoices')
    content = `${identity}<h2>${type === 'contract' ? 'Eğitim hizmeti ve ödeme koşulları' : 'Ödeme taahhüdü'}</h2>${paragraph('Akademi Özel Okulları, öğrencinin sınıf düzeyine uygun eğitim hizmetini müfredat ve akademik takvim doğrultusunda sunar. Veli, aşağıdaki ödeme planını ve eğitim koşullarını kabul eder.')}${type === 'contract' ? paragraph('Öğrenci okul kurallarına uyar; kurum gelişim ve devamsızlık bilgilerini veliyle paylaşır. Servis, yemek ve ek hizmetler ayrıca değerlendirilir. Bu demo sözleşme hukuki işlem amacıyla kullanılamaz.') : ''}<table><thead><tr><th>Taksit</th><th>Vade</th><th>Tutar</th><th>Durum</th></tr></thead><tbody>${plan.invoices.map((i) => `<tr><td>${i.installment}</td><td>${esc(dateLabel(i.dueDate, { year: 'numeric' }))}</td><td>${esc(money(i.amount))}</td><td>${esc(i.status)}</td></tr>`).join('')}</tbody></table><div class="amount">Toplam ${esc(money(plan.total))}</div>${paragraph(`Ödenen: ${money(plan.paid)} · Kalan: ${money(plan.total - plan.paid)}`)}<div class="sign"><span>Veli / İmza</span><span>Kurum / Kaşe</span></div>`
  } else if (type === 'material') {
    const material = shaped(data, 'content')
    content = `<h2>${esc(material.title)}</h2>${paragraph(`${material.subject} · ${material.level} · ${material.teacher?.name || ''}`)}${material.content.map(paragraph).join('')}<h3>Çalışma alanı</h3><div class="work"></div>`
  } else {
    const work = shaped(data, 'homework')
    const submission = type === 'submission' ? work.submission : null
    if (type === 'submission' && !submission) throw new Error('Ödev teslim kaydı bulunamadı.')
    content = `<h2>${esc(work.homework.title)}</h2>${identity}<table>${pair('Ders', work.homework.subject)}${pair('Öğretmen', work.teacher?.name)}${pair('Son teslim', dateLabel(work.homework.dueDate, { year: 'numeric' }))}</table>${paragraph(work.homework.description)}${submission ? `<h3>Değerlendirme</h3><div class="amount">${esc(submission.score ?? 'Henüz değerlendirilmedi')} / 100</div>${paragraph(submission.feedback || 'Öğretmen değerlendirmesi bekleniyor.')}${paragraph(`Teslim dosyası: ${submission.fileName}`)}` : '<h3>Çözüm ve notlar</h3><div class="work"></div>'}`
  }
  return `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><style>@page{size:A4;margin:18mm}body{font:12px Arial,sans-serif;color:#233044;line-height:1.6}header{border-top:8px solid #1E3A8A;padding:18px 0;border-bottom:1px solid #DDE3EE;display:flex;justify-content:space-between}.logo{font-size:30px;font-weight:bold;color:#1E3A8A}.logo b{color:#F97316}.sub{font-size:10px;color:#56647A}.demo{color:#9A3412;background:#FFF1E7;padding:7px;align-self:flex-start}h1{font-size:16px;color:#1E3A8A;margin-top:25px}h2{font-size:20px}h3{font-size:15px}table{border-collapse:collapse;width:100%;margin:20px 0;table-layout:fixed}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #DDE3EE;word-wrap:break-word}th{color:#56647A;background:#F4F6FB}thead{display:table-header-group}tr{page-break-inside:avoid}p{white-space:normal;overflow-wrap:anywhere}.amount{font-size:26px;font-weight:bold;color:#1E3A8A;margin:20px 0}.notice{background:#F4F6FB;padding:16px}.sign{display:flex;justify-content:space-around;margin-top:55px;height:70px}.work{height:260px;border:1px solid #DDE3EE;border-radius:8px}footer{margin-top:28px;color:#56647A;font-size:10px;border-top:1px solid #DDE3EE;padding-top:12px}</style></head><body><header><div><div class="logo">kampüs<b>.</b></div><div class="sub">AKADEMİ ÖZEL OKULLARI</div></div><span class="demo">DEMO BELGESİ</span></header><h1>${titles[type]}</h1>${content}<footer>Referans: ${esc(data.reference)} · ${esc(dateLabel(new Date(), { year: 'numeric' }))}<br>Örnek belge — gerçek tahsilat, borç veya sözleşme oluşturmaz.</footer></body></html>`
}
export async function createDocument(
  state: State,
  type: DocumentType,
  id: string,
  studentId?: string,
): Promise<PdfDocument> {
  const html = documentHtml(state, type, id, studentId)
  if (Platform.OS === 'web') {
    const popup = window.open('', '_blank')
    if (!popup) throw new Error('Belge için açılır pencerelere izin verin.')
    popup.document.write(html)
    popup.document.close()
    return { uri: '', name: `kampus-${type}-${id}.pdf`, html }
  }
  const result = await Print.printToFileAsync({ html, width: 595, height: 842 })
  const name = `kampus-${type}-${id.replace(/[^a-z0-9-]/gi, '')}.pdf`
  const uri = FileSystem.cacheDirectory + name
  await FileSystem.copyAsync({ from: result.uri, to: uri })
  return { uri, name }
}
export async function shareFile(uri: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda paylaşım kullanılamıyor.')
  await Sharing.shareAsync(uri, {
    mimeType: uri.endsWith('.pdf') ? 'application/pdf' : undefined,
    dialogTitle: 'Kampüs belgesini paylaş',
  })
}
export async function saveFile(document: PdfDocument) {
  if (Platform.OS !== 'android') return shareFile(document.uri)
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
  if (!result.granted) return false
  const destination = await FileSystem.StorageAccessFramework.createFileAsync(
    result.directoryUri,
    document.name,
    'application/pdf',
  )
  const content = await FileSystem.readAsStringAsync(document.uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  await FileSystem.writeAsStringAsync(destination, content, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return true
}
export const printFile = (document: PdfDocument) =>
  Print.printAsync({ uri: document.uri, html: document.html })
