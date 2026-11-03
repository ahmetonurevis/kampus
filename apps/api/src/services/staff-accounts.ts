import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'

import {
  assertInvitationPending,
  assertStaffInvitation,
  planStaffActivation,
  planStaffRoleChange,
  STAFF_ACCOUNT_MESSAGES,
  staffRoleSchema,
  type StaffInvitationInput,
  type StaffMember,
  type StaffRole,
  type StaffRoleChangeInput,
} from '@kampus/school-core/lib/staff-accounts.ts'

import type { Auth } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { findRecord } from '../db/records.ts'
import { invitations, memberships, users } from '../db/schema/auth.ts'
import { membershipLinks } from '../db/schema/membership-links.ts'
import { AppError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { authTransaction } from './auth-transaction.ts'
import { getInstitutionMember } from './institution-members.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel hesabı yönetimi (IST-007; DOM-YTK-070). Hesabı kurum açar (`disableSignUp`): yönetici
 * personeli davet eder; davet kullanıcıyı (parolasız), üyeliği ve isteğe bağlı öğretmen kaydı
 * bağlantısını aynı işlemde açar, Better Auth daveti "bekliyor" işaretidir. Kişi parolasını mevcut
 * sıfırlama akışıyla belirler (bağlantı davetten sonra gönderilir, `sendStaffPasswordLink`); ilk
 * girişte davet kabul edilmiş sayılır (`auth-hooks.ts`). Kural kararı core `lib/staff-accounts.ts`
 * içindedir. Bütün yazmalar `runCommand` ile kurum kilidi altında tek transaction'dır; Better Auth
 * satırları aynı işleme bağlı bağdaştırıcıyla yazılır (`auth-transaction.ts`). Denetime yalnız
 * alan adları gider; e-posta ve ad loglanmaz, denetime yazılmaz.
 */

const INVITATION = 'staff_invitation'
const MEMBER = 'membership'

/** Bekleyen davet görünümü (yalnız yönetici). */
export interface StaffInvitationView {
  id: string
  membershipId: string | null
  name: string | null
  email: string
  role: StaffRole
  status: 'pending' | 'accepted' | 'canceled' | 'rejected'
  createdAt: string
  expiresAt: string
}

const INVITATION_STATUSES = ['pending', 'accepted', 'canceled', 'rejected'] as const
type InvitationStatus = (typeof INVITATION_STATUSES)[number]

function invitationStatus(value: string): InvitationStatus {
  const found = INVITATION_STATUSES.find((status) => status === value)
  if (found === undefined) throw new Error('unknown invitation status')
  return found
}

const invitationColumns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  createdAt: invitations.createdAt,
  expiresAt: invitations.expiresAt,
  name: users.name,
  membershipId: memberships.id,
}

function invitationQuery(db: Database) {
  return db
    .select(invitationColumns)
    .from(invitations)
    .leftJoin(users, eq(users.email, invitations.email))
    .leftJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.institutionId, invitations.institutionId),
      ),
    )
}

type InvitationRow = Awaited<ReturnType<ReturnType<typeof invitationQuery>['where']>>[number]

function toInvitationView(row: InvitationRow): StaffInvitationView | null {
  const role = staffRoleSchema.safeParse(row.role)
  if (!role.success) return null
  return {
    id: row.id,
    membershipId: row.membershipId,
    name: row.name,
    email: row.email,
    role: role.data,
    status: invitationStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

async function findInvitation(db: Database, institutionId: string, invitationId: string) {
  const [row] = await invitationQuery(db)
    .where(and(eq(invitations.institutionId, institutionId), eq(invitations.id, invitationId)))
    .limit(1)
  return row ?? null
}

/** Kurumun bekleyen personel davetleri, yeni önce; sayfalı. */
export async function listStaffInvitations(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number },
) {
  const where = and(eq(invitations.institutionId, institutionId), eq(invitations.status, 'pending'))
  const [rows, [totals]] = await Promise.all([
    invitationQuery(db)
      .where(where)
      .orderBy(desc(invitations.createdAt), asc(invitations.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(invitations).where(where),
  ])
  return {
    items: rows.flatMap((row) => {
      const view = toInvitationView(row)
      return view ? [view] : []
    }),
    total: totals?.total ?? 0,
  }
}

async function findUserByEmail(db: Database, email: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  return row ?? null
}

async function findMembershipOf(db: Database, institutionId: string, userId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.userId, userId)))
    .limit(1)
  return row ?? null
}

