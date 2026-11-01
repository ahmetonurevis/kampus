import { SCOPE_SOURCE_COLLECTIONS } from '@kampus/school-core/lib/scope.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  isMinorLearner,
  markAllNotificationsRead,
  markNotificationRead,
  notificationAudienceOf,
  notificationReadId,
  notificationRecordSchema,
  notificationSpec,
  notificationTitle,
  type NotificationAudience,
} from '@kampus/school-core/lib/notifications.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { notificationPage, unreadNotificationTotal, type AudienceIds } from '../db/notifications.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { listMembershipLinks } from './memberships.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type LoadScope } from './operation-runner.ts'

/**
 * Uygulama içi bildirim merkezi (F6a; core `lib/notifications.ts`; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-020, -023, -073). Görünürlük core `notificationAudienceOf`'tur: öğrenci kendi
 * `student`, veli bağlı çocuğunun `parent` bildirimini görür; personelin bildirimi yoktur (boş
 * liste). Kapsam üyelik bağlantılarındandır; istemcinin gönderdiği kimlik okunmaz.
 *
 * Okuma SQL'dedir (`db/notifications.ts`): sayfa, toplam ve okunmamış sayısı kurumun bütün
 * bildirimleri uygulamaya çekilmeden hesaplanır; başlık core şablonundan yalnız sayfadaki
 * öğrencilerin adıyla üretilir. Okundu işaretleri yalnız aktörün gördüğü bildirimleri ve kendi
 * işaretlerini yükler; kapsam kaynağı yalnız yetki (modül, rol) içindir, yüklenmez.
 *
 * Başlık ve öğrenci adı loglanmaz; denetim kaydına yalnız alan adları yazılır (çalıştırıcı).
 * Bildirim üretimi kendi işlemlerindedir (kesin kayıt `services/prospects.ts`, öğretmen puanı
 * `services/task-grading.ts`) ve aynı transaction'da yazılır.
 */

const NONE: LoadScope = { ids: [] }
/** Kapsam kaynağı yetki için boş verilir: okundu kararı yalnız üyelik bağlantılarına dayanır. */
const NO_SCOPE: Partial<Record<CollectionName, LoadScope>> = Object.fromEntries(
  SCOPE_SOURCE_COLLECTIONS.map((collection) => [collection, NONE]),
)

async function audienceOf(ctx: ServiceContext): Promise<AudienceIds> {
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  return notificationAudienceOf({ role: ctx.actor.role, links })
}

export interface NotificationListInput {
  cursor?: string | undefined
  limit: number
  unread: boolean
}

/**
 * Aktörün bildirim sayfası, en yeni önce (DOM-ILT-020). İmleç aktörün görebildiği bir bildirim
 * değilse 400 (başkasının bildiriminin varlığı sızmaz).
 */
export async function listNotifications(ctx: ServiceContext, input: NotificationListInput) {
  const audience = await audienceOf(ctx)
  const page = await notificationPage(ctx.db, ctx.institutionId, ctx.actor.userId, audience, input)
  if (!page)
    throw new ValidationError([
      { path: ['querystring', 'cursor'], code: 'invalid_value', message: 'Sayfa imleci geçersiz.' },
    ])
  const items = page.rows.map((row) => ({
    record: notificationRecordSchema.parse(row.data),
    readAt: row.readAt,
  }))
  const studentIds = [...new Set(items.map((item) => item.record.studentId))]
  const students = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', studentIds)
  const names = new Map(
    students.map((s) => [s.id, typeof s.data.name === 'string' ? s.data.name : null]),
  )
  return {
    data: items.map(({ record, readAt }) => ({
      id: record.id,
      kind: record.kind,
      topic: notificationSpec(record.kind).topic,
      audience: record.audience,
      studentId: record.studentId,
      subject: record.subject,
      title: notificationTitle(record, names.get(record.studentId)),
      createdAt: record.createdAt,
      readAt,
    })),
    meta: { nextCursor: page.more ? (items.at(-1)?.record.id ?? null) : null },
  }
}

/** Aktörün okunmamış bildirim sayısı (saklanmaz). */
export async function countUnreadNotifications(ctx: ServiceContext) {
  const audience = await audienceOf(ctx)
  return {
    data: {
      unread: await unreadNotificationTotal(ctx.db, ctx.institutionId, ctx.actor.userId, audience),
    },
  }
}

type ReadAction = 'notification.read' | 'notification.read_all'
type ReadState = Parameters<typeof markAllNotificationsRead>[0]
type ReadOptions = NonNullable<Parameters<typeof markAllNotificationsRead>[3]>

