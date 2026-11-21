// Demirbaş zimmet tutanağı (DOM-FIN-086; ON-236): kurum, teslim alan (personel ya da konum),
// demirbaşlar, tarih ve iki imza alanı. Tek zimmetin tutanağı ya da bir personelin açık
// zimmetlerinin hepsi aynı şablonla çizilir; iade edilmiş tek zimmette iade bilgisi de yazılır.
// Personel adı kişisel veridir; belge yalnız yöneticinin ekranından üretilir (K-189, K-214).
import type { FixedAssetAssignment } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  FIXED_ASSET_RETURN_CONDITION_LABELS,
  fixedAssetHolderLabel,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_CATEGORY_LABELS } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { isStaffRole, STAFF_ROLE_LABELS } from '@kampus/school-core/lib/staff-accounts.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const FIXED_ASSET_ASSIGNMENT_TITLE = 'Demirbaş zimmet tutanağı'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const COLUMNS = [
  { header: 'Etiket', width: 30 },
  { header: 'Demirbaş', width: 46 },
  { header: 'Kategori', width: 36 },
  { header: 'Zimmet günü', width: 26 },
  { header: 'Not', width: 36 },
] as const

/** Tutanak dosya adı: tek zimmette etiket, personel listesinde tutanak günü (ad yazılmaz). */
export function fixedAssetAssignmentFilename(
  assignments: readonly Pick<FixedAssetAssignment, 'assetTagNumber'>[],
  generatedAt: Date,
): string {
  const [only] = assignments
  if (assignments.length === 1 && only) return `zimmet-tutanagi-${only.assetTagNumber}.pdf`
  return `zimmet-tutanagi-${generatedAt.toISOString().slice(0, 10)}.pdf`
}

const roleText = (role: string | null) =>
  role && isStaffRole(role) ? STAFF_ROLE_LABELS[role] : '—'

/**
 * Zimmet tutanağı. `assignments` aynı teslim alanın zimmetleridir (tek zimmet ya da personelin açık
 * zimmetleri); boş liste çizilmez. Tutanak günü tek zimmette zimmet günü, listede üretim günüdür.
 */
export function fixedAssetAssignmentDocument(
  measurer: TextMeasurer,
  assignments: readonly FixedAssetAssignment[],
  options: TemplateOptions,
): PdfDocument {
  const [first] = assignments
  if (!first) throw new Error('Tutanakta en az bir zimmet olmalıdır.')
  const generatedAt = options.generatedAt ?? new Date()
  const single = assignments.length === 1 ? first : null
  const returned = single !== null && single.returnDate !== null
  const holder = fixedAssetHolderLabel(first)
  const doc = new DocumentLayout(measurer, {
    label: 'DEMİRBAŞ ZİMMET TUTANAĞI',
    badge: returned ? 'İADE EDİLDİ' : 'ZİMMET',
    institution: options.institution,
    generatedAt,
    reference: single ? single.assetTagNumber : `${String(assignments.length)} demirbaş`,
    footerNote: 'Kurum içi zimmet belgesidir; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(FIXED_ASSET_ASSIGNMENT_TITLE, holder)
  doc.fields([
    ['Kurum', options.institution],
    [
      'Tutanak tarihi',
      single ? dayText(single.assignedDate) : dateLabel(generatedAt, { year: 'numeric' }),
    ],
    ...(first.assigneeType === 'staff'
      ? ([
          ['Teslim alan', first.staffName ?? '—'],
          ['Görevi', roleText(first.staffRole)],
        ] as const)
      : ([
          ['Teslim yeri', first.location ?? '—'],
          ['Kampüs', first.campusName ?? '—'],
        ] as const)),
    ['Demirbaş sayısı', `${String(assignments.length)} adet`],
  ])
  doc.paragraph(
    first.assigneeType === 'staff'
      ? 'Aşağıda etiket numarası yazılı demirbaşlar belirtilen günlerde teslim edilmiştir. Teslim alan, demirbaşları özenle kullanmayı, kayıp ve hasarı kuruma bildirmeyi ve görevden ayrılırken iade etmeyi kabul eder.'
      : 'Aşağıda etiket numarası yazılı demirbaşlar belirtilen günlerde bu konuma teslim edilmiştir. Konumun sorumlusu, demirbaşların yerinde ve özenle kullanılmasını gözetir; kayıp ve hasarı kuruma bildirir.',
  )
  doc.section('Demirbaşlar')
  doc.table(
    COLUMNS,
    assignments.map((item) => [
      item.assetTagNumber,
      item.assetName,
      FIXED_ASSET_CATEGORY_LABELS[item.assetCategory],
      dayText(item.assignedDate),
      item.note ?? '—',
    ]),
    true,
  )
  if (single && single.returnDate !== null) {
    doc.section('İade')
    doc.fields([
      ['İade günü', dayText(single.returnDate)],
      [
        'Durum',
        single.returnCondition ? FIXED_ASSET_RETURN_CONDITION_LABELS[single.returnCondition] : '—',
      ],
      ['Durum notu', single.returnNote ?? '—'],
    ])
  }
  doc.signatures(
    'Teslim eden (kurum adına) — ad soyad, imza',
    first.assigneeType === 'staff'
      ? `Teslim alan — ${first.staffName ?? 'ad soyad'}, imza`
      : 'Teslim alan (konum sorumlusu) — ad soyad, imza',
  )
  return doc.finish()
}
