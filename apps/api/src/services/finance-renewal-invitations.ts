import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { payerOf } from '@kampus/school-core/lib/guardianship.ts'
import {
  isRenewalPlanned,
  openRenewalInvitationsSchema,
  planRenewalInvitationResponse,
  planRenewalInvitations,
  renewalInvitationAccess,
  renewalInvitationStatus,
  renewalInvitationStudentIds,
  respondRenewalInvitationSchema,
  type RenewalInvitationStatus,
} from '@kampus/school-core/lib/renewal-invitations.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import {
  findRenewalInvitation,
  insertRenewalInvitations,
  invitedStudentIds,
  listRenewalInvitations,
  saveRenewalInvitationResponse,
  type StoredRenewalInvitation,
} from '../db/renewal-invitations.ts'
import { loadStudentGuardians } from '../db/student-guardians.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { listActorLinks } from './memberships.ts'
import { notify } from './notify.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Yenileme daveti servisi (K-10; docs/domain/kayit-ve-crm.md DOM-KAY-027; IST-100). Kural core
 * `lib/renewal-invitations.ts`'tedir. Davet ve bildirimi tek transaction'dadır, kurum kilidi
 * altında denetlenir; idempotent tekrar işlemi çalıştırmadığı için ikinci bildirim yazmaz. Yanıt
 * niyet beyanıdır: sözleşme, taksit ve sınıf yazmaz. Velinin notu loglanmaz, denetime yalnız alan
 * adları düşer.
 */

const ENTITY = 'renewal_invitations'
const SPEC = WORKFLOW_COMMANDS.renewal
const STATE_COLLECTIONS = ['students', 'classes', 'renewals'] as const

const scopeOfStudents = (studentIds: readonly string[]) => ({
  students: { ids: [...studentIds] },
  renewals: { match: [{ kind: 'equals' as const, field: 'studentId', values: [...studentIds] }] },
})

/**
 * Seçili öğrencilere davet açar; 201. Bildirim yalnız ödeyicisi kayıtlı öğrenciye gider
 * (DOM-ILT-074): ödeyicisi olmayan öğrencinin daveti açılır ama yanıtlayacak kimse yoktur, sayısı
 * yanıtta döner ve personel ödeyiciyi işler. Veri yalnız kimliktir (DOM-ILT-023).
 */
