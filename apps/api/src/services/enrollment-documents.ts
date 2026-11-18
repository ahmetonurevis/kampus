import {
  enrollmentDocumentGaps,
  matchesEnrollmentDocumentSearch,
} from '@kampus/school-core/lib/enrollment-documents.ts'
import {
  canOpenProspectDocument,
  type GapDocumentType,
  type ProspectDocumentStatus,
} from '@kampus/school-core/lib/prospect-documents.ts'

import {
  findStudentConsent,
  findStudentName,
  listStudentDocuments,
  loadEnrolledProspects,
  loadEnrollmentDocumentStates,
} from '../db/enrollment-documents.ts'
import { listDocumentTypes } from '../db/prospect-documents.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { ensureProspectDocumentTypes } from './prospect-documents.ts'

/**
 * Kayıt belgelerinin okuma tarafı (docs/domain/kayit-ve-crm.md DOM-KAY-045; ON-344, K-386):
 * öğrencinin kesin kayıtta bağlanan belgeleri, eksik zorunlu belgeleri ve bağlı rızası. Personelin
 * React'te genel öğrenci kartı olmadığı için ekran Kayıt İşlemleri'ndedir. Dosya bu uçlardan
 * açılmaz: bağlantı aday belge ucundan (`prospect_document.read` denetimiyle) üretilir; yanıt
 * aday kimliğini bunun için taşır. Özel nitelikli belgeyi açamayan (ön büro) dosya adını görmez.
 * Rol ve modül (`crm`) rotadadır.
 */

const fileAvailable = (status: string) => status !== 'deleted' && status !== 'rejected'

async function gapTypes(ctx: ServiceContext) {
  await ensureProspectDocumentTypes(ctx.db, ctx)
  return listDocumentTypes(ctx.db, ctx.institutionId, { includeArchived: true })
}

const asGapType = (type: Awaited<ReturnType<typeof gapTypes>>[number]): GapDocumentType => ({
  id: type.id,
  label: type.label,
  stage: type.stage,
  required: type.required,
  archived: type.archivedAt !== null,
})

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

const gapInput = (state: {
  documentTypeId: string
  status: ProspectDocumentStatus
  fileStatus: string
}) => ({
  documentTypeId: state.documentTypeId,
  status: state.status,
  fileAvailable: fileAvailable(state.fileStatus),
})

/**
 * Aday kaydından gelen aktif öğrenciler ve kayıt belgesi durumu, ad sırasıyla (K-386). `q` ada
 * göre arar; `missingOnly` yalnız eksik zorunlu belgesi olanları verir. Aday kaydından gelmeyen
 * (aktarılan) öğrenci listede yoktur.
 */
export async function enrollmentDocumentListFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined; missingOnly: boolean },
) {
  const types = (await gapTypes(ctx)).map(asGapType)
  const enrolled = (await loadEnrolledProspects(ctx.db, ctx.institutionId)).filter((row) =>
    matchesEnrollmentDocumentSearch(row.name, query.q),
  )
  const states = await loadEnrollmentDocumentStates(
    ctx.db,
    ctx.institutionId,
    enrolled.map((row) => row.prospectId),
  )
  const byProspect = new Map<string, typeof states>()
  for (const state of states) {
    const list = byProspect.get(state.prospectId) ?? []
    list.push(state)
    byProspect.set(state.prospectId, list)
  }
  const rows = enrolled
    .map((row) => {
      const own = byProspect.get(row.prospectId) ?? []
      const gaps = enrollmentDocumentGaps(types, own.map(gapInput))
      return {
        studentId: row.studentId,
        prospectId: row.prospectId,
        name: row.name,
        documentCount: own.filter(
          (state) =>
            state.studentId === row.studentId &&
            state.status === 'accepted' &&
            fileAvailable(state.fileStatus),
        ).length,
        missing: gaps.missing,
        awaitingReview: gaps.awaitingReview,
      }
    })
    .filter((row) => !query.missingOnly || row.missing.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.studentId.localeCompare(b.studentId))
  const start = (query.page - 1) * query.pageSize
  return { total: rows.length, items: rows.slice(start, start + query.pageSize) }
}

/**
 * Öğrencinin kayıt belgeleri: bağlı (kabul edilmiş, arşivlenmemiş) belgeler, eksik zorunlu türler
 * ve bağlı rıza. Olmayan, arşivlenmiş ya da başka kurumun öğrencisi 404; aday kaydından gelmeyen
 * öğrencide `prospectId` `null` ve liste boştur.
 */
export async function enrollmentDocumentsFor(ctx: ServiceContext, studentId: string) {
  const student = await findStudentName(ctx.db, ctx.institutionId, studentId)
  if (student === null) throw new NotFoundError()
  const types = await gapTypes(ctx)
  const [enrolled] = await loadEnrolledProspects(ctx.db, ctx.institutionId, { studentId })
  if (enrolled === undefined)
    return {
      studentId: student.id,
      name: student.name,
      prospectId: null,
      documents: [],
      gaps: { missing: [], awaitingReview: 0 },
      consent: null,
    }
  const labels = new Map(types.map((type) => [type.id, type.label]))
  const documents = await listStudentDocuments(ctx.db, ctx.institutionId, student.id)
  const states = await loadEnrollmentDocumentStates(ctx.db, ctx.institutionId, [
    enrolled.prospectId,
  ])
  const consent = await findStudentConsent(ctx.db, ctx.institutionId, student.id)
  return {
    studentId: student.id,
    name: student.name,
    prospectId: enrolled.prospectId,
    documents: documents.map((row) => {
      const canOpen = canOpenProspectDocument(ctx.actor.role, row.specialCategory)
      const available = fileAvailable(row.fileStatus)
      return {
        id: row.id,
        prospectId: row.prospectId,
        documentTypeId: row.documentTypeId,
        typeLabel: labels.get(row.documentTypeId) ?? row.documentTypeId,
        specialCategory: row.specialCategory,
        canOpen: canOpen && available,
        file: {
          available,
          name: canOpen ? row.fileName : null,
          contentType: row.fileContentType,
          byteSize: row.fileByteSize,
        },
        reviewedAt: iso(row.reviewedAt),
        linkedAt: iso(row.linkedAt),
      }
    }),
    gaps: enrollmentDocumentGaps(types.map(asGapType), states.map(gapInput)),
    consent:
      consent === null
        ? null
        : {
            grantor: consent.grantor,
            grantedAt: consent.grantedAt.toISOString(),
            linkedAt: iso(consent.linkedAt),
          },
  }
}
