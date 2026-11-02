// Kayıt ve finans belgelerinin ortak parçaları: öğrenci bilgi alanları ve taksit tablosu sütunları.
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import type { DocumentLayout } from '../layout.ts'

type Fields = Parameters<DocumentLayout['fields']>[0]

export function studentFields(
  data: DocumentDataMap['receipt'] | DocumentDataMap['contract'] | DocumentDataMap['payment-plan'],
): Fields {
  return [
    ['Öğrenci', data.student.name],
    [
      'Okul numarası / Sınıf',
      `${data.student.number || data.student.id} / ${data.classroom?.name || '—'}`,
    ],
    ['Veli', data.parent?.name || '—'],
    ['Kampüs', data.branch?.name || '—'],
  ]
}

export const INSTALLMENT_COLUMNS = [
  { header: 'Taksit', width: 25 },
  { header: 'Vade tarihi', width: 45 },
  { header: 'Tutar', width: 56 },
  { header: 'Durum', width: 48 },
] as const
