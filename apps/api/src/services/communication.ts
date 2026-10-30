import { and, asc, desc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import {
  isConversationParty,
  parentAccountsDecision,
} from '@kampus/school-core/lib/communication-access.ts'
import {
  conversationSummary,
  CONVERSATION_ACCESS_MINUTES,
  markAnnouncementRead,
  markMessagesRead,
  messagePage,
  openConversationAccess,
  publishAnnouncement,
  reviseAnnouncement,
  sendMessage,
  senderSide,
  startConversation,
  withdrawAnnouncement,
  type ConversationSummary,
  type MessageView,
  type Participant,
} from '@kampus/school-core/lib/communication.ts'
import type { Actor, Scope } from '@kampus/school-core/lib/scope.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { findRecord, loadRecords, type FieldMatch } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { memberships, users } from '../db/schema/auth.ts'
import { membershipLinks } from '../db/schema/membership-links.ts'
import { NotFoundError, ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import {
  runCommand,
  runOperation,
  type CommandResponse,
  type OperationTools,
} from './operation-runner.ts'
import { assertReadable, readScope, readSource } from './read-scope.ts'

/**
 * İletişim modülünün servisi (docs/domain/iletisim-ve-veli.md): duyuru ve birebir yazışma.
 * Kurallar ve kapsam core'dadır (`lib/communication.ts`, `lib/communication-access.ts`); burada
 * kayıt yükleme, işlem çalıştırma ve yöneticinin gerekçeli erişim kaydı (`audit_log`) vardır.
 *
 * Yazışma kişisel veridir: mesaj metni loglanmaz, denetim kaydına yalnız değişen alan adı
 * (`messages`) yazılır (işlem çalıştırıcı). Yazışma genel koleksiyon okumasına kapalıdır
 * (`collection-access.ts`); taraf olmayana 404 döner, varlık sızdırılmaz (DOM-YTK-052).
 */

type Conversation = State['conversations'][number]

/** Çekirdek işlemlerin kişisi: core aktörü + kalıcı kullanıcı kimliği. */
function participantOf(ctx: ServiceContext, actor: Actor): Participant {
  return { ...actor, userId: ctx.actor.userId }
}

// --- Okuma --------------------------------------------------------------------------------

// Kayıtlar JSON'dur; core'a verilmeden önce biçim denetlenir. Biçim dışı satır listede yok sayılır.
const messageRow = z.looseObject({
  id: z.string(),
  text: z.string(),
  sender: z.string(),
  date: z.string(),
  readAt: z.string().optional(),
  senderUserId: z.string().optional(),
})
const conversationRow = z.looseObject({
  id: z.string(),
  studentId: z.string(),
  teacherId: z.string(),
  audience: z.string(),
  parentUserId: z.string().optional(),
  createdAt: z.string().optional(),
  messages: z.array(messageRow),
})

function toConversation(data: unknown): Conversation | null {
  const parsed = conversationRow.safeParse(data)
  // Şema core yazışma tipinin alanlarını taşır; fazlası (`looseObject`) korunur.
  return parsed.success ? (parsed.data as Conversation) : null
}

/** Son etkinlik anı: son mesaj, yoksa açılış anı. */
const lastActivity = (conversation: Conversation) =>
  conversation.messages.at(-1)?.date ?? conversation.createdAt ?? ''

export type ConversationListItem = ConversationSummary & { parentUserId: string | null }

export interface ConversationListQuery {
  page: number
  pageSize: number
  studentId?: string | undefined
}

/** Tarafın SQL ön süzgeci (performans); sonuç yine core `isConversationParty` ile süzülür. */
function partyPrefilter(scope: Scope): FieldMatch[] {
  if (scope.actor.role === 'ogretmen')
    return [{ field: 'teacherId', values: scope.teacher ? [scope.teacher.id] : [] }]
  return [{ field: 'studentId', values: [...scope.studentIds] }]
}

/**
 * Yazışma listesi. Taraf (öğretmen, öğrenci, veli) yalnız tarafı olduğu yazışmaları son
 * etkinliğe göre azalan görür; satırda son mesaj, okunmamış sayısı ve öğretmende yanıt bekleme
 * durumu vardır (DOM-ILT-010, -013, -024). Yönetici yalnız `studentId` ile ve yalnız üst veriyi
 * görür (son mesaj yok); içeriği gerekçeli erişimle açar (DOM-YTK-052).
 */
export async function listConversations(
  ctx: ServiceContext,
  query: ConversationListQuery,
): Promise<{ items: ConversationListItem[]; total: number }> {
  const admin = ctx.actor.role === 'yonetici'
  let match: FieldMatch[]
  let scope: Scope | null = null
  if (admin) {
    if (query.studentId === undefined)
      throw new ValidationError([
        {
          path: ['querystring', 'studentId'],
          code: 'invalid_value',
          message: 'Öğrenci seçin.',
        },
      ])
    match = [{ field: 'studentId', values: [query.studentId] }]
  } else {
    scope = await readScope(ctx)
    assertReadable(ctx, scope, 'conversations')
    match = partyPrefilter(scope)
    if (query.studentId !== undefined) match.push({ field: 'studentId', values: [query.studentId] })
  }
  const rows = await loadRecords(ctx.db, ctx.institutionId, ['conversations'], { match })
  const visible: Conversation[] = []
  let skipped = 0
  for (const row of rows) {
    const conversation = toConversation(row.data)
    if (!conversation) skipped += 1
    else if (!scope || isConversationParty(scope, ctx.actor.userId, conversation))
      visible.push(conversation)
  }
  if (skipped > 0) ctx.log.warn({ event: 'conversation.row_invalid', skipped })
  visible.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)) || a.id.localeCompare(b.id))
  const start = (query.page - 1) * query.pageSize
  const side = admin ? null : senderSide(ctx.actor.role)
  const now = ctx.now.toISOString()
  return {
    total: visible.length,
    items: visible.slice(start, start + query.pageSize).map((conversation) => ({
      ...conversationSummary(conversation, side, now),
      parentUserId: conversation.parentUserId ?? null,
    })),
  }
}

