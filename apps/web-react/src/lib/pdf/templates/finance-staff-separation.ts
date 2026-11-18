// İlişik kesme belgesi (DOM-FIN-118; ON-180, K-403): veri belge ucundandır; zimmet dökümü kayıtlı
// iadelerden, izin günü tamamlanmış dosyada dondurulmuş değerden gelir. Gövde metni core
// `staffSeparationParagraphs`'tandır. Tamamlanmamış dosya "TASLAK", iptal edilen "İPTAL EDİLDİ"
// rozetiyle basılır ve ilişiğin kesildiğini söylemez. Avans ve icra tutarı belgeye girmez.
import type { StaffSeparationDocument } from '@kampus/react-shared/use-finance-staff-separations.ts'
import { FIXED_ASSET_RETURN_CONDITION_LABELS } from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import {
  STAFF_SEPARATION_REASON_LABELS,
  STAFF_SEPARATION_STEP_LABELS,
  sgkExitCodeLabel,
  staffRoleText,
  staffSeparationParagraphs,
} from '@kampus/school-core/lib/finance-staff-separations.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'

export const STAFF_SEPARATION_TITLE = 'İlişik kesme belgesi'

const AT = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const ASSET_COLUMNS = [
  { header: 'Etiket', width: 30 },
  { header: 'Demirbaş', width: 60 },
  { header: 'Zimmet günü', width: 30 },
  { header: 'İade', width: 54 },
] as const
const STEP_COLUMNS = [
  { header: 'Adım', width: 110 },
  { header: 'Durum', width: 64 },
] as const

/** Dosya adında kişi adı yoktur; ayrılış günü ve kısa kimlik ayırt etmeye yeter. */
export function staffSeparationFilename(
  document: Pick<StaffSeparationDocument, 'id' | 'separationDate'>,
): string {
  return `ilisik-kesme-${document.separationDate}-${document.id.slice(0, 8)}.pdf`
}

/** Belge kimliği: dosya kimliğinin ilk 8 hanesi (altbilgide ve dosya adında). */
export const staffSeparationReference = (document: Pick<StaffSeparationDocument, 'id'>) =>
  `IK-${document.id.slice(0, 8)}`

const badgeOf = (status: StaffSeparationDocument['status']) =>
  status === 'completed' ? 'İLİŞİK KESİLDİ' : status === 'cancelled' ? 'İPTAL EDİLDİ' : 'TASLAK'

export function staffSeparationDocument(
  measurer: TextMeasurer,
  document: StaffSeparationDocument,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: STAFF_SEPARATION_TITLE.toLocaleUpperCase('tr-TR'),
    badge: badgeOf(document.status),
    institution: document.institutionName,
    generatedAt: document.generatedAt,
    reference: staffSeparationReference(document),
    footerNote: `${document.institutionName} personel kayıtlarından düzenlenmiştir`,
  })
  doc.heading(
    STAFF_SEPARATION_TITLE,
    document.status === 'completed' && document.completedAt !== null
      ? `İlişik kesildi · ${dateLabel(document.completedAt, AT)}`
      : document.status === 'cancelled'
        ? 'Dosya iptal edildi'
        : 'Taslak · ayrılış işlemleri sürüyor',
  )
  for (const paragraph of staffSeparationParagraphs(document)) doc.paragraph(paragraph, 11)
  doc.section('Ayrılış bilgileri')
  doc.fields([
    ['Personel', document.staffName],
    ['Görev', staffRoleText(document.staffRole)],
    ...(document.hireDate === null ? [] : [['İşe giriş', dayText(document.hireDate)] as const]),
    ['Ayrılış günü', dayText(document.separationDate)],
    ['Ayrılış nedeni', STAFF_SEPARATION_REASON_LABELS[document.reason]],
    ['SGK çıkış kodu', sgkExitCodeLabel(document.sgkExitCode)],
    [
      'Kullanılmayan yıllık izin',
      document.unusedLeaveDays === null
        ? 'İzin bilgisi yok'
        : `${String(document.unusedLeaveDays)} gün`,
    ],
    ['Hizmet belgesi', document.serviceCertificateLabel ?? 'Düzenlenmedi'],
  ])
  doc.section('Kontrol listesi')
  doc.table(
    STEP_COLUMNS,
    document.steps.map((item) => [
      STAFF_SEPARATION_STEP_LABELS[item.step],
      item.done ? 'Tamamlandı' : item.required ? 'Bekliyor' : 'Yapılmadı (isteğe bağlı)',
    ]),
  )
  doc.section('Zimmet dökümü')
  if (document.assets.length === 0) doc.paragraph('Personele zimmetli demirbaş yok.', 10)
  else
    doc.table(
      ASSET_COLUMNS,
      document.assets.map((asset) => [
        asset.assetTagNumber,
        asset.assetName,
        dayText(asset.assignedDate),
        asset.returnDate === null
          ? 'İade edilmedi'
          : `${dayText(asset.returnDate)}${asset.returnCondition === null ? '' : ` · ${FIXED_ASSET_RETURN_CONDITION_LABELS[asset.returnCondition]}`}`,
      ]),
    )
  if (document.status === 'cancelled' && document.cancelReason !== null)
    doc.paragraph(`İptal gerekçesi: ${document.cancelReason}`, 9, COLORS.muted)
  doc.signatures(
    `Düzenleyen: ${document.completedByName ?? '—'}`,
    `${document.institutionName} adına yetkili (ad, imza, kaşe)`,
  )
  return doc.finish()
}
