import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  planGuardianInvitation,
  type GuardianInvitationInput,
  type GuardianInvitationPlan,
} from '@kampus/school-core/lib/guardian-invitations.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

import type { Auth } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { findRecord } from '../db/records.ts'
import { invitations, memberships, users } from '../db/schema/auth.ts'
import { membershipLinks } from '../db/schema/membership-links.ts'
import {
  attachGuardianAccount,
  loadParentGuardians,
  loadStudentGuardians,
} from '../db/student-guardians.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { authTransaction } from './auth-transaction.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import type { StaffLinkJobData, StaffLinkScheduler } from './staff-password-links.ts'
import { auditWork } from './task-work.ts'

/**
 * Veli hesabı daveti (DOM-YTK-071; personel daveti DOM-YTK-070, `services/staff-accounts.ts`).
 * Kesin kayıttan sonra yönetici ya da ön büro velinin hesabını açar. E-postanın hesabı yoksa
 * kullanıcı (parolasız), `veli` üyeliği, seçilen her öğrenci için çocuk bağlantısı
 * (`membership_links` `child`) ve veli kaydı verilmişse kaydın seçilen öğrencilerdeki velayet
 * bağlarının hesabı (`student_guardians.membership_id`) tek transaction'da yazılır; Better Auth
 * daveti ilk girişe kadar `pending` kalır, parola belirleme bağlantısı personel davetindeki iş ve
 * kuyrukla gider (`staff.password-link`).
 *
 * Veli kaydı verilmezse velayet bağı kurulmaz: çocuk bağlantısı okuma kapsamında velayetli ve
 * kısıtsız bağ olmadan kapsam vermez (core `guardedActorLinks`, kapalı başarısız). Yakınlık ve
 * velayet bağ ucundan (`POST /students/:studentId/guardians`, hesapla) girilir; hesap kendi
 * kendine velayet kazanmaz.
 *
 * E-posta başka kurumda hesaplıysa (karar 73) üyelik, bağlantı ve bağ yazılmaz, ileti gitmez;
 * öğrenciler ve veli kaydı davette (`invitations.student_ids`, `invitations.parent_id`) saklanır,
 * kabulde bağlanır. Yanıt ve denetim alanları iki durumda aynıdır. Kural kararı core
 * `lib/guardian-invitations.ts`'tedir; aktörün etkin yetkili üyeliği kurum kilidi altında yeniden
 * okunur.
 */

const INVITATION = 'guardian_invitation'
const ACTION = 'guardian.invite'
const MANAGER_ROLES: readonly Role[] = WRITE_ACTION_ROLES[ACTION]

/** Davet satırı (sınır: `student_ids` JSON kolonu). Görünüm şeması rota şemasındadır. */
const storedSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.literal('veli'),
  status: z.enum(['pending', 'accepted', 'canceled', 'rejected']),
  studentIds: z.array(z.string()),
  parentId: z.string().nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
})

async function invitationView(tx: Database, institutionId: string, invitationId: string) {
  const [row] = await tx
    .select({
      id: invitations.id,
      name: invitations.name,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      studentIds: invitations.studentIds,
      parentId: invitations.parentId,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(and(eq(invitations.institutionId, institutionId), eq(invitations.id, invitationId)))
    .limit(1)
  if (row === undefined) throw new Error('guardian invitation disappeared after write')
  const stored = storedSchema.parse(row)
  return {
    ...stored,
    createdAt: stored.createdAt.toISOString(),
    expiresAt: stored.expiresAt.toISOString(),
  }
}

/**
 * Rota denetimi (`requireRole`) kurum kilidinden önce çalışır: arada rolü düşürülen ya da
 * pasifleştirilen aktör kilitte bekleyen isteğiyle yazamasın (403).
 */
async function requireActorManager(tx: Database, ctx: ServiceContext): Promise<void> {
  const [row] = await tx
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, ctx.institutionId),
        eq(memberships.id, ctx.actor.membershipId),
        eq(memberships.userId, ctx.actor.userId),
      ),
    )
    .limit(1)
  if (
    row === undefined ||
    row.deactivatedAt !== null ||
    !(MANAGER_ROLES as readonly string[]).includes(row.role)
  )
    throw new ForbiddenError()
}

async function hasPending(
  tx: Database,
  ctx: ServiceContext,
  filter: 'email' | 'parentId',
  value: string,
) {
  const [row] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.institutionId, ctx.institutionId),
        eq(invitations.status, 'pending'),
        filter === 'email' ? eq(invitations.email, value) : eq(invitations.parentId, value),
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Veli hesabı daveti (DOM-YTK-071). Olmayan, arşivli ya da başka kurumun öğrencisi veya veli kaydı
 * 404; kural reddi core'dan (409 `member_exists`, `invitation_exists`, `guardian_link_exists`; 422
 * `guardian_record_not_linked`, `guardian_identity_mismatch`). Başarı 201; parola bağlantısı
 * yanıtı beklemeden yalnız yeni hesaba gider (tekrarlanan yanıtta gitmez).
 */