interface ReadRun {
  action: ReadAction
  loadScope: Partial<Record<CollectionName, LoadScope>>
  /** Yanıtın konusu: tekil işaretlemede bildirim, toplu işaretlemede yok. */
  subject: { collection: CollectionName; id: string } | null
  run: (state: ReadState, by: Participant, now: string, options: ReadOptions) => void
}

function executeRead(
  ctx: ServiceContext,
  command: ReadRun,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
      loadScope: { ...NO_SCOPE, ...command.loadScope },
      // Toplu işaretlemenin denetim kaydı okuyan kullanıcıya bağlanır.
      entity: command.subject
        ? { type: command.subject.collection, id: command.subject.id }
        : { type: 'notificationReads', id: ctx.actor.userId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state, { now }) => command.run(state, by, now, { institutionType }),
        }
      },
    },
    (outcome) => commandBody(command.subject, outcome.changes),
    options.idempotency,
  )
}

/**
 * Bildirimi okundu işaretler (core `markNotificationRead`): görülemeyen, başka kurumun veya
 * olmayan bildirim 404 `notification_not_found`; okunmuşsa ilk an korunur, hiçbir kayıt değişmez.
 */
export function readNotificationCommand(
  ctx: ServiceContext,
  notificationId: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return executeRead(
    ctx,
    {
      action: 'notification.read',
      loadScope: {
        notifications: { ids: [notificationId] },
        notificationReads: { ids: [notificationReadId(notificationId, ctx.actor.userId)] },
      },
      subject: { collection: 'notifications', id: notificationId },
      run: (state, by, now, readOptions) => {
        markNotificationRead(state, by, notificationId, now, readOptions)
      },
    },
    options,
  )
}

/**
 * Aktörün gördüğü bütün okunmamış bildirimleri okundu işaretler (core
 * `markAllNotificationsRead`). Yalnız aktörün kitlesindeki bildirimler ve kendi işaretleri
 * yüklenir; kitle istekten önce üyelik bağlantılarından okunur, core kararı işlemdeki
 * bağlantılarla yeniden verir.
 */
export async function readAllNotificationsCommand(
  ctx: ServiceContext,
  options: CommandOptions,
): Promise<CommandResponse> {
  const audience = await audienceOf(ctx)
  const kinds = (Object.keys(audience) as NotificationAudience[]).filter(
    (kind) => audience[kind].length > 0,
  )
  const studentIds = kinds.flatMap((kind) => audience[kind])
  const notifications: LoadScope =
    studentIds.length === 0
      ? NONE
      : {
          match: [
            { kind: 'equals', field: 'audience', values: kinds },
            { kind: 'equals', field: 'studentId', values: studentIds },
          ],
        }
  return executeRead(
    ctx,
    {
      action: 'notification.read_all',
      loadScope: {
        notifications,
        notificationReads: {
          match: [{ kind: 'equals', field: 'userId', values: [ctx.actor.userId] }],
        },
      },
      subject: null,
      run: (state, by, now, readOptions) => {
        markAllNotificationsRead(state, by, now, readOptions)
      },
    },
    options,
  )
}

/** Öğrenciye ait olayın bildirim kararı: bildirim merkezi açık mı, öğrenci 18 yaş altında mı. */
export interface StudentNotice {
  /** İletişim modülü kapalıysa bildirim merkezi yoktur, bildirim üretilmez. */
  enabled: boolean
  /** Core `isMinorLearner`; yetişkin kursiyerin bildirimi veliye gitmez. */
  minor: boolean
}

/**
 * İşlemin transaction'ında öğrencinin bildirim kararını okur (State dışı işlemler için; ADR 0004
 * karar 2). Okulda yalnız modül haritası okunur; dil okulunda öğrencinin kaydı ve gerekirse
 * kesin kayda alınan adayı (doğum tarihi yoksa 18 yaş seçimi) okunur. Kişisel veri loglanmaz.
 */
export async function studentNotice(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<StudentNotice> {
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  const enabled = institution?.modules.communication === true
  const institutionType = institution?.type ?? 'school'
  const options = { institutionType, now: ctx.now.toISOString() }
  if (!enabled || institutionType === 'school')
    return { enabled, minor: isMinorLearner({}, options) }
  const [student] = await loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId])
  const birthDate = typeof student?.data.birthDate === 'string' ? student.data.birthDate : undefined
  if (birthDate !== undefined) return { enabled, minor: isMinorLearner({ birthDate }, options) }
  const [prospect] = await loadRecords(tx, ctx.institutionId, ['prospects'], {
    match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
  })
  const prospectMinor = typeof prospect?.data.minor === 'boolean' ? prospect.data.minor : undefined
  return { enabled, minor: isMinorLearner({ prospectMinor }, options) }
}