export function openRenewalInvitationsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const data = openRenewalInvitationsSchema.parse(input)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'renewal_invitation.open',
      collections: STATE_COLLECTIONS,
      loadScope: scopeOfStudents(data.studentIds),
      makeId: () => randomUUID(),
      entity: (result: { invitations: { id: string }[] }) => ({
        type: ENTITY,
        id: result.invitations[0]?.id ?? '',
      }),
      load: async (tx) => {
        const { scalars } = await environment(tx, ctx, SPEC)
        const invited = await invitedStudentIds(
          tx,
          ctx.institutionId,
          data.studentIds,
          data.academicYear,
        )
        return {
          scalars,
          run: (state, { makeId }) =>
            planRenewalInvitations(state, input, { invitedStudentIds: invited, makeId }),
        }
      },
      after: async (tx, plan) => {
        await insertRenewalInvitations(tx, ctx.institutionId, {
          invitations: plan.invitations,
          academicYear: plan.academicYear,
          invitedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        let withoutPayerCount = 0
        for (const invitation of plan.invitations) {
          await auditWork(tx, ctx, 'renewal_invitation.open', { type: ENTITY, id: invitation.id }, [
            'studentId',
            'academicYear',
          ])
          const guardians = await loadStudentGuardians(tx, ctx.institutionId, invitation.studentId)
          if (payerOf(guardians, invitation.studentId) === null) {
            withoutPayerCount += 1
            continue
          }
          await notify(tx, ctx, {
            type: 'renewal_invited',
            recipients: { studentIds: [invitation.studentId] },
            data: { invitationId: invitation.id },
          })
        }
        body = {
          data: {
            invitations: plan.invitations.map((invitation) => ({
              id: invitation.id,
              studentId: invitation.studentId,
            })),
            withoutPayerCount,
          },
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Ödeyici velinin yanıtı; plan yapılana kadar değiştirilebilir (DOM-KAY-027). Öğrenci kimliği
 * davette değişmez, kurum kilidinden önce okunabilir. Yok ya da başka kurum 404.
 */
export async function respondRenewalInvitationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  respondRenewalInvitationSchema.parse(input)
  const found = await findRenewalInvitation(ctx.db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'renewal_invitation.respond',
      collections: STATE_COLLECTIONS,
      loadScope: scopeOfStudents([found.studentId]),
      entity,
      load: async (tx) => {
        const links = await listActorLinks(tx, ctx.institutionId, ctx.actor.membershipId)
        const invitation = await findRenewalInvitation(tx, ctx.institutionId, id)
        if (invitation === null) throw new NotFoundError()
        const access = renewalInvitationAccess(links, invitation.studentId)
        return {
          run: (state) => {
            const plan = planRenewalInvitationResponse(state, invitation, input, access)
            if (invitation.version !== expectedVersion) throw new ConflictError()
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await saveRenewalInvitationResponse(tx, ctx.institutionId, {
          id,
          expectedVersion,
          response: plan.response,
          note: plan.note,
          respondedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'renewal_invitation.respond', entity, [
          'response',
          'responseNote',
          'respondedAt',
        ])
        const invitation = await findRenewalInvitation(tx, ctx.institutionId, id)
        if (invitation === null) throw new NotFoundError()
        body = {
          data: {
            id,
            version: invitation.version,
            status: renewalInvitationStatus(invitation, false),
            respondedAt: invitation.respondedAt?.toISOString() ?? null,
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Okuma --------------------------------------------------------------------------------------

const storedRenewalSchema = z.object({
  studentId: z.string(),
  year: z.number(),
  status: z.string(),
})
const studentSchema = z.object({
  name: z.string().catch(''),
  classId: z.string().catch(''),
  isActive: z.boolean().optional().catch(undefined),
})

const nameKey = (value: string) => value.normalize('NFC').toLocaleLowerCase('tr-TR')

export interface RenewalInvitationQuery {
  page: number
  pageSize: number
  academicYear?: number | undefined
  status?: RenewalInvitationStatus | undefined
  studentId?: string | undefined
  q?: string | undefined
}

/**
 * Davet listesi. Yönetici ve ön büro kurum geneli; veli velayetli ya da ödeyicisi olduğu çocukları,
 * yalnız ödeyici notu görür ve yanıtlar. Durum yenileme kaydından türediği için süzgeç ve sayfalama
 * bellektedir; küme kurum ve yılla sınırlıdır (`TODO(collection-sql)` ile aynı ölçek kabulü).
 */
export async function listRenewalInvitationsFor(
  ctx: ServiceContext,
  query: RenewalInvitationQuery,
) {
  const links =
    ctx.actor.role === 'veli'
      ? await listActorLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
      : null
  const scope = links === null ? null : renewalInvitationStudentIds(links)
  const studentIds =
    query.studentId === undefined
      ? scope
      : scope === null || scope.includes(query.studentId)
        ? [query.studentId]
        : []
  const rows = await listRenewalInvitations(ctx.db, ctx.institutionId, {
    academicYear: query.academicYear,
    studentIds: studentIds ?? undefined,
  })
  const ids = [...new Set(rows.map((row) => row.studentId))]
  const [renewalRecords, studentRecords] = await Promise.all([
    ids.length === 0
      ? []
      : loadRecords(ctx.db, ctx.institutionId, ['renewals'], {
          match: [{ kind: 'equals', field: 'studentId', values: ids }],
        }),
    loadRecordsByIds(ctx.db, ctx.institutionId, 'students', ids),
  ])
  const renewals = renewalRecords.map((record) => storedRenewalSchema.parse(record.data))
  const students = new Map(
    studentRecords.map((record) => [record.id, studentSchema.parse(record.data)]),
  )
  const statusOf = (row: StoredRenewalInvitation) =>
    renewalInvitationStatus(row, isRenewalPlanned(renewals, row.studentId, row.academicYear))
  const search = query.q === undefined ? null : nameKey(query.q)
  const matching = rows.filter(
    (row) =>
      (query.status === undefined || statusOf(row) === query.status) &&
      (search === null || nameKey(students.get(row.studentId)?.name ?? '').includes(search)),
  )
  const start = (query.page - 1) * query.pageSize
  const page = matching.slice(start, start + query.pageSize)
  const classes = await loadRecordsByIds(ctx.db, ctx.institutionId, 'classes', [
    ...new Set(page.flatMap((row) => students.get(row.studentId)?.classId ?? [])),
  ])
  const classNames = new Map(classes.map((row) => [row.id, row.data.name]))
  return {
    total: matching.length,
    items: page.map((row) => {
      const student = students.get(row.studentId)
      const access = links === null ? null : renewalInvitationAccess(links, row.studentId)
      const status = statusOf(row)
      const className = classNames.get(student?.classId ?? '')
      return {
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        studentId: row.studentId,
        studentName: student?.name || null,
        className: typeof className === 'string' ? className : null,
        academicYear: row.academicYear,
        status,
        response: row.response,
        // Notu personel ve notu yazan ödeyici görür; diğer veliye yansımaz (DOM-ILT-073).
        note: access === null || access === 'respond' ? row.responseNote : null,
        respondedAt: row.respondedAt?.toISOString() ?? null,
        canRespond: access === 'respond' && status !== 'planned' && student?.isActive !== false,
      }
    }),
  }
}
