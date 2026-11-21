import { randomUUID } from 'node:crypto'

import {
  planCoordinatorDuty,
  type CoordinatorDutyDraft,
  type CoordinatorDutyInput,
} from '@kampus/school-core/lib/coordinator-duties.ts'

import { roleSchema } from '../auth.ts'
import type { Database } from '../db/client.ts'
import {
  activeDutiesOf,
  archiveCoordinatorDuty,
  findCoordinatorDuty,
  findInstitutionMembership,
  insertCoordinatorDuty,
  listCoordinatorDuties,
  type StoredCoordinatorDuty,
} from '../db/coordinator-duties.ts'
import { findRecord } from '../db/records.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitution, listMembershipLinks } from './memberships.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Zümre başkanı ve akademik koordinatör ek görevi (F4b3b2b; docs/domain/yetki-ve-kapsam.md
 * DOM-YTK-027). Görevi yalnız yönetici atar ve kaldırır; öğretmen yalnız kendi görevlerini okur.
 * Kural core `lib/coordinator-duties.ts` `planCoordinatorDuty`'dedir. Görev öğrenci bazında not
 * yazma yetkisi vermez; kullanıldığı tek öğrenci bazında yazma uyuşmazlıkta son puandır
 * (`task-grading.ts` `finalScoreTaskSubmission`, DOM-BEC-024). Tek transaction ve kurum kilidi
 * `runCommand`'dadır; denetime yalnız alan adları yazılır.
 */

// TODO(content-reviewer): Kaynak onayı (DOM-KYN-031) bu görevleri `ContentActor.reviewer` olarak
// henüz kullanmıyor; `services/resources.ts` `contentReader` ayrı görevde bağlanır.

const ENTITY = 'coordinator_duty'

function dutyView(duty: StoredCoordinatorDuty, archivedAt: string | null = null) {
  return {
    id: duty.id,
    membershipId: duty.membershipId,
    kind: duty.kind,
    scopeId: duty.scopeId,
    createdAt: duty.createdAt,
    archivedAt,
    rowVersion: archivedAt === null ? duty.rowVersion : duty.rowVersion + 1,
  }
}

/** Görev okuma kapsamı: yönetici kurumun hepsini, öğretmen yalnız kendininkini. */
function ownOnly(ctx: ServiceContext): string | null {
  switch (ctx.actor.role) {
    case 'yonetici':
      return null
    case 'ogretmen':
      return ctx.actor.membershipId
    default:
      throw new ForbiddenError()
  }
}

export interface CoordinatorDutyListInput {
  membershipId?: string | undefined
  page: number
  pageSize: number
}

/** Etkin görevler; öğretmende `membershipId` süzgeci kendi üyeliğiyle kesişir (başkası boş). */
export async function listDuties(ctx: ServiceContext, input: CoordinatorDutyListInput) {
  const own = ownOnly(ctx)
  if (own !== null && input.membershipId !== undefined && input.membershipId !== own)
    return { items: [], total: 0 }
  const { rows, total } = await listCoordinatorDuties(ctx.db, ctx.institutionId, {
    membershipId: own ?? input.membershipId,
    page: input.page,
    pageSize: input.pageSize,
  })
  return { items: rows.map((row) => dutyView(row)), total }
}

/** Tek görev; kaldırılmış, başka kurumun veya öğretmende başkasının görevi 404. */
export async function getDuty(ctx: ServiceContext, dutyId: string) {
  const own = ownOnly(ctx)
  const duty = await findCoordinatorDuty(ctx.db, ctx.institutionId, dutyId)
  if (duty === null || (own !== null && duty.membershipId !== own)) throw new NotFoundError()
  return dutyView(duty)
}

/** Öğretmenin kadro kaydındaki branşı (`teachers.subjectId`); bağlı kayıt yoksa `null`. */
async function teacherSubjectOf(tx: Database, ctx: ServiceContext, membershipId: string) {
  const links = await listMembershipLinks(tx, ctx.institutionId, membershipId)
  const link = links.find((item) => item.kind === 'teacher')
  if (link === undefined) return null
  const record = await findRecord(tx, ctx.institutionId, 'teachers', link.recordId)
  const subjectId = record?.data.subjectId
  return typeof subjectId === 'string' ? subjectId : null
}

/**
 * Görevi atar (DOM-YTK-027). Üyelik başka kurumdaysa veya yoksa 404; kural reddi core'dan (422
 * `duty_requires_teacher`, `duty_outside_branch`, `teacher_record_required`, `invalid_cefr_level`;
 * 409 `coordinator_duty_exists`). Başarı 201.
 */
export async function assignDuty(
  ctx: ServiceContext,
  input: CoordinatorDutyInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  type Planned = { draft: CoordinatorDutyDraft }
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<Planned>(
    ctx,
    {
      action: 'coordinator_duty.assign',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const member = await findInstitutionMembership(tx, ctx.institutionId, input.membershipId)
        if (member === null) throw new NotFoundError()
        const [institution, teacherSubjectId, active] = await Promise.all([
          getInstitution(tx, ctx.institutionId),
          teacherSubjectOf(tx, ctx, member.id),
          activeDutiesOf(tx, ctx.institutionId, member.id),
        ])
        if (institution === null) throw new NotFoundError()
        const role = roleSchema.safeParse(member.role)
        if (!role.success) throw new NotFoundError()
        return {
          run: () => ({
            draft: planCoordinatorDuty({
              institutionType: institution.type,
              member: { role: role.data, teacherSubjectId },
              active,
              input,
            }),
          }),
        }
      },
      after: async (tx, { draft }) => {
        await insertCoordinatorDuty(
          tx,
          ctx.institutionId,
          { id, ...draft, assignedByUserId: ctx.actor.userId },
          ctx.now,
        )
        await auditWork(tx, ctx, 'coordinator_duty.assign', { type: ENTITY, id }, [
          'membershipId',
          'kind',
          'scopeId',
        ])
        const saved = await findCoordinatorDuty(tx, ctx.institutionId, id)
        if (saved === null) throw new Error('coordinator duty disappeared after insert')
        out.body = { data: dutyView(saved) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('coordinator duty was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/**
 * Görevi kaldırır (arşiv; DOM-YTK-027). Kaldırılmış veya başka kurumun görevi 404; `If-Match`
 * görevin `rowVersion`'ı, tutmazsa 409. Verdiği son puanlar kayıt geçmişinde kalır.
 */
export async function removeDuty(
  ctx: ServiceContext,
  input: { dutyId: string; expectedVersion: number },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ duty: StoredCoordinatorDuty }>(
    ctx,
    {
      action: 'coordinator_duty.remove',
      collections: [],
      entity: { type: ENTITY, id: input.dutyId },
      load: async (tx) => {
        const duty = await findCoordinatorDuty(tx, ctx.institutionId, input.dutyId)
        if (duty === null) throw new NotFoundError()
        if (duty.rowVersion !== input.expectedVersion) throw new ConflictError()
        return { run: () => ({ duty }) }
      },
      after: async (tx, { duty }) => {
        if (!(await archiveCoordinatorDuty(tx, ctx.institutionId, duty, ctx.now)))
          throw new ConflictError()
        await auditWork(tx, ctx, 'coordinator_duty.remove', { type: ENTITY, id: duty.id }, [
          'archivedAt',
        ])
        out.body = { data: dutyView(duty, ctx.now.toISOString()) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('coordinator duty was not removed')
      return { statusCode: 200, body: out.body }
    },
    idempotency,
  )
}