/** Kurumun üyelikleri (kural için yalnız kimlik, rol ve pasiflik). */
async function loadStaffMembers(db: Database, institutionId: string): Promise<StaffMember[]> {
  const rows = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(eq(memberships.institutionId, institutionId))
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    deactivated: row.deactivatedAt !== null,
  }))
}

async function memberBody(tx: Database, ctx: ServiceContext, membershipId: string) {
  const member = await getInstitutionMember(tx, ctx.institutionId, membershipId, ctx.log)
  if (member === null) throw new Error('membership disappeared after write')
  return { data: member }
}

function respondWith(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('staff account command produced no body')
    return { statusCode, body: out.body }
  }
}

/**
 * Personel daveti (DOM-YTK-070). Kurumda kayıtlı e-posta 409 `member_exists`, bekleyen davet 409
 * `invitation_exists`; öğretmen kaydı kurumda yoksa 404, başka hesaba bağlıysa 409
 * `teacher_already_linked`. E-posta başka kurumda hesaplıysa yeni kullanıcı açılmaz, hesap bu
 * kuruma da üye olur (ad değişmez). Başarı 201; parola bağlantısı işlemden sonra gider.
 */
export function inviteStaffMember(
  ctx: ServiceContext,
  auth: Auth,
  input: StaffInvitationInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let existingUserId: string | null = null
  return runCommand<void>(
    ctx,
    {
      action: 'staff.invite',
      collections: [],
      // Çalıştırıcının koleksiyon denetimi yazılmaz (`collections` boş); davet denetimi `after`'da
      // Better Auth'un ürettiği davet kimliğiyle yazılır.
      entity: { type: INVITATION, id: 'new' },
      load: async (tx) => {
        const user = await findUserByEmail(tx, input.email)
        existingUserId = user?.id ?? null
        const alreadyMember =
          user !== null && (await findMembershipOf(tx, ctx.institutionId, user.id)) !== null
        const [pending] = await tx
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.institutionId, ctx.institutionId),
              eq(invitations.email, input.email),
              eq(invitations.status, 'pending'),
            ),
          )
          .limit(1)
        let teacherLinked = false
        if (input.teacherId !== undefined) {
          if ((await findRecord(tx, ctx.institutionId, 'teachers', input.teacherId)) === null)
            throw new NotFoundError()
          const [link] = await tx
            .select({ membershipId: membershipLinks.membershipId })
            .from(membershipLinks)
            .where(
              and(
                eq(membershipLinks.institutionId, ctx.institutionId),
                eq(membershipLinks.kind, 'teacher'),
                eq(membershipLinks.recordId, input.teacherId),
                isNull(membershipLinks.archivedAt),
              ),
            )
            .limit(1)
          teacherLinked = link !== undefined
        }
        return {
          run: () =>
            assertStaffInvitation({
              alreadyMember,
              pendingInvitation: pending !== undefined,
              teacherLinked,
            }),
        }
      },
      after: async (tx) => {
        const bound = await authTransaction(auth, tx)
        const inviter = await bound.internalAdapter.findUserById(ctx.actor.userId)
        if (inviter === null) throw new Error('inviter not found')
        const invitation = await bound.organization.createInvitation({
          invitation: {
            email: input.email,
            role: input.role,
            organizationId: ctx.institutionId,
            teamIds: [],
          },
          user: inviter,
        })
        const userId =
          existingUserId ??
          (
            await bound.internalAdapter.createUser(
              { name: input.name, email: input.email, emailVerified: false },
              { method: 'email-password' },
            )
          ).id
        const member = await bound.organization.createMember({
          organizationId: ctx.institutionId,
          userId,
          role: input.role,
        })
        if (input.teacherId !== undefined)
          await tx.insert(membershipLinks).values({
            institutionId: ctx.institutionId,
            membershipId: member.id,
            kind: 'teacher',
            recordId: input.teacherId,
          })
        await auditWork(tx, ctx, 'staff.invite', { type: INVITATION, id: invitation.id }, [
          'email',
          'name',
          'role',
          ...(input.teacherId === undefined ? [] : ['teacherId']),
        ])
        const row = await findInvitation(tx, ctx.institutionId, invitation.id)
        const view = row ? toInvitationView(row) : null
        if (view === null) throw new Error('invitation disappeared after write')
        out.body = { data: view }
      },
    },
    respondWith(out, 201),
    idempotency,
  )
}