/**
 * Yöneticinin bu yazışma için son `CONVERSATION_ACCESS_MINUTES` dakikadaki gerekçeli erişim
 * kaydı (`audit_log`, `conversation.access`); yoksa `null`.
 */
async function activeAccess(ctx: ServiceContext, conversationId: string) {
  const since = new Date(ctx.now.getTime() - CONVERSATION_ACCESS_MINUTES * 60_000)
  const [row] = await ctx.db
    .select({ createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.institutionId, ctx.institutionId),
        eq(auditLog.entityType, 'conversations'),
        eq(auditLog.entityId, conversationId),
        eq(auditLog.action, 'conversation.access'),
        eq(auditLog.actorUserId, ctx.actor.userId),
        gt(auditLog.createdAt, since),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Yazışmanın mesajları, en yeniden geriye imleçli sayfa (core `messagePage`). Taraf olmayan ve
 * gerekçeli erişimi olmayan yöneticiye 404 (DOM-YTK-052); yöneticinin okuması okundu üretmez.
 */
export async function listConversationMessages(
  ctx: ServiceContext,
  conversationId: string,
  query: { cursor?: string | undefined; limit: number },
): Promise<{ items: MessageView[]; nextCursor: string | null }> {
  const admin = ctx.actor.role === 'yonetici'
  const scope = admin ? null : await readScope(ctx)
  if (scope) assertReadable(ctx, scope, 'conversations')
  const row = await findRecord(ctx.db, ctx.institutionId, 'conversations', conversationId)
  const conversation = row ? toConversation(row.data) : null
  if (!conversation) throw new NotFoundError()
  if (scope) {
    if (!isConversationParty(scope, ctx.actor.userId, conversation)) throw new NotFoundError()
  } else if (conversation.audience !== 'student' || !(await activeAccess(ctx, conversationId)))
    // Yönetici yalnız öğrenci–öğretmen yazışmasını gerekçeyle okur (DOM-ILT-011).
    throw new NotFoundError()
  const page = messagePage(conversation, admin ? null : senderSide(ctx.actor.role), query)
  if (!page)
    throw new ValidationError([
      { path: ['querystring', 'cursor'], code: 'invalid_value', message: 'Sayfa imleci geçersiz.' },
    ])
  return page
}

/**
 * Öğrencinin platformdaki veli hesapları (`membership_links` kind `child`): öğretmenin veli
 * yazışmasında veli seçimi için (DOM-ILT-010). Kapsam `startConversation` kuralıyla birebir
 * aynıdır (core `parentAccountsDecision`): öğretmen o öğrenci için veli yazışması açabiliyorsa
 * görür, aksi halde (kapsam dışı, var olmayan, başka kurum) 404. Ad dışında kişisel veri dönmez.
 */
export async function listStudentParentAccounts(
  ctx: ServiceContext,
  studentId: string,
): Promise<{ userId: string; name: string }[]> {
  const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
  if (parentAccountsDecision(scope, source, studentId)) throw new NotFoundError()
  return parentAccounts(ctx.db, ctx.institutionId, studentId)
}

async function parentAccounts(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<{ userId: string; name: string }[]> {
  return db
    .select({ userId: memberships.userId, name: users.name })
    .from(membershipLinks)
    .innerJoin(memberships, eq(memberships.id, membershipLinks.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(membershipLinks.institutionId, institutionId),
        eq(membershipLinks.kind, 'child'),
        eq(membershipLinks.recordId, studentId),
        eq(memberships.institutionId, institutionId),
        eq(memberships.role, 'veli'),
      ),
    )
    .orderBy(asc(users.name), asc(memberships.userId))
}

// --- Yazma --------------------------------------------------------------------------------

type CommunicationAction =
  | 'announcement.publish'
  | 'announcement.revise'
  | 'announcement.withdraw'
  | 'announcement.read'
  | 'conversation.start'
  | 'message.send'
  | 'message.read'

type Entity = { collection: CollectionName; id: string }
type Outcome = { entity: Entity; statusCode: number }

interface CommunicationRun {
  action: CommunicationAction
  /** İşlemin konusu; `If-Match` bu kaydın sürümüyle karşılaştırılır. */
  subject: Entity | null
  /** Öğretmenin veli yazışması açarken öğrencinin veli hesapları (core `parentUserIds`). */
  parentsOf?: string | undefined
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType; parentUserIds: readonly string[] },
  ) => Outcome
}

/**
 * İletişim komutu: core işlemi işlem çalıştırıcıyla tek transaction'da yürütür. Rol, modül ve
 * kapsam core `requireAuthorized`'dadır (işlemin içinde). Yanıt durumu işlemin sonucundandır
 * (oluşturmada 201, var olan yazışmaya eklemede 200); idempotent tekrar aynı durumu döndürür.
 */
function executeCommunication(
  ctx: ServiceContext,
  command: CommunicationRun,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
      ...(command.subject && options.expectedVersion !== null
        ? { expectedVersions: [{ ...command.subject, version: options.expectedVersion }] }
        : {}),
      entity: (outcome: Outcome) => ({ type: outcome.entity.collection, id: outcome.entity.id }),
      load: async (tx) => {
        const [{ actor, institutionType, scalars }, parents] = await Promise.all([
          environment(tx, ctx, spec),
          command.parentsOf === undefined
            ? Promise.resolve([])
            : parentAccounts(tx, ctx.institutionId, command.parentsOf),
        ])
        const by = participantOf(ctx, actor)
        return {
          scalars,
          run: (state, tools) =>
            command.run(state, by, tools, {
              institutionType,
              parentUserIds: parents.map((parent) => parent.userId),
            }),
        }
      },
    },
    (outcome) => commandBody(outcome.result.entity, outcome.changes, outcome.result.statusCode),
    options.idempotency,
  )
}

