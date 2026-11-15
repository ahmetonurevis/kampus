// Burs kesme bildirimi ve geri isteme yazısı (DOM-FIN-025; ON-283, K-264…K-267). Rakamlar kaydın
// yazma anındaki hesabından gelir (`/scholarship-awards/:id/ends`), burada yeniden hesaplanmaz.
// Bilgi metni çekirdeğin `scholarshipEndNotice` paragraflarıdır; gerekçe açıklaması belgeye girmez.
// Hukuki metin örnektir; kanuni faiz oranları ve yazının biçimi doğrulanmalıdır (H-32).
import type { ScholarshipEndRecord } from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  SCHOLARSHIP_END_REASON_LABELS,
  scholarshipEndNotice,
  type ScholarshipEndReason,
} from '@kampus/school-core/lib/finance-scholarship-revocation.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const SCHOLARSHIP_END_TITLES = {
  terminate: 'Burs kesme bildirimi',
  revoke: 'Burs iptali ve geri isteme yazısı',
} as const

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const percent = (basisPoints: number) => `%${String(basisPoints / 100).replace('.', ',')}`

/** Faiz satırının oran parçaları: "31 gün %9 + 30 gün %24". */
export function interestBasis(line: ScholarshipEndRecord['lines'][number]): string {
  if (line.segments.length === 0) return '—'
  return line.segments
    .map((segment) => `${String(segment.days)} gün ${percent(segment.basisPoints)}`)
    .join(' + ')
}

const isReason = (value: string): value is ScholarshipEndReason =>
  Object.hasOwn(SCHOLARSHIP_END_REASON_LABELS, value)

export const scholarshipEndFilename = (record: Pick<ScholarshipEndRecord, 'kind' | 'id'>) =>
  `burs-${record.kind === 'revoke' ? 'geri-isteme' : 'kesme'}-${record.id.slice(0, 8)}.pdf`

export function scholarshipEndDocument(
  measurer: TextMeasurer,
  record: ScholarshipEndRecord,
  context: {
    programName: string
    studentName: string
    institutionType?: InstitutionType | undefined
  },
  options: TemplateOptions,
): PdfDocument {
  const revoke = record.kind === 'revoke'
  const doc = new DocumentLayout(measurer, {
    label: revoke ? 'BURS GERİ İSTEME' : 'BURS KESME',
    badge: revoke ? 'GERİ İSTEME' : 'BİLDİRİM',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `burs-${record.id.slice(0, 8)}`,
    footerNote: 'Kurumun burs kararıdır; ödeme planındaki yeni taksitler veli ekranında görünür.',
  })
  const reason = isReason(record.reason) ? record.reason : 'other'
  doc.heading(SCHOLARSHIP_END_TITLES[record.kind], context.programName)
  doc.fields([
    ['Öğrenci', context.studentName],
    ['Burs programı', context.programName],
    ['Neden', SCHOLARSHIP_END_REASON_LABELS[reason]],
    [revoke ? 'Geri isteme günü' : 'Kesme günü', dayText(record.effectiveDate)],
  ])
  for (const paragraph of scholarshipEndNotice(
    {
      kind: record.kind,
      effectiveDate: record.effectiveDate,
      reinstated: record.lines
        .filter((line) => line.status === 'reinstated' && line.shareCents > 0)
        .map((line) => ({ dueDate: line.dueDate, amountCents: line.shareCents })),
      reinstatedCents: record.reinstatedCents,
      principalCents: record.principalCents,
      interestCents: record.interestCents,
      clawbackDueDate: record.clawbackDueDate,
    },
    {
      programName: context.programName,
      studentName: context.studentName,
      reason,
      institutionType: context.institutionType,
    },
  ))
    doc.paragraph(paragraph)
  doc.metrics(
    revoke
      ? [
          ['ANAPARA', money(record.principalCents)],
          ['KANUNİ FAİZ', money(record.interestCents)],
          ['TOPLAM', money(record.principalCents + record.interestCents)],
        ]
      : [
          ['UYGULANAN', money(record.keptCents)],
          ['KALKAN BURS', money(record.reinstatedCents)],
        ],
  )
  doc.section('Burs payının vadeleri')
  const status = {
    kept: 'Uygulandı, geri istenmez',
    reinstated: 'Burs kalktı, yeni taksit',
    clawback: 'Geri isteniyor',
    already_reinstated: 'Önceki kesmede kalktı',
  } as const
  doc.table(
    [
      { header: 'Vade', width: 26 },
      { header: 'Burs payı', width: 28 },
      { header: 'Durum', width: 46 },
      { header: 'Faiz dönemi', width: 44 },
      { header: 'Faiz', width: 30 },
    ],
    record.lines.map((line) => [
      dayText(line.dueDate),
      money(line.shareCents),
      status[line.status],
      line.status === 'clawback' ? interestBasis(line) : '—',
      line.status === 'clawback' ? money(line.interestCents) : '—',
    ]),
    true,
  )
  if (revoke)
    doc.paragraph(
      'Kanuni faiz 3095 sayılı Kanun uyarınca, her taksitin vade gününden geri isteme gününe basit faiz olarak hesaplanmıştır (yıl 365 gün). Oran dönemleri: ' +
        [...new Set(record.lines.flatMap((line) => line.segments.map((s) => s.source)))].join(
          ', ',
        ) +
        '.',
      9,
    )
  doc.signatures('Kurum yetkilisi', 'Tebellüğ eden (veli / kursiyer)', true)
  return doc.finish()
}
