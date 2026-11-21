import { randomUUID } from 'node:crypto'

import {
  assertEnrollmentAllowed,
  assertEnrollmentUpdate,
  assertProgramEditable,
  assertStatusTransition,
  hoursToMinutes,
  professionalDevelopmentEnrollmentInputSchema,
  professionalDevelopmentEnrollmentUpdateSchema,
  professionalDevelopmentProgramInputSchema,
  professionalDevelopmentStatusInputSchema,
  type ProfessionalDevelopmentEnrollmentStatus,
  type ProfessionalDevelopmentProgramInput,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import {
  assertAttendanceKeepsDocuments,
  assertGoalLink,
} from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { Database } from '../db/client.ts'
import { findGoalOwner } from '../db/finance-professional-development-hours.ts'
import {
  enrollmentExists,
  findCostCenterActive,
  findEnrollment,
  findEnrollmentStaff,
  findProgram,
  insertEnrollment,
  insertProgram,
  listEnrollments,
  listPrograms,
  updateEnrollment,
  updateProgram,
  type ProgramQuery,
  type ProgramWrite,
  type StoredEnrollment,
  type StoredProgram,
} from '../db/finance-professional-development.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Mesleki gelişim kataloğu (DOM-FIN-125; ON-214; K-430…K-432). Kural core
 * `lib/finance-professional-development.ts`'tedir; servis kurum kilidi altında eğitimi, maliyet
 * merkezini ve personel üyeliğini yükler, tek transaction'da yazar ve denetime alan adlarını düşer.
 * Ön büro taslak eğitimleri görmez (K-430). Rol ve modül denetimi rotadadır.
 */

const PROGRAM = 'professional_development_programs'
const ENROLLMENT = 'professional_development_enrollments'

/** Yanıt görünümü: dakika kolonları saate çevrilmiş haliyle döner, iç alt sınır dönmez. */
export function programView(program: StoredProgram) {
  return {
    id: program.id,
    name: program.name,
    kind: program.kind,
    provider: program.provider,
    durationHours: program.durationHours,
    ongoing: program.ongoing,
    startDate: program.startDate,
    endDate: program.endDate,
    location: program.location,
    onlineUrl: program.onlineUrl,
    audienceRoles: program.audienceRoles,
    audienceBranches: program.audienceBranches,
    feeCents: program.feeCents,
    costCenterId: program.costCenterId,
    capacity: program.capacity,
    status: program.status,
    enrolledCount: program.enrolledCount,
    attendedCount: program.attendedCount,
    createdAt: program.createdAt,
    updatedAt: program.updatedAt,
    version: program.version,
  }
}
/**
 * Katılım görünümü. Belge, sertifika ve gelişim hedefi (DOM-FIN-144; K-488, K-489) yalnız
 * yöneticiye döner; ön büroya üçü de `null`dır (performans ve özlük verisi).
 */
export function enrollmentView(enrollment: StoredEnrollment, full = true) {
  return {
    id: enrollment.id,
    programId: enrollment.programId,
    membershipId: enrollment.membershipId,
    staffName: enrollment.staffName,
    staffRole: enrollment.staffRole,
    origin: enrollment.origin,
    status: enrollment.status,
    attendedHours: enrollment.attendedHours,
    document:
      !full || enrollment.documentFileId === null
        ? null
        : {
            fileId: enrollment.documentFileId,
            name: enrollment.documentFileName ?? 'belge.pdf',
            byteSize: enrollment.documentFileBytes,
          },
    certificate:
      !full || enrollment.certificateDocumentId === null
        ? null
        : {
            staffDocumentId: enrollment.certificateDocumentId,
            documentDate: enrollment.certificateDocumentDate,
            validUntil: enrollment.certificateValidUntil,
          },
    developmentGoal:
      !full || enrollment.developmentGoalId === null
        ? null
        : { id: enrollment.developmentGoalId, title: enrollment.developmentGoalTitle ?? '' },
    statusChangedAt: enrollment.statusChangedAt,
    createdAt: enrollment.createdAt,
    version: enrollment.version,
  }
}

const isManager = (ctx: ServiceContext) => ctx.actor.role === 'yonetici'

export async function listProgramsFor(ctx: ServiceContext, query: ProgramQuery) {
  const { items, total } = await listPrograms(ctx.db, ctx.institutionId, query, {
    publishedOnly: !isManager(ctx),
  })
  return { items: items.map(programView), total }
}

/** Ön büro taslak eğitimi görmez; görmediği kayıt yokmuş gibi 404 (K-430). */
async function visibleProgram(db: Database, ctx: ServiceContext, id: string) {
  const program = await findProgram(db, ctx.institutionId, id)
  if (program === null || (!isManager(ctx) && program.status === 'draft')) throw new NotFoundError()
  return program
}

export async function programFor(ctx: ServiceContext, id: string) {
  return programView(await visibleProgram(ctx.db, ctx, id))
}

export async function listEnrollmentsFor(
  ctx: ServiceContext,
  programId: string,
  query: { page: number; pageSize: number; status?: ProfessionalDevelopmentEnrollmentStatus },
) {
  await visibleProgram(ctx.db, ctx, programId)
  const { items, total } = await listEnrollments(ctx.db, ctx.institutionId, programId, query)
  return { items: items.map((item) => enrollmentView(item, isManager(ctx))), total }
}

function toWrite(input: ProfessionalDevelopmentProgramInput): ProgramWrite {
  const { durationHours, ...rest } = input
  return { ...rest, durationMinutes: hoursToMinutes(durationHours) }
}

/** Seçilen maliyet merkezinin durumu: yok `null`, etkin mi; seçilmediyse `true`. */
async function costCenterState(tx: Database, ctx: ServiceContext, id: string | null) {
  return id === null ? true : findCostCenterActive(tx, ctx.institutionId, id)
}

/** Maliyet merkezi kurumda olmalı ve etkin olmalı. */
function assertCostCenter(active: boolean | null) {
  if (active === null)
    throw new DomainError(
      'professional_development_cost_center_not_found',
      'Maliyet merkezi bulunamadı.',
      { path: ['costCenterId'] },
    )
  if (!active)
    throw new DomainError(
      'professional_development_cost_center_inactive',
      'Pasif maliyet merkezi seçilemez.',
      { path: ['costCenterId'] },
    )
}

/** Yazılan alanlar (denetim kaydı; değer değil ad). */
const writtenFields = (write: ProgramWrite) =>
  Object.entries(write)
    .filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))
    .map(([key]) => key)