/**
 * Davet sonrası parola belirleme bağlantısı: mevcut sıfırlama akışı (`request-password-reset`,
 * `services/password-reset.ts`) kullanılır; belirteç, soğuma, saatlik sınır ve denetim kaydı
 * oradadır. Gönderim davetin sonucunu değiştirmez: hata loglanır (e-posta yazılmaz), yönetici
 * daveti iptal edip yeniden gönderebilir ya da kişi "Parolamı unuttum" ile bağlantı ister.
 */
export async function sendStaffPasswordLink(
  ctx: Pick<ServiceContext, 'log'>,
  auth: Auth,
  email: string,
): Promise<void> {
  try {
    await auth.api.requestPasswordReset({ body: { email } })
  } catch (error) {
    ctx.log.warn({ event: 'staff.invite_link_failed', err: error })
  }
}

/**
 * Bekleyen daveti iptal eder (DOM-YTK-070): davet `canceled`, davetle açılan üyelik ve bağlantıları
 * silinir; kişinin başka kurumda üyeliği yoksa açık parola bağlantıları geçersizleşir, hiç parola
 * koymamışsa hesap da silinir. Olmayan ya da başka kurumun daveti 404; bekleyen değilse 409
 * `invitation_not_pending`.
 */
export function cancelStaffInvitation(
  ctx: ServiceContext,
  auth: Auth,
  invitationId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let target: { email: string; userId: string | null; membershipId: string | null } | null = null
  return runCommand<void>(
    ctx,
    {
      action: 'staff.invitation_cancel',
      collections: [],
      entity: { type: INVITATION, id: invitationId },
      load: async (tx) => {
        const row = await findInvitation(tx, ctx.institutionId, invitationId)
        if (row === null) throw new NotFoundError()
        const user = await findUserByEmail(tx, row.email)
        target = { email: row.email, userId: user?.id ?? null, membershipId: row.membershipId }
        return { run: () => assertInvitationPending(row.status) }
      },
      after: async (tx) => {
        const found = target
        if (found === null) throw new Error('invitation was not loaded')
        const bound = await authTransaction(auth, tx)
        const canceled = await bound.organization.updateInvitation({
          invitationId,
          status: 'canceled',
          fromStatus: 'pending',
        })
        if (canceled === null)
          throw new AppError(
            409,
            'invitation_not_pending',
            STAFF_ACCOUNT_MESSAGES.invitation_not_pending,
          )
        const fields = ['status']
        if (found.userId !== null) {
          if (found.membershipId !== null) {
            await bound.organization.deleteMember({
              memberId: found.membershipId,
              organizationId: ctx.institutionId,
              userId: found.userId,
            })
            fields.push('membership')
          }
          const [remaining] = await tx
            .select({ total: count() })
            .from(memberships)
            .where(eq(memberships.userId, found.userId))
          if ((remaining?.total ?? 0) === 0) {
            // Başka kurumda üyeliği yok: açık parola bağlantısı kullanılamasın.
            await bound.adapter.deleteMany({
              model: 'verification',
              where: [{ field: 'value', value: found.userId }],
            })
            const accounts = await bound.internalAdapter.findAccounts(found.userId)
            if (accounts.length === 0) {
              await bound.internalAdapter.deleteUser(found.userId)
              fields.push('user')
            }
          }
        }
        await auditWork(
          tx,
          ctx,
          'staff.invitation_cancel',
          { type: INVITATION, id: invitationId },
          fields,
        )
        const row = await findInvitation(tx, ctx.institutionId, invitationId)
        const view = row ? toInvitationView(row) : null
        if (view === null) throw new Error('invitation disappeared after cancel')
        out.body = { data: view }
      },
    },
    respondWith(out, 200),
    idempotency,
  )
}