const announcementEntity = (id: string): Entity => ({ collection: 'announcements', id })
const conversationEntity = (id: string): Entity => ({ collection: 'conversations', id })

/** Duyuru yayını (DOM-ILT-001, -002): alıcı listesi yayında çözülür. 201. */
export function publishAnnouncementCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'announcement.publish',
      subject: null,
      run: (state, by, { now, makeId }, { institutionType }) => {
        const created = publishAnnouncement(state, by, input, makeId, now, { institutionType })
        return { entity: announcementEntity(created.id), statusCode: 201 }
      },
    },
    options,
  )
}

/** Duyuru düzeltme (DOM-ILT-004): önceki içerik geçmişte kalır; `If-Match` duyurunun sürümü. */
export function reviseAnnouncementCommand(
  ctx: ServiceContext,
  announcementId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'announcement.revise',
      subject: announcementEntity(announcementId),
      run: (state, by, { now }, { institutionType }) => {
        reviseAnnouncement(state, by, announcementId, input, now, { institutionType })
        return { entity: announcementEntity(announcementId), statusCode: 200 }
      },
    },
    options,
  )
}

/** Duyuruyu geri çeker (DOM-ILT-004): kayıt silinmez; alıcı "Geri çekildi" işaretini görür. */
export function withdrawAnnouncementCommand(
  ctx: ServiceContext,
  announcementId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'announcement.withdraw',
      subject: announcementEntity(announcementId),
      run: (state, by, { now }, { institutionType }) => {
        withdrawAnnouncement(state, by, announcementId, input, now, { institutionType })
        return { entity: announcementEntity(announcementId), statusCode: 200 }
      },
    },
    options,
  )
}

