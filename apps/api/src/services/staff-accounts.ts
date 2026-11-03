import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'

import {
  assertInvitationPending,
  assertStaffInvitation,
  planStaffActivation,
  planStaffRoleChange,
  STAFF_ACCOUNT_MESSAGES,
  STAFF_ROLES,
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
import { AppError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { authTransaction } from './auth-transaction.ts'
import { getInstitutionMember } from './institution-members.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import type { StaffLinkJobData, StaffLinkScheduler } from './staff-password-links.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel hesabı yönetimi (IST-007; DOM-YTK-070). Hesabı kurum açar (`disableSignUp`): yönetici
 * personeli davet eder. E-postanın hiç hesabı yoksa davet kullanıcıyı (parolasız), üyeliği ve
 * isteğe bağlı öğretmen kaydı bağlantısını aynı işlemde açar; Better Auth daveti "bekliyor"
 * işaretidir ve açtığı üyeliği (`invitations.membership_id`) taşır. Kişi parolasını mevcut
 * sıfırlama akışıyla belirler (bağlantı davetten sonra gönderilir, `sendStaffPasswordLink`); ilk
 * girişte davet kabul edilmiş sayılır (`auth-hooks.ts`). E-postanın başka kurumda hesabı varsa
 * (karar 73) üyelik açılmaz, ileti gitmez, yalnız bekleyen davet yazılır; yanıt yeni hesaptakiyle
 * aynı biçimdedir (e-posta sayımı olmasın). Kural kararı core `lib/staff-accounts.ts` içindedir.
 * Bütün yazmalar `runCommand` ile kurum kilidi altında tek transaction'dır; aktörün etkin yönetici
 * üyeliği kilit altında yeniden okunur. Better Auth satırları aynı işleme bağlı bağdaştırıcıyla
 * yazılır (`auth-transaction.ts`). Denetime yalnız alan adları gider; e-posta ve ad loglanmaz,
 * denetime yazılmaz.
 */

const INVITATION = 'staff_invitation'
const MEMBER = 'membership'

/**
 * Bekleyen davet görünümü (yalnız yönetici). Ad yöneticinin davette girdiğidir; kullanıcı
 * tablosundaki ad ve üyelik bilgisi dönmez: ikisi de e-postanın başka kurumda hesabı olup
 * olmadığını belli ederdi (karar 73).
 */
export interface StaffInvitationView {
  id: string
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
  name: invitations.name,
  membershipId: invitations.membershipId,
}

function invitationQuery(db: Database) {
  return db.select(invitationColumns).from(invitations)
}

type InvitationRow = Awaited<ReturnType<ReturnType<typeof invitationQuery>['where']>>[number]

function toInvitationView(row: InvitationRow): StaffInvitationView | null {
  const role = staffRoleSchema.safeParse(row.role)
  if (!role.success) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: role.data,
    status: invitationStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

/**
 * Yeni davetleri engelleyen davet koşulu: kurumun bekleyen ve süresi dolmamış davetleri. Süresi
 * dolmuş davet satırı `pending` kalsa da e-postayı, öğretmen kaydını ya da veli kaydını tutmaz
 * (`invitation_exists` ve benzerleri); liste ve iptalde görünmeye devam eder, iptal ederek
 * temizlenir.
 */
export function holdingInvitation(institutionId: string, now: Date) {
  return and(
    eq(invitations.institutionId, institutionId),
    eq(invitations.status, 'pending'),
    gt(invitations.expiresAt, now),
  )
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
  // Veli davetleri (DOM-YTK-071) bu listede değildir; sayım da yalnız personel davetlerini sayar.
  const where = and(
    eq(invitations.institutionId, institutionId),
    eq(invitations.status, 'pending'),
    inArray(invitations.role, [...STAFF_ROLES]),
  )
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

/**
 * Kurumun bekleyen ve süresi dolmamış davetlerinin tuttuğu öğretmen kayıtları
 * (`invitations.teacher_id`). Yalnız bu
 * kurumun davetleri okunur: başka kurumun daveti bu kurumun kaydını tutamaz ve sonucu etkilemez.
 * `teacherIds` verilirse yalnız onlar sorulur.
 */
export async function pendingTeacherInvitations(
  db: Database,
  institutionId: string,
  now: Date,
  teacherIds?: readonly string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ teacherId: invitations.teacherId })
    .from(invitations)
    .where(
      and(
        holdingInvitation(institutionId, now),
        teacherIds === undefined
          ? isNotNull(invitations.teacherId)
          : inArray(invitations.teacherId, [...teacherIds]),
      ),
    )
  return new Set(rows.flatMap((row) => (row.teacherId === null ? [] : [row.teacherId])))
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

/**
 * Rota denetimi (`requireRole`) kurum kilidinden önce çalışır: arada düşürülen ya da
 * pasifleştirilen yönetici kilitte bekleyen isteğiyle yazamasın diye aktörün etkin yönetici
 * üyeliği kilit altında okunan üyeliklerle yeniden doğrulanır (403).
 */
function assertActorAdmin(ctx: ServiceContext, members: readonly StaffMember[]): void {
  const actor = members.find((member) => member.id === ctx.actor.membershipId)
  if (actor === undefined || actor.deactivated || actor.role !== 'yonetici')
    throw new ForbiddenError()
}

export async function loadActorAdmin(tx: Database, ctx: ServiceContext): Promise<void> {
  const rows = await tx
    .select({
      id: memberships.id,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, ctx.institutionId),
        eq(memberships.id, ctx.actor.membershipId),
        eq(memberships.userId, ctx.actor.userId),
      ),
    )
    .limit(1)
  assertActorAdmin(
    ctx,
    rows.map((row) => ({ id: row.id, role: row.role, deactivated: row.deactivatedAt !== null })),
  )
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

export type BoundAuth = Awaited<ReturnType<typeof authTransaction>>
export type Inviter = NonNullable<Awaited<ReturnType<BoundAuth['internalAdapter']['findUserById']>>>

/**
 * Tek davetin yazımı (tek davet ve toplu aktarım ortak): e-postanın hesabı yoksa kullanıcı
 * (parolasız), üyelik ve öğretmen bağlantısı açılır; varsa (karar 73) yalnız bekleyen davet yazılır.
 * Öğretmen kaydı iki durumda da davette (`invitations.teacher_id`) saklanır: mevcut hesabın
 * davetinde bağ kaybolmaz, kabulde açılır; bekleyen davetin tuttuğu kayıt başka davete bağlanamaz.
 * Denetim alanları iki durumda aynıdır: denetim listesi de hesabın varlığını belli etmez.
 */
export async function writeStaffInvitation(
  tx: Database,
  ctx: ServiceContext,
  bound: BoundAuth,
  inviter: Inviter,
  write: {
    input: StaffInvitationInput
    existingUserId: string | null
    action: string
    links: StaffLinkScheduler
  },
): Promise<StaffLinkJobData> {
  const { input, existingUserId } = write
  let membershipId: string | null = null
  if (existingUserId === null) {
    const user = await bound.internalAdapter.createUser(
      { name: input.name, email: input.email, emailVerified: false },
      { method: 'email-password' },
    )
    const member = await bound.organization.createMember({
      organizationId: ctx.institutionId,
      userId: user.id,
      role: input.role,
    })
    membershipId = member.id
    if (input.teacherId !== undefined)
      await tx.insert(membershipLinks).values({
        institutionId: ctx.institutionId,
        membershipId: member.id,
        kind: 'teacher',
        recordId: input.teacherId,
      })
  }
  const invitation = await bound.organization.createInvitation({
    invitation: {
      email: input.email,
      role: input.role,
      organizationId: ctx.institutionId,
      teamIds: [],
      name: input.name,
      membershipId,
      teacherId: input.teacherId ?? null,
    },
    user: inviter,
  })
  await auditWork(tx, ctx, write.action, { type: INVITATION, id: invitation.id }, [
    'email',
    'name',
    'role',
    ...(input.teacherId === undefined ? [] : ['teacherId']),
  ])
  // Bağlantı işi her davette aynı yoldan kurulur; yeni hesap ayrımı gönderimde yapılır (karar 73).
  const link = { institutionId: ctx.institutionId, invitationId: invitation.id }
  await write.links.enqueue(tx, link)
  return link
}

/**
 * Personel daveti (DOM-YTK-070). Kurumda kayıtlı e-posta 409 `member_exists`, bekleyen davet 409
 * `invitation_exists`; öğretmen kaydı kurumda yoksa 404, başka hesaba bağlıysa 409
 * `teacher_already_linked`, kurumun bekleyen başka bir davetinde tutuluyorsa 409
 * `teacher_invitation_pending`. Başarı 201; parola bağlantısı yanıtı beklemeden yalnız yeni hesaba
 * gider (`services/staff-password-links.ts`; tekrarlanan yanıtta gitmez).
 *
 * E-posta başka kurumda hesaplıysa (karar 73) üyelik açılmaz, parola bağlantısı gitmez; yalnız
 * bekleyen davet (girilen adla ve öğretmen kaydıyla) yazılır. Yanıtın durum kodu, alanları ve
 * denetim alanları yeni hesaptakiyle aynıdır: yönetici e-postanın başka kurumda hesabı olduğunu
 * öğrenemez. Kişinin bu daveti oturumla kabul ettiği akış henüz yok.
 */
// TODO(staff-invite-accept): Mevcut hesabın daveti kendi oturumuyla kabul ettiği akış (üyeliği o an
// açar). Kabulde davetin `teacherId`'si (`invitations.teacher_id`) aynı işlemde
// `membership_links`'e `teacher` bağlantısı olarak yazılır; kayıt arada arşivlendiyse ya da başka
// hesaba bağlandıysa bağlantı açılmaz. O zamana kadar davet bekler ya da yönetici iptal eder.
export async function inviteStaffMember(
  ctx: ServiceContext,
  auth: Auth,
  links: StaffLinkScheduler,
  input: StaffInvitationInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let existingUserId: string | null = null
  const written: StaffLinkJobData[] = []
  const response = await runCommand<void>(
    ctx,
    {
      action: 'staff.invite',
      collections: [],
      // Çalıştırıcının koleksiyon denetimi yazılmaz (`collections` boş); davet denetimi `after`'da
      // Better Auth'un ürettiği davet kimliğiyle yazılır.
      entity: { type: INVITATION, id: 'new' },
      load: async (tx) => {
        await loadActorAdmin(tx, ctx)
        const user = await findUserByEmail(tx, input.email)
        existingUserId = user?.id ?? null
        const alreadyMember =
          user !== null && (await findMembershipOf(tx, ctx.institutionId, user.id)) !== null
        const [pending] = await tx
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(holdingInvitation(ctx.institutionId, ctx.now), eq(invitations.email, input.email)),
          )
          .limit(1)
        let teacherLinked = false
        let teacherInvitationPending = false
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
          teacherInvitationPending =
            (await pendingTeacherInvitations(tx, ctx.institutionId, ctx.now, [input.teacherId]))
              .size > 0
        }
        return {
          run: () =>
            assertStaffInvitation({
              alreadyMember,
              pendingInvitation: pending !== undefined,
              teacherLinked,
              teacherInvitationPending,
            }),
        }
      },
      after: async (tx) => {
        const bound = await authTransaction(auth, tx)
        const inviter = await bound.internalAdapter.findUserById(ctx.actor.userId)
        if (inviter === null) throw new Error('inviter not found')
        const link = await writeStaffInvitation(tx, ctx, bound, inviter, {
          input,
          existingUserId,
          action: 'staff.invite',
          links,
        })
        written.push(link)
        const row = await findInvitation(tx, ctx.institutionId, link.invitationId)
        const view = row ? toInvitationView(row) : null
        if (view === null) throw new Error('invitation disappeared after write')
        out.body = { data: view }
      },
    },
    respondWith(out, 201),
    idempotency,
  )
  if (!response.replayed) links.afterCommit(written)
  return response
}

/**
 * Bekleyen daveti iptal eder (DOM-YTK-070): davet `canceled`, davetle açılan üyelik
 * (`invitations.membership_id`) ve bağlantıları silinir; kişinin başka kurumda üyeliği yoksa açık
 * parola bağlantıları geçersizleşir, hiç parola koymamışsa hesap da silinir. Mevcut hesaba yazılmış
 * davette (karar 73) yalnız davet iptal edilir; hesaba ve başka yoldan açılmış üyeliğe dokunulmaz.
 * Olmayan ya da başka kurumun daveti 404; bekleyen değilse 409 `invitation_not_pending`.
 */
export function cancelStaffInvitation(
  ctx: ServiceContext,
  auth: Auth,
  invitationId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let target: { userId: string | null; membershipId: string | null } | null = null
  return runCommand<void>(
    ctx,
    {
      action: 'staff.invitation_cancel',
      collections: [],
      entity: { type: INVITATION, id: invitationId },
      load: async (tx) => {
        await loadActorAdmin(tx, ctx)
        const row = await findInvitation(tx, ctx.institutionId, invitationId)
        // Veli davetinin iptali bu uçla yapılmaz: üyelik silinince velayet bağı da silinirdi.
        if (row === null || !staffRoleSchema.safeParse(row.role).success) throw new NotFoundError()
        const [member] =
          row.membershipId === null
            ? []
            : await tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(
                  and(
                    eq(memberships.institutionId, ctx.institutionId),
                    eq(memberships.id, row.membershipId),
                  ),
                )
                .limit(1)
        target = { userId: member?.userId ?? null, membershipId: row.membershipId }
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
        if (found.userId !== null && found.membershipId !== null) {
          await bound.organization.deleteMember({
            memberId: found.membershipId,
            organizationId: ctx.institutionId,
            userId: found.userId,
          })
          fields.push('membership')
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
 * Personel rolünü değiştirir (DOM-YTK-070). Aynı rol yazmaz (200, denetim yok). Kilit altında
 * etkin yönetici olmayan aktör 403. Kendi rolü 422
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
          run: () => {
            // Kural önce: iki yönetici birbirini aynı anda düşürürse ikincisi `last_admin` alır.
            const change = planStaffRoleChange({
              actorMembershipId: ctx.actor.membershipId,
              target,
              members,
              role: input.role,
            })
            assertActorAdmin(ctx, members)
            return change
          },
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
 * pasifleştirme 422 `self_deactivate`, kendini geri alma 422 `self_reactivate`, son etkin yönetici
 * 422 `last_admin`; kilit altında etkin yönetici olmayan aktör 403.
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
          run: () => {
            // Kural önce: iki yönetici birbirini aynı anda pasifleştirirse ikincisi `last_admin`,
            // pasifleştirilen yöneticinin bekleyen kendi geri alma isteği `self_reactivate` alır.
            const changed = planStaffActivation({
              actorMembershipId: ctx.actor.membershipId,
              target,
              members,
              active,
            })
            assertActorAdmin(ctx, members)
            return changed
          },
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
