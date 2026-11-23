import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertCertificateLink,
  assertDocumentAllowed,
  assertDocumentFile,
  FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES,
  hoursProgress,
  professionalDevelopmentCertificateInputSchema,
  professionalDevelopmentDocumentInputSchema,
  professionalDevelopmentTargetInputSchema,
  professionalDevelopmentYearOf,
  professionalDevelopmentYearRange,
  targetAppliesTo,
  type DayRange,
  type ProfessionalDevelopmentHoursStatus,
} from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import {
  certificateLinkedElsewhere,
  deleteTarget,
  enrollmentHasFile,
  findCertificateCandidate,
  findTarget,
  listHours,
  listRegisteredYears,
  memberHours,
  upsertTarget,
  type StoredTarget,
} from '../db/finance-professional-development-hours.ts'
import {
  findEnrollment,
  findProgram,
  updateEnrollmentLinks,
  type StoredEnrollment,
} from '../db/finance-professional-development.ts'
import { findFile } from '../db/files.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile, getFileUrl } from './files.ts'
import { enrollmentBody } from './finance-professional-development.ts'
import { prepareStaffDocument, writeStaffDocument } from './finance-staff-documents.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Mesleki gelişim saati, belge ve sertifika (DOM-FIN-144; ON-215; K-487…K-489). Kural core
 * `lib/finance-professional-development-hours.ts`'tedir. Hedef kurum ayarıdır (öğretim yılı başına);
 * tamamlanan saat saklanmaz, katılım kayıtlarından hesaplanır. Katılım belgesi platform dosyasıdır
 * (bağ türü `professional_development_enrollment`); sertifika özlük belgesidir (DOM-FIN-113),
 * yüklemeyle açılırsa özlük belgesi servisinin yazma yolundan geçer. Belge bağlantısı yalnız
 * `professionalDevelopmentDocumentUrl` işlevinden üretilir ve her üretim denetime yazılır. Rol ve
 * modül denetimi rotadadır; okuma ve yazma yalnız yönetici.
 */

const ENROLLMENT = 'professional_development_enrollments'
const TARGET = 'professional_development_targets'
const ATTACHMENT = 'professional_development_enrollment'
const FILE_OPEN_ACTION = 'finance.professional_development.document_open'

/** Dosya yalnız denetim yazan yoldan açılır (özlük belgesindeki desen, K-374). */
const auditedOpens = new WeakSet<ServiceContext>()

defineFileAttachment(ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, enrollmentId, file) => {
    if (!auditedOpens.has(ctx)) return false
    if (
      !(FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES as readonly string[]).includes(ctx.actor.role)
    )
      return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return enrollmentHasFile(tx, ctx.institutionId, enrollmentId, file.id)
  },
})

// --- Hedef ve özet -------------------------------------------------------------------------------

async function rangeOf(db: Database, institutionId: string, academicYear: number) {
  const years = await listRegisteredYears(db, institutionId)
  const registered = years.find((year) => year.startYear === academicYear) ?? null
  return professionalDevelopmentYearRange(
    academicYear,
    registered === null ? null : { startDate: registered.startDate, endDate: registered.endDate },
  )
}

function targetView(academicYear: number, range: DayRange, target: StoredTarget | null) {
  return {
    academicYear,
    startDate: range.startDate,
    endDate: range.endDate,
    targetHours: target === null ? null : target.targetMinutes / 60,
    appliesToRoles: target?.appliesToRoles ?? [],
    updatedAt: target?.updatedAt ?? null,
    version: target?.version ?? null,
  }
}

/** İçinde bulunulan öğretim yılı (kayıtlı yıl ya da Eylül'de başlayan varsayılan). */
export async function currentProfessionalDevelopmentYear(ctx: ServiceContext): Promise<number> {
  return professionalDevelopmentYearOf(
    dayKey(ctx.now),
    await listRegisteredYears(ctx.db, ctx.institutionId),
  )
}

export async function targetFor(ctx: ServiceContext, academicYear: number) {
  const [range, target] = await Promise.all([
    rangeOf(ctx.db, ctx.institutionId, academicYear),
    findTarget(ctx.db, ctx.institutionId, academicYear),
  ])
  return targetView(academicYear, range, target)
}