async function programBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findProgram(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('professional development program was not written')
  return { data: programView(saved) }
}

export async function enrollmentBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findEnrollment(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('professional development enrollment was not written')
  return { data: enrollmentView(saved) }
}

/** Yeni eğitim taslak açılır (K-431). `Idempotency-Key` rotada zorunlu. 201. */
export function createProgramCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PROGRAM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.create',
      collections: [],
      entity,
      load: async (tx) => {
        const write = toWrite(professionalDevelopmentProgramInputSchema.parse(input))
        const costCenter = await costCenterState(tx, ctx, write.costCenterId)
        return {
          run: () => {
            assertCostCenter(costCenter)
            return write
          },
        }
      },
      after: async (tx, write) => {
        await insertProgram(tx, ctx.institutionId, {
          ...write,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.professional_development.create', entity, [
          ...writtenFields(write),
          'status',
        ])
        body = await programBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltme (tam gövde): arşivdeki eğitim 409; kontenjan mevcut atamanın altına inemez. */
export function updateProgramCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PROGRAM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.update',
      collections: [],
      entity,
      load: async (tx) => {
        const program = await findProgram(tx, ctx.institutionId, id)
        if (program === null) throw new NotFoundError()
        if (program.version !== expectedVersion) throw new ConflictError()
        const write = toWrite(professionalDevelopmentProgramInputSchema.parse(input))
        const costCenter = await costCenterState(tx, ctx, write.costCenterId)
        return {
          run: () => {
            assertProgramEditable(program.status)
            assertCostCenter(costCenter)
            if (write.capacity !== null && write.capacity < program.enrolledCount)
              throw new DomainError(
                'professional_development_capacity_below_enrolled',
                `Kontenjan atanmış ${String(program.enrolledCount)} personelin altına indirilemez.`,
                { path: ['capacity'] },
              )
            if (write.durationMinutes < program.maxAttendedMinutes)
              throw new DomainError(
                'professional_development_duration_below_attended',
                'Süre, girilmiş katılım saatlerinin altına indirilemez.',
                { path: ['durationHours'] },
              )
            return write
          },
        }
      },
      after: async (tx, write) => {
        const saved = await updateProgram(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: write,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.professional_development.update',
          entity,
          Object.keys(write),
        )
        body = await programBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Durum geçişi (K-431): taslak → yayında → arşiv. */
export function changeProgramStatusCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PROGRAM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.status',
      collections: [],
      entity,
      load: async (tx) => {
        const program = await findProgram(tx, ctx.institutionId, id)
        if (program === null) throw new NotFoundError()
        if (program.version !== expectedVersion) throw new ConflictError()
        const { status } = professionalDevelopmentStatusInputSchema.parse(input)
        return {
          run: () => {
            assertStatusTransition(program.status, status)
            return status
          },
        }
      },
      after: async (tx, status) => {
        const saved = await updateProgram(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { status },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.status', entity, ['status'])
        body = await programBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Atama ya da katılım isteği (K-432). `Idempotency-Key` rotada zorunlu. 201. */
export function createEnrollmentCommand(
  ctx: ServiceContext,
  programId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENROLLMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.enroll',
      collections: [],
      entity,
      load: async (tx) => {
        const program = await findProgram(tx, ctx.institutionId, programId)
        if (program === null) throw new NotFoundError()
        const parsed = professionalDevelopmentEnrollmentInputSchema.parse(input)
        const [staff, alreadyEnrolled] = await Promise.all([
          findEnrollmentStaff(tx, ctx.institutionId, parsed.membershipId),
          enrollmentExists(tx, ctx.institutionId, programId, parsed.membershipId),
        ])
        return {
          run: () => {
            assertEnrollmentAllowed({
              programStatus: program.status,
              staff,
              alreadyEnrolled,
              capacity: program.capacity,
              enrolledCount: program.enrolledCount,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertEnrollment(tx, ctx.institutionId, {
          id,
          programId,
          membershipId: parsed.membershipId,
          origin: parsed.origin,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.professional_development.enroll', entity, [
          'programId',
          'membershipId',
          'origin',
          'status',
        ])
        body = await enrollmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Katılım durumu ve saati (K-432). */
export function updateEnrollmentCommand(
  ctx: ServiceContext,
  programId: string,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENROLLMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.professional_development.attendance',
      collections: [],
      entity,
      load: async (tx) => {
        const enrollment = await findEnrollment(tx, ctx.institutionId, id)
        if (enrollment === null || enrollment.programId !== programId) throw new NotFoundError()
        const program = await findProgram(tx, ctx.institutionId, programId)
        if (program === null) throw new NotFoundError()
        if (enrollment.version !== expectedVersion) throw new ConflictError()
        const parsed = professionalDevelopmentEnrollmentUpdateSchema.parse(input)
        const attendedMinutes =
          parsed.attendedHours === null ? null : hoursToMinutes(parsed.attendedHours)
        const goalId = parsed.developmentGoalId
        // Bağ yalnız değişiyorsa denetlenir: kapanmış hedefe kurulmuş eski bağ kalır (K-489).
        const goal =
          goalId === undefined || goalId === null || goalId === enrollment.developmentGoalId
            ? undefined
            : await findGoalOwner(tx, ctx.institutionId, goalId)
        return {
          run: () => {
            assertEnrollmentUpdate({
              programStatus: program.status,
              programMinutes: program.durationMinutes,
              attendedMinutes,
            })
            assertAttendanceKeepsDocuments({
              nextStatus: parsed.status,
              hasDocument: enrollment.documentFileId !== null,
              hasCertificate: enrollment.certificateDocumentId !== null,
            })
            if (goal !== undefined)
              assertGoalLink({ enrollmentMembershipId: enrollment.membershipId, goal })
            return {
              status: parsed.status,
              attendedMinutes,
              ...(goalId === undefined ? {} : { developmentGoalId: goalId }),
            }
          },
        }
      },
      after: async (tx, change) => {
        const saved = await updateEnrollment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          ...change,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.professional_development.attendance', entity, [
          'status',
          ...(change.attendedMinutes === null ? [] : ['attendedHours']),
          ...('developmentGoalId' in change ? ['developmentGoalId'] : []),
        ])
        body = await enrollmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
