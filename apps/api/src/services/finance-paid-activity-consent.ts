import type { FormConsentStatus } from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
import { isCustodial } from '@kampus/school-core/lib/guardianship.ts'
import {
  currentDecisions,
  permissionDecider,
  permissionStatus,
} from '@kampus/school-core/lib/permission-forms.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import type { RecordData } from '../db/collections.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { learnerFactsOf } from './learner-age.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Gezi katılımının veli izni ile dijital izin formu (IST-067, DOM-ILT-030…039) arasındaki salt
 * okuma köprüsü (DOM-FIN-112, K-370). İzin formu modülü (`communication`) değiştirilmez: form ve
 * kararları `records`'tan okunur, öğrencinin geçerli durumu formun kendi kuralıyla (core
 * `permissionDecider`, `permissionStatus`, `currentDecisions`; velayetli ve kısıtsız veliler
 * `student_guardians`) hesaplanır. Karar notu ve kararı verenin kimliği okunmaz, döndürülmez.
 */

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** Bağlanabilir form: iletişim modülü açık, kayıt kurumda, arşivlenmemiş ve iptal edilmemiş. */
async function usableForm(
  db: Database,
  institutionId: string,
  formId: string,
): Promise<{ data: RecordData; type: InstitutionType } | null> {
  const institution = await getInstitutionModules(db, institutionId)
  if (institution === null || institution.modules.communication !== true) return null
  const [form] = await loadRecordsByIds(db, institutionId, 'permissionForms', [formId])
  if (form === undefined || text(form.data.cancelledAt) !== null) return null
  return { data: form.data, type: institution.type }
}

/** İzin formu bağlanabilir mi (K-370); değilse çağıran 422 verir. */
export async function permissionFormUsable(db: Database, institutionId: string, formId: string) {
  return (await usableForm(db, institutionId, formId)) !== null
}

/**
 * Öğrencilerin formdaki geçerli izin durumu; formun hedefinde olmayan öğrenci `not_targeted`.
 * Form kullanılamıyorsa (modül kapalı, form yok, arşivli ya da iptal) `null`.
 */
export async function formConsentStatuses(
  db: Database,
  institutionId: string,
  formId: string,
  studentIds: readonly string[],
  now: Date,
): Promise<Map<string, FormConsentStatus> | null> {
  const form = await usableForm(db, institutionId, formId)
  if (form === null) return null
  const targets = new Set(texts(form.data.studentIds))
  const ids = [...new Set(studentIds)]
  const targeted = ids.filter((id) => targets.has(id))
  const result = new Map<string, FormConsentStatus>(ids.map((id) => [id, 'not_targeted']))
  if (targeted.length === 0) return result
  const [decisions, facts, guardians] = await Promise.all([
    loadRecords(db, institutionId, ['permissionDecisions'], {
      match: [{ kind: 'equals', field: 'formId', values: [formId] }],
    }),
    learnerFactsOf(db, institutionId, targeted),
    loadGuardianAccounts(db, institutionId, targeted),
  ])
  const custodial = new Map<string, Set<string>>(targeted.map((id) => [id, new Set<string>()]))
  for (const link of guardians)
    if (link.userId !== null && isCustodial(link)) custodial.get(link.studentId)?.add(link.userId)
  const revision = typeof form.data.detailsRevision === 'number' ? form.data.detailsRevision : 0
  const at = now.toISOString()
  for (const studentId of targeted) {
    const own = decisions
      .filter((row) => row.data.studentId === studentId)
      .map((row) => ({
        decidedByUserId: text(row.data.decidedByUserId) ?? '',
        decidedAt: text(row.data.decidedAt) ?? '',
        decision: row.data.decision === 'rejected' ? ('rejected' as const) : ('approved' as const),
        relation: row.data.relation === 'self' ? ('self' as const) : ('guardian' as const),
        formRevision: typeof row.data.formRevision === 'number' ? row.data.formRevision : 0,
      }))
    result.set(
      studentId,
      permissionStatus(currentDecisions({ detailsRevision: revision }, own), {
        decider: permissionDecider(facts.get(studentId) ?? {}, {
          institutionType: form.type,
          now: at,
        }),
        guardianUserIds: custodial.get(studentId) ?? new Set<string>(),
      }),
    )
  }
  return result
}