/** Hedefi yazar; `targetHours: null` kaldırır (K-487). Doğal olarak eşgüçlüdür. */
export function updateTargetCommand(
  ctx: ServiceContext,
  academicYear: number,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TARGET, id: String(academicYear) }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.target',
      collections: [],
      entity,
      load: async () => {
        const parsed = professionalDevelopmentTargetInputSchema.parse(input)
        return { run: () => parsed }
      },
      after: async (tx, parsed) => {
        if (parsed.targetHours === null) await deleteTarget(tx, ctx.institutionId, academicYear)
        else
          await upsertTarget(tx, ctx.institutionId, {
            academicYear,
            targetMinutes: parsed.targetHours * 60,
            appliesToRoles: parsed.appliesToRoles,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
        await auditWork(
          tx,
          ctx,
          'finance.professional_development.target',
          entity,
          parsed.targetHours === null ? ['targetHours'] : ['targetHours', 'appliesToRoles'],
        )
        const [range, target] = await Promise.all([
          rangeOf(tx, ctx.institutionId, academicYear),
          findTarget(tx, ctx.institutionId, academicYear),
        ])
        body = { data: targetView(academicYear, range, target) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Personel bazında tamamlanan / hedef / eksik saat (K-487). Hedef yoksa bütün personel rolleri
 * hedefsiz listelenir, durum süzgeci boş döner; varsa süzgeç yalnız hedef rollerinde çalışır.
 */
export async function listHoursFor(
  ctx: ServiceContext,
  query: {
    academicYear: number
    q?: string | undefined
    status?: ProfessionalDevelopmentHoursStatus | undefined
    page: number
    pageSize: number
  },
) {
  const [range, target] = await Promise.all([
    rangeOf(ctx.db, ctx.institutionId, query.academicYear),
    findTarget(ctx.db, ctx.institutionId, query.academicYear),
  ])
  if (query.status !== undefined && target === null) return { items: [], total: 0 }
  const { items, total } = await listHours(ctx.db, ctx.institutionId, {
    range,
    roles: query.status === undefined || target === null ? STAFF_ROLES : target.appliesToRoles,
    q: query.q,
    ...(query.status === 'missing' && target !== null
      ? { missingBelow: target.targetMinutes }
      : {}),
    ...(query.status === 'met' && target !== null ? { metAtLeast: target.targetMinutes } : {}),
    page: query.page,
    pageSize: query.pageSize,
  })
  return {
    items: items.map((row) => ({
      membershipId: row.membershipId,
      name: row.name,
      role: row.role,
      attendedCount: row.attendedCount,
      ...hoursProgress({
        completedMinutes: row.completedMinutes,
        targetMinutes: targetAppliesTo(target, row.role) ? (target?.targetMinutes ?? null) : null,
      }),
    })),
    total,
  }
}

/** Özlük kartı özeti (DOM-FIN-140): içinde bulunulan öğretim yılının saati ve hedefi. */
export async function personnelDevelopmentSummary(
  ctx: ServiceContext,
  db: Database,
  membershipId: string,
  role: string,
) {
  const academicYear = professionalDevelopmentYearOf(
    dayKey(ctx.now),
    await listRegisteredYears(db, ctx.institutionId),
  )
  const [range, target] = await Promise.all([
    rangeOf(db, ctx.institutionId, academicYear),
    findTarget(db, ctx.institutionId, academicYear),
  ])
  const hours = await memberHours(db, ctx.institutionId, membershipId, range)
  return {
    academicYear,
    attendedCount: hours.attendedCount,
    ...hoursProgress({
      completedMinutes: hours.completedMinutes,
      targetMinutes: targetAppliesTo(target, role) ? (target?.targetMinutes ?? null) : null,
    }),
  }
}

// --- Katılım belgesi ve sertifika ----------------------------------------------------------------

async function loadEnrollment(
  tx: Database,
  ctx: ServiceContext,
  programId: string,
  enrollmentId: string,
  expectedVersion: number,
): Promise<StoredEnrollment> {
  const enrollment = await findEnrollment(tx, ctx.institutionId, enrollmentId)
  if (enrollment === null || enrollment.programId !== programId) throw new NotFoundError()
  if ((await findProgram(tx, ctx.institutionId, programId)) === null) throw new NotFoundError()
  if (enrollment.version !== expectedVersion) throw new ConflictError()
  return enrollment
}

/** Yüklenen dosyanın biçimi ve boyutu; olmayan dosyayı `attachFile` 422 `file_unavailable` yapar. */
async function checkedFile(tx: Database, ctx: ServiceContext, fileId: string) {
  const file = await findFile(tx, ctx.institutionId, fileId)
  return file === null ? null : { mimeType: file.contentType, byteSize: file.byteSize }
}

/**
 * Katılım belgesi ekler ya da değiştirir (K-488): yalnız "katıldı" katılımda; PDF, en çok 10 MB.
 * Eski belgenin dosya bağı aynı transaction'da kalkar. Arşivdeki eğitimde de eklenir (belge
 * eğitimden sonra gelir).
 */
export function attachDocumentCommand(
  ctx: ServiceContext,
  programId: string,
  enrollmentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENROLLMENT, id: enrollmentId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.document_attach',
      collections: [],
      entity,
      load: async (tx) => {
        const enrollment = await loadEnrollment(tx, ctx, programId, enrollmentId, expectedVersion)
        const { fileId } = professionalDevelopmentDocumentInputSchema.parse(input)
        const file = await checkedFile(tx, ctx, fileId)
        return {
          run: () => {
            assertDocumentAllowed(enrollment.status)
            if (file !== null) assertDocumentFile(file)
            return { fileId, previous: enrollment.documentFileId }
          },
        }
      },
      after: async (tx, { fileId, previous }) => {
        if (previous !== null)
          await detachFile(tx, ctx, {
            fileId: previous,
            attachedType: ATTACHMENT,
            attachedId: enrollmentId,
          })
        await attachFile(tx, ctx, {
          fileId,
          attachedType: ATTACHMENT,
          attachedId: enrollmentId,
          dataSubjectId: null,
        })
        const saved = await updateEnrollmentLinks(tx, ctx.institutionId, {
          id: enrollmentId,
          expectedVersion,
          now: ctx.now,
          values: { documentFileId: fileId },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.document_attach', entity, [
          'documentFileId',
        ])
        body = await enrollmentBody(tx, ctx, enrollmentId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Katılım belgesini kaldırır; dosyanın bağı kalkar, bağsız dosya temizliği siler. */
export function removeDocumentCommand(
  ctx: ServiceContext,
  programId: string,
  enrollmentId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENROLLMENT, id: enrollmentId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.document_remove',
      collections: [],
      entity,
      load: async (tx) => {
        const enrollment = await loadEnrollment(tx, ctx, programId, enrollmentId, expectedVersion)
        return {
          run: () => {
            if (enrollment.documentFileId === null)
              throw new RuleViolationError(
                'professional_development_no_document',
                'Bu katılıma belge eklenmemiş.',
              )
            return enrollment.documentFileId
          },
        }
      },
      after: async (tx, fileId) => {
        await detachFile(tx, ctx, { fileId, attachedType: ATTACHMENT, attachedId: enrollmentId })
        const saved = await updateEnrollmentLinks(tx, ctx.institutionId, {
          id: enrollmentId,
          expectedVersion,
          now: ctx.now,
          values: { documentFileId: null },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.document_remove', entity, [
          'documentFileId',
        ])
        body = await enrollmentBody(tx, ctx, enrollmentId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Katılım belgesinin kısa ömürlü imzalı bağlantısı (K-488). Üretim başarılı olunca
 * `finance.professional_development.document_open` denetimi yazılır.
 */
export async function professionalDevelopmentDocumentUrl(
  ctx: ServiceContext,
  storage: StorageDriver,
  programId: string,
  enrollmentId: string,
) {
  const enrollment = await findEnrollment(ctx.db, ctx.institutionId, enrollmentId)
  if (enrollment === null || enrollment.programId !== programId) throw new NotFoundError()
  if (enrollment.documentFileId === null)
    throw new RuleViolationError(
      'professional_development_no_document',
      'Bu katılıma belge eklenmemiş.',
    )
  const opening: ServiceContext = { ...ctx }
  auditedOpens.add(opening)
  const link = await getFileUrl(opening, storage, enrollment.documentFileId)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: FILE_OPEN_ACTION,
    entityType: ENROLLMENT,
    entityId: enrollment.id,
    // kvkk: dosya adı ve içerik değil, yalnız açılan alanın adı.
    changes: { fields: ['documentFileId'] },
    createdAt: ctx.now,
  })
  return { url: link.url, expiresAt: link.expiresAt }
}

type PreparedStaffDocument = Awaited<ReturnType<typeof prepareStaffDocument>>
interface CertificateChange {
  staffDocumentId: string
  create: {
    parsed: PreparedStaffDocument['parsed']
    plan: ReturnType<PreparedStaffDocument['plan']>
  } | null
}

/**
 * Sertifika bağı (K-488): var olan sertifika özlük belgesi ya da yüklenen dosyayla aynı işlemde
 * açılan yeni sertifika özlük belgesi (`certificate`; özlük belgesi kuralları geçerlidir). Yalnız
 * "katıldı" katılımda; bir sertifika tek katılıma. `Idempotency-Key` rotada zorunlu.
 */
export function linkCertificateCommand(
  ctx: ServiceContext,
  programId: string,
  enrollmentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENROLLMENT, id: enrollmentId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.certificate_link',
      collections: [],
      entity,
      load: async (tx) => {
        const enrollment = await loadEnrollment(tx, ctx, programId, enrollmentId, expectedVersion)
        const parsed = professionalDevelopmentCertificateInputSchema.parse(input)
        const hasCertificate = enrollment.certificateDocumentId !== null
        if (parsed.source === 'existing') {
          const [document, linkedElsewhere] = await Promise.all([
            findCertificateCandidate(tx, ctx.institutionId, parsed.staffDocumentId),
            certificateLinkedElsewhere(tx, ctx.institutionId, parsed.staffDocumentId),
          ])
          return {
            run: (): CertificateChange => {
              assertDocumentAllowed(enrollment.status)
              assertCertificateLink({
                enrollmentMembershipId: enrollment.membershipId,
                hasCertificate,
                document,
                linkedElsewhere,
              })
              return { staffDocumentId: parsed.staffDocumentId, create: null }
            },
          }
        }
        const file = await checkedFile(tx, ctx, parsed.fileId)
        const prepared = await prepareStaffDocument(tx, ctx, {
          membershipId: enrollment.membershipId,
          documentType: 'certificate',
          documentDate: parsed.documentDate,
          validUntil: parsed.validUntil,
          fileId: parsed.fileId,
        })
        return {
          run: (): CertificateChange => {
            assertDocumentAllowed(enrollment.status)
            if (hasCertificate)
              assertCertificateLink({
                enrollmentMembershipId: enrollment.membershipId,
                hasCertificate,
                document: null,
                linkedElsewhere: false,
              })
            if (file !== null) assertDocumentFile(file)
            const id = randomUUID()
            return {
              staffDocumentId: id,
              create: { parsed: prepared.parsed, plan: prepared.plan() },
            }
          },
        }
      },
      after: async (tx, { staffDocumentId, create }) => {
        if (create !== null)
          await writeStaffDocument(tx, ctx, staffDocumentId, create.parsed, create.plan)
        const saved = await updateEnrollmentLinks(tx, ctx.institutionId, {
          id: enrollmentId,
          expectedVersion,
          now: ctx.now,
          values: { certificateDocumentId: staffDocumentId },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.certificate_link', entity, [
          'certificateDocumentId',
        ])
        body = await enrollmentBody(tx, ctx, enrollmentId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Sertifika bağını kaldırır; özlük belgesi kalır (K-488). */
export function unlinkCertificateCommand(
  ctx: ServiceContext,
  programId: string,
  enrollmentId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENROLLMENT, id: enrollmentId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.certificate_unlink',
      collections: [],
      entity,
      load: async (tx) => {
        const enrollment = await loadEnrollment(tx, ctx, programId, enrollmentId, expectedVersion)
        return {
          run: () => {
            if (enrollment.certificateDocumentId === null)
              throw new RuleViolationError(
                'professional_development_no_certificate',
                'Bu katılıma sertifika bağlanmamış.',
              )
          },
        }
      },
      after: async (tx) => {
        const saved = await updateEnrollmentLinks(tx, ctx.institutionId, {
          id: enrollmentId,
          expectedVersion,
          now: ctx.now,
          values: { certificateDocumentId: null },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.certificate_unlink', entity, [
          'certificateDocumentId',
        ])
        body = await enrollmentBody(tx, ctx, enrollmentId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
