import {
  enrollmentDocumentHeld,
  planEnrollmentDocuments,
} from '@kampus/school-core/lib/enrollment-documents.ts'
import { documentRetentionUntil } from '@kampus/school-core/lib/prospect-documents.ts'

import type { Database } from '../db/client.ts'
import {
  findDocumentLink,
  linkActiveConsentToStudent,
  linkDocumentsToStudent,
  listLinkCandidates,
} from '../db/enrollment-documents.ts'
import { extendFileRetention, findFile } from '../db/files.ts'
import { archiveProspectDocuments, findActiveDocumentConsent } from '../db/prospect-documents.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { auditWork } from './task-work.ts'

/**
 * Kayıt belgelerinin yazma tarafı (DOM-KAY-045; ON-344, K-384, K-385): kesin kayıtta ve kayıttan
 * sonraki incelemede aday belgelerinin öğrenciye bağlanması ve bağlanmayanların imha işareti.
 * Kural core `planEnrollmentDocuments`'tadır; çağıran işlemin transaction'ında çalışır (kesin kayıt
 * `services/prospects.ts`, inceleme ve rıza `services/prospect-documents.ts`).
 *
 * Dosya kopyalanmaz: aday belgesine öğrenci bağı yazılır, dosyanın bağı (`prospect_document`) aynı
 * kalır. Bağlı belgenin dosyası imha işinde bekletilir (`documentPurgeHeld`); saklama sonunu
 * kaldıran platform fonksiyonu olmadığı için vazgeçmede yazılmış işaret satırda kalır, imha işi onu
 * atlar ve belge görünümü bu işareti göstermez.
 */

const DOCUMENT_ENTITY = 'prospect_documents'
const CONSENT_ENTITY = 'prospect_document_consents'

/** Saklama sonunu öne çeker; daha erken işaret ve imha edilmiş dosya korunur (K-323). */
export async function scheduleDocumentPurge(
  tx: Database,
  ctx: ServiceContext,
  fileId: string,
  until: Date,
) {
  const row = await findFile(tx, ctx.institutionId, fileId, { lock: true })
  if (row === null || row.status === 'deleted') return
  if (row.retentionUntil !== null && row.retentionUntil <= until) return
  if ((await extendFileRetention(tx, ctx.institutionId, row, until, ctx.now)) === null)
    throw new ConflictError()
}

const fileAvailable = (status: string) => status !== 'deleted' && status !== 'rejected'

/**
 * Adayın belgelerini öğrenciye bağlar (K-384, K-385): kabul edilmiş güncel belge bağlanır,
 * özel nitelikli belge yalnız etkin rızayla ve rıza da öğrenciye bağlanır; rızasız özel nitelikli
 * belge arşivlenir ve dosyası hemen, reddedilen belgenin dosyası 30 gün sonra imhaya işaretlenir.
 * `documentIds` verilirse yalnız o belgeler (kayıttan sonraki inceleme). Bağlanan belge sayısı döner.
 */
export async function applyEnrollmentDocuments(
  tx: Database,
  ctx: ServiceContext,
  input: { prospectId: string; studentId: string; documentIds?: readonly string[] },
): Promise<number> {
  const rows = await listLinkCandidates(
    tx,
    ctx.institutionId,
    input.prospectId,
    input.documentIds ?? null,
  )
  const consent = await findActiveDocumentConsent(tx, ctx.institutionId, input.prospectId)
  const plan = planEnrollmentDocuments(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      specialCategory: row.specialCategory,
      fileAvailable: fileAvailable(row.fileStatus),
      linked: row.studentId !== null,
    })),
    consent !== null,
  )
  const fileOf = new Map(rows.map((row) => [row.id, row.fileId]))
  const linked = await linkDocumentsToStudent(tx, ctx.institutionId, {
    ids: plan.link,
    studentId: input.studentId,
    linkedByUserId: ctx.actor.userId,
    now: ctx.now,
  })
  if (linked.length !== plan.link.length) throw new ConflictError()
  for (const id of linked)
    await auditWork(tx, ctx, 'enrollment_document.link', { type: DOCUMENT_ENTITY, id }, [
      'studentId',
      'linkedAt',
    ])
  const special = rows.some((row) => linked.includes(row.id) && row.specialCategory)
  if (consent !== null && (special || input.documentIds === undefined)) {
    const consentId = await linkActiveConsentToStudent(tx, ctx.institutionId, {
      prospectId: input.prospectId,
      studentId: input.studentId,
      now: ctx.now,
    })
    if (consentId !== null)
      await auditWork(
        tx,
        ctx,
        'prospect_document_consent.link',
        { type: CONSENT_ENTITY, id: consentId },
        ['studentId', 'linkedAt'],
      )
  }
  const later = documentRetentionUntil(ctx.now)
  for (const id of plan.purgeLater) {
    const fileId = fileOf.get(id)
    if (fileId !== undefined) await scheduleDocumentPurge(tx, ctx, fileId, later)
  }
  await archiveProspectDocuments(tx, ctx.institutionId, plan.purgeNow, ctx.now)
  for (const id of plan.purgeNow) {
    const fileId = fileOf.get(id)
    if (fileId !== undefined) await scheduleDocumentPurge(tx, ctx, fileId, ctx.now)
    await auditWork(tx, ctx, 'prospect_document.archive', { type: DOCUMENT_ENTITY, id }, [
      'archivedAt',
    ])
  }
  return linked.length
}

/**
 * İmha işinin sorusu (`FileAttachmentKind.purgeHeld`, dosya satırı kilitliyken): öğrenciye bağlı,
 * kabul edilmiş ve arşivlenmemiş belgenin dosyası imha edilmez (K-386).
 */
export async function documentPurgeHeld(
  tx: Database,
  institutionId: string,
  documentId: string,
): Promise<boolean> {
  const row = await findDocumentLink(tx, institutionId, documentId)
  if (row === null) return false
  return enrollmentDocumentHeld({
    linked: row.studentId !== null,
    status: row.status,
    archived: row.archivedAt !== null,
  })
}
