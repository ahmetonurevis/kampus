// Kayıt ve finans belgelerinin ortak parçaları: öğrenci bilgi alanları ve taksit tablosu sütunları.
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { DocumentLayout } from '../layout.ts'

type Fields = Parameters<DocumentLayout['fields']>[0]

export type LearnerTerm = 'Öğrenci' | 'Kursiyer'

/**
 * Kayıtlı kişiyi adlandıran şablonların seçeneği: etkin kurumun türü (oturumdaki
 * `institution.type`). Okulda "öğrenci", dil okulu ve kursta "kursiyer" yazılır (ADR 0008 karar 1,
 * DOM-KAY-012). Verilmezse okul metni kullanılır.
 */
export type LearnerTermOptions = { institutionType?: InstitutionType }

/**
 * Belgede kayıtlı kişinin adı (ADR 0008 karar 1; core terminolojideki `learner`): okulda öğrenci,
 * okul dışındaki türlerde (dil okulu, kurs) kursiyer. Tür bilinmiyorsa okul sayılır.
 */
export function learnerTerm(type: InstitutionType | undefined): LearnerTerm {
  return type === undefined || type === 'school' ? 'Öğrenci' : 'Kursiyer'
}

export function studentFields(
  data: DocumentDataMap['receipt'] | DocumentDataMap['contract'] | DocumentDataMap['payment-plan'],
  learner: LearnerTerm = 'Öğrenci',
): Fields {
  return [
    [learner, data.student.name],
    [
      learner === 'Öğrenci' ? 'Okul numarası / Sınıf' : 'Kursiyer numarası / Sınıf',
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