async function loadTarget(tx: Database, ctx: ServiceContext, membershipId: string) {
  const members = await loadStaffMembers(tx, ctx.institutionId)
  const target = members.find((member) => member.id === membershipId)
  if (target === undefined) throw new NotFoundError()
  return { members, target }
}

/**
 * Personel rolünü değiştirir (DOM-YTK-070). Aynı rol yazmaz (200, denetim yok). Kendi rolü 422
 * `self_role_change`, son etkin yönetici 422 `last_admin`, pasif hesap 422 `member_deactivated`,
 * öğrenci ve veli 422 `member_not_staff`; başka kurumun üyeliği 404. Rol her istekte okunduğu için
 * değişiklik kişinin bir sonraki isteğinde geçerlidir.
 */
export function changeStaffRole(
  ctx: ServiceContext,
  auth: Auth,
  membershipId: string,
  input: StaffRoleChangeInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ from: StaffRole; to: StaffRole } | null>(
    ctx,
    {
      action: 'staff.role_change',
      collections: [],
      entity: { type: MEMBER, id: membershipId },
      load: async (tx) => {
        const { members, target } = await loadTarget(tx, ctx, membershipId)
        return {
          run: () =>
            planStaffRoleChange({
              actorMembershipId: ctx.actor.membershipId,
              target,
              members,
              role: input.role,
            }),
        }
      },
      after: async (tx, change) => {
        if (change !== null) {
          const bound = await authTransaction(auth, tx)
          await bound.organization.updateMember(membershipId, change.to)
          await auditWork(tx, ctx, 'staff.role_change', { type: MEMBER, id: membershipId }, [
            'role',
          ])
        }
        out.body = await memberBody(tx, ctx, membershipId)
      },
    },
    respondWith(out, 200),
    idempotency,
  )
}

/**
 * Personel hesabını pasifleştirir ya da geri alır (DOM-YTK-070). Pasifleştirmede üyelik kimlik
 * doğrulamada yok sayılır ve kişinin bu kurumda etkin oturumları kapatılır; başka kurumdaki
 * oturumları sürer. Durumu zaten istenen olan hesap yazılmaz (200, denetim yok). Kendini
 * pasifleştirme 422 `self_deactivate`, son etkin yönetici 422 `last_admin`.
 */
export function setStaffActive(
  ctx: ServiceContext,
  auth: Auth,
  membershipId: string,
  active: boolean,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const action = active ? 'staff.reactivate' : 'staff.deactivate'
  return runCommand<boolean>(
    ctx,
    {
      action,
      collections: [],
      entity: { type: MEMBER, id: membershipId },
      load: async (tx) => {
        const { members, target } = await loadTarget(tx, ctx, membershipId)
        return {
          run: () =>
            planStaffActivation({
              actorMembershipId: ctx.actor.membershipId,
              target,
              members,
              active,
            }),
        }
      },
      after: async (tx, changed) => {
        if (changed) {
          const bound = await authTransaction(auth, tx)
          const member = await bound.organization.findMemberById(membershipId)
          if (member === null) throw new Error('membership not found')
          await bound.adapter.update({
            model: 'member',
            where: [{ field: 'id', value: membershipId }],
            update: { deactivatedAt: active ? null : ctx.now },
          })
          const fields = ['deactivatedAt']
          if (!active) {
            const sessions = await bound.internalAdapter.listSessions(member.userId)
            const here = sessions.filter(
              (session) => Reflect.get(session, 'activeOrganizationId') === ctx.institutionId,
            )
            for (const session of here) await bound.internalAdapter.deleteSession(session.token)
            if (here.length > 0) fields.push('sessions')
          }
          await auditWork(tx, ctx, action, { type: MEMBER, id: membershipId }, fields)
        }
        out.body = await memberBody(tx, ctx, membershipId)
      },
    },
    respondWith(out, 200),
    idempotency,
  )
}