// TODO(staff-invite-accept): Mevcut hesabın daveti kendi oturumuyla kabul ettiği akışta veli
// davetinin `studentIds`'i çocuk bağlantısı, `parentId`'si velayet bağlarının hesabı olarak aynı
// işlemde yazılır (bağ arada başka hesaba bağlandıysa ya da kaldırıldıysa yazılmaz).
export async function inviteGuardianAccount(
  ctx: ServiceContext,
  auth: Auth,
  links: StaffLinkScheduler,
  input: GuardianInvitationInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let existingUserId: string | null = null
  const written: StaffLinkJobData[] = []
  const response = await runCommand<GuardianInvitationPlan>(
    ctx,
    {
      action: ACTION,
      collections: [],
      // Çalıştırıcının koleksiyon denetimi yazılmaz; davet denetimi `after`'da Better Auth'un
      // ürettiği davet kimliğiyle yazılır.
      entity: { type: INVITATION, id: 'new' },
      load: async (tx) => {
        await requireActorManager(tx, ctx)
        for (const studentId of input.studentIds)
          if ((await findRecord(tx, ctx.institutionId, 'students', studentId)) === null)
            throw new NotFoundError()
        const { parentId } = input
        if (
          parentId !== undefined &&
          (await findRecord(tx, ctx.institutionId, 'parents', parentId)) === null
        )
          throw new NotFoundError()
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1)
        existingUserId = user?.id ?? null
        const [member] =
          user === undefined
            ? []
            : await tx
                .select({ id: memberships.id })
                .from(memberships)
                .where(
                  and(
                    eq(memberships.institutionId, ctx.institutionId),
                    eq(memberships.userId, user.id),
                  ),
                )
                .limit(1)
        const pendingInvitation = await hasPending(tx, ctx, 'email', input.email)
        const studentLinks =
          parentId === undefined
            ? []
            : (
                await Promise.all(
                  input.studentIds.map((id) => loadStudentGuardians(tx, ctx.institutionId, id)),
                )
              ).flat()
        const identityLinks =
          parentId === undefined ? [] : await loadParentGuardians(tx, ctx.institutionId, parentId)
        const parentInvitationPending =
          parentId !== undefined && (await hasPending(tx, ctx, 'parentId', parentId))
        return {
          run: () =>
            planGuardianInvitation({
              input,
              alreadyMember: member !== undefined,
              pendingInvitation,
              parentInvitationPending,
              links: studentLinks,
              identityLinks,
            }),
        }
      },
      after: async (tx, plan) => {
        const bound = await authTransaction(auth, tx)
        const inviter = await bound.internalAdapter.findUserById(ctx.actor.userId)
        if (inviter === null) throw new Error('inviter not found')
        let membershipId: string | null = null
        if (existingUserId === null) {
          const user = await bound.internalAdapter.createUser(
            { name: input.name, email: input.email, emailVerified: false },
            { method: 'email-password' },
          )
          const member = await bound.organization.createMember({
            organizationId: ctx.institutionId,
            userId: user.id,
            role: 'veli',
          })
          membershipId = member.id
          await tx.insert(membershipLinks).values(
            plan.studentIds.map((recordId) => ({
              institutionId: ctx.institutionId,
              membershipId: member.id,
              kind: 'child' as const,
              recordId,
            })),
          )
          if (
            !(await attachGuardianAccount(tx, ctx.institutionId, plan.bondIds, member.id, ctx.now))
          )
            throw new ConflictError()
        }
        const invitation = await bound.organization.createInvitation({
          invitation: {
            email: input.email,
            role: 'veli',
            organizationId: ctx.institutionId,
            teamIds: [],
            name: input.name,
            membershipId,
            studentIds: plan.studentIds,
            parentId: plan.parentId,
          },
          user: inviter,
        })
        // Denetim alanları iki durumda aynıdır: denetim listesi de hesabın varlığını belli etmez.
        await auditWork(tx, ctx, ACTION, { type: INVITATION, id: invitation.id }, [
          'email',
          'name',
          'role',
          'studentIds',
          ...(plan.parentId === null ? [] : ['parentId']),
        ])
        const link = { institutionId: ctx.institutionId, invitationId: invitation.id }
        await links.enqueue(tx, link)
        written.push(link)
        out.body = { data: await invitationView(tx, ctx.institutionId, invitation.id) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('guardian invitation was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
  if (!response.replayed) links.afterCommit(written)
  return response
}