/** Okundu işareti (DOM-ILT-003): ilk açılış anı bir kez yazılır; tekrar çağrı kayıt değiştirmez. */
export function readAnnouncementCommand(
  ctx: ServiceContext,
  announcementId: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'announcement.read',
      subject: null,
      run: (state, by, { now }, { institutionType }) => {
        markAnnouncementRead(state, by, announcementId, now, { institutionType })
        return { entity: announcementEntity(announcementId), statusCode: 200 }
      },
    },
    options,
  )
}

/**
 * Yazışma başlatır (DOM-ILT-010, -011). Öğretmenin veli yazışmasında öğrencinin veli hesapları
 * `membership_links`'ten core'a verilir. Yeni yazışma 201, var olan yazışma 200.
 */
export function startConversationCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const studentId =
    typeof input === 'object' && input !== null && 'studentId' in input
      ? input.studentId
      : undefined
  return executeCommunication(
    ctx,
    {
      action: 'conversation.start',
      subject: null,
      parentsOf:
        ctx.actor.role === 'ogretmen' && typeof studentId === 'string'
          ? studentId.trim()
          : undefined,
      run: (state, by, { now, makeId }, { institutionType, parentUserIds }) => {
        const result = startConversation(state, by, input, makeId, now, {
          institutionType,
          parentUserIds,
        })
        return {
          entity: conversationEntity(result.conversation.id),
          statusCode: result.created ? 201 : 200,
        }
      },
    },
    options,
  )
}

/** Mesaj gönderir (DOM-ILT-012): yalnız taraf; mesaj eklenir, değiştirilmez. 201. */
export function sendMessageCommand(
  ctx: ServiceContext,
  conversationId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'message.send',
      subject: null,
      run: (state, by, { now, makeId }, { institutionType }) => {
        sendMessage(state, by, conversationId, input, makeId, now, { institutionType })
        return { entity: conversationEntity(conversationId), statusCode: 201 }
      },
    },
    options,
  )
}

/** Karşı tarafın mesajlarını okundu işaretler (DOM-ILT-024). */
export function readMessagesCommand(
  ctx: ServiceContext,
  conversationId: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeCommunication(
    ctx,
    {
      action: 'message.read',
      subject: null,
      run: (state, by, { now }, { institutionType }) => {
        markMessagesRead(state, by, conversationId, now, { institutionType })
        return { entity: conversationEntity(conversationId), statusCode: 200 }
      },
    },
    options,
  )
}

/**
 * Yöneticinin gerekçeli erişimi (DOM-YTK-052, DOM-ILT-011): core `openConversationAccess`
 * gerekçeyi ve yazışmanın varlığını doğrular, erişim `audit_log`'a gerekçesiyle yazılır. Okuma
 * (`listConversationMessages`) son `CONVERSATION_ACCESS_MINUTES` dakikadaki kayda bakar.
 */
export async function openConversationAccessCommand(
  ctx: ServiceContext,
  conversationId: string,
  input: unknown,
): Promise<{ conversationId: string; expiresAt: string }> {
  const spec = OPERATION_COMMANDS['conversation.access']
  const { result } = await runOperation(ctx, {
    action: 'conversation.access',
    collections: spec.collections,
    entity: { type: 'conversations', id: conversationId },
    load: async (tx) => {
      const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
      return {
        scalars,
        run: (state, { now }) => {
          const access = openConversationAccess(state, actor, conversationId, input, now, {
            institutionType,
          })
          // Erişim State değiştirmez; denetim kaydı aynı transaction'da yazılır.
          return access
        },
      }
    },
    after: async (tx, access) => {
      await tx.insert(auditLog).values({
        institutionId: ctx.institutionId,
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        action: 'conversation.access',
        entityType: 'conversations',
        entityId: conversationId,
        // kvkk: K — gerekçe yalnız denetim kaydında tutulur (DOM-YTK-052).
        changes: { reason: access.reason },
        createdAt: ctx.now,
      })
    },
  })
  return { conversationId: result.conversationId, expiresAt: result.expiresAt }
}
