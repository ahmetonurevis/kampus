// Belge verisi için en dar okuma: yalnız belgenin kaydı ve ona bağlı öğrenci, sınıf, veli ve
// kampüs kayıtları tek tek okunur; core `documentData` bunlardan kurulan State alt kümesinde
// çalışır (hesap burada yeniden yazılmaz). Kapsam sunucudadır: rolün okuyamadığı yardımcı kayıt
// (403/404) boş sayılır, belge o alanı "—" yazar.
//
// TODO(api-document-data): belge için tek uç (`GET /documents/:type/:id/data`) gelince bu
// zincirleme okuma (dekontta 5, sözleşmede 6 istek) kalkar.
import type { KampusClient } from '@kampus/api-client/client.ts'
import {
  fetchAllCollectionPages,
  fetchCollectionItem,
  isUnreadableCollectionError,
} from '@kampus/react-shared/collections.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'
import { buildWorkflowState } from '../../pages/workflows/workflow-state.ts'
import type { PdfDocumentType } from './templates.ts'

type Read = <K extends CollectionName>(collection: K, id: string) => Promise<State[K][number]>

/** Okunamayan (yetki/yok) yardımcı kaydı `undefined` yapar; başka hata yeniden fırlatılır. */
async function optional<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read
  } catch (error) {
    if (isUnreadableCollectionError(error)) return undefined
    throw error
  }
}

type Records = Partial<Record<CollectionName, unknown[]>>

export type DocumentRequest = {
  type: PdfDocumentType
  recordId: string
}

/**
 * Belgenin okunduğu kayıtlardan core `State` kurar. Ana kaydın (taksit/sözleşme) hatası ve
 * öğrencinin okunamaması belgeyi engeller; sınıf, veli ve kampüs yoksa belge "—" yazar.
 */
export async function loadDocumentState(
  client: KampusClient,
  { type, recordId }: DocumentRequest,
  signal?: AbortSignal,
): Promise<State> {
  const read: Read = async (collection, id) =>
    (await fetchCollectionItem<State[typeof collection][number]>(client, collection, id, signal))
      .record
  const records: Records = {}

  if (type === 'material') {
    // Materyal öğrenciye bağlı değildir: yalnız hazırlayan öğretmen ad için okunur.
    const material = await read('materials', recordId)
    const teacher = await optional(read('teachers', material.teacherId))
    return buildWorkflowState(
      { materials: [material], teachers: teacher ? [teacher] : [] },
      { modules: {}, academicYear: null },
    )
  }

  const main =
    type === 'receipt' ? await read('invoices', recordId) : await read('contracts', recordId)
  records[type === 'receipt' ? 'invoices' : 'contracts'] = [main]

  const student = await read('students', main.studentId)
  records.students = [student]
  // Sözleşme kendi sınıfını taşır; yoksa (taksitte hiç yok) öğrencinin güncel sınıfı.
  const classId = 'classId' in main && main.classId ? main.classId : student.classId
  const [classroom, parent] = await Promise.all([
    optional(read('classes', classId)),
    student.parentId ? optional(read('parents', student.parentId)) : undefined,
  ])
  records.classes = classroom ? [classroom] : []
  records.parents = parent ? [parent] : []
  const branch = classroom ? await optional(read('branches', classroom.branchId)) : undefined
  records.branches = branch ? [branch] : []

  if (type === 'contract') {
    // Ek 1 ödeme planı: öğrencinin taksitleri (core hangilerinin sözleşmeye ait olduğunu seçer).
    const rows = await fetchAllCollectionPages<State['invoices'][number]>(
      client,
      'invoices',
      { filters: { studentId: student.id } },
      signal,
    )
    records.invoices = rows.map((row) => row.record)
  }
  return buildWorkflowState(records, { modules: {}, academicYear: null })
}

/** Kullanıcıya gösterilen ileti: core'un Türkçe kullanıcı hatası aynen, teknik hata genel ileti. */
export function documentErrorMessage(error: unknown): string {
  return error instanceof DomainError
    ? error.message
    : 'Belge hazırlanamadı. Lütfen yeniden deneyin.'
}
