import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isUnderAdultAge } from './age.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { Actor } from './scope.ts'

/**
 * Uygulama içi bildirim merkezi (docs/domain/iletisim-ve-veli.md DOM-ILT-020, -022, -023, -073;
 * IST-065'in ilk parçası). Saf kurallar: bildirim türleri kaydı, alıcı kapsamı, okundu durumu ve
 * gösterilen başlık. Web, mobil ve API aynı kuralları çalıştırır; çevrimdışı demo bildirim
 * üretmez.
 *
 * - Bildirim (`notifications`) bir öğrenciye ait olaydır ve bir alıcı kitlesine (`audience`)
 *   gider: öğrencinin kendisi (`student`) ya da velileri (`parent`). Alıcı kullanıcı kimliğiyle
 *   değil öğrenci bağıyla çözülür: öğrenci kendi kaydına, veli bağlı çocuğuna ait bildirimi görür
 *   (üyelik bağlantıları, `Actor.links`). Böylece kesin kayıtta henüz hesabı olmayan veli de
 *   hesabı çocuğuna bağlanınca bildirimi görür; velayet değişince alıcılar kendiliğinden yeniden
 *   hesaplanır (DOM-ILT-071).
 * - Okundu durumu kullanıcıya özeldir (`notificationReads`, kimlik `<bildirim>:<kullanıcı>`):
 *   iki veli aynı bildirimi görse de birinin okuması diğerine yansımaz ve diğer velinin
 *   kimliği hiçbir yanıtta yer almaz (DOM-ILT-073). Bildirim kaydı değişmez.
 * - Kayıtta serbest metin yoktur: tür, alıcı kitlesi, öğrenci ve konu kaydının kimliği. Başlık
 *   okumada türün sabit şablonundan, yalnız öğrencinin adıyla üretilir; not, puan, geri bildirim
 *   metni, devamsızlık nedeni, sağlık, borç tutarı veya rehberlik bilgisi taşımaz (DOM-ILT-023,
 *   KVKK md. 12/1). Şema bilinmeyen alanı reddeder.
 * - Yetişkin kursiyerin (dil okulu, 18 yaş ve üstü) bildirimi kendisine gider, veliye gitmez
 *   (DOM-ILT-052'deki ilke; KVKK md. 4/2 ölçülülük).
 * - Uygulama içi kanal her zaman açıktır, tercih bunu kapatmaz (DOM-ILT-020). Bütün türler
 *   `hizmet` bildirimidir; ticari ileti onayı gerektiren tür yoktur (DOM-ILT-022).
 */
// TODO(F6-anlik-bildirim): anlık bildirim, e-posta ve SMS kanalı, sessiz saatler (DOM-ILT-021) ve
// konu bazında kanal tercihi (DOM-ILT-020) sonraki F6 işleridir; hedefli duyuru (IST-066),
// dijital veli onayı (IST-067), kurallı mesaj (IST-070) ve devamsızlık bildirimi (IST-072,
// DOM-ILT-052) de bildirim üretmez.
// TODO(velayet-kapsam): velayeti olmayan ebeveyn (DOM-ILT-070) bugün de bağlı çocuğunun
// bildirimini görür; bağ velayet durumunu taşımaz.

export const NOTIFICATION_AUDIENCES = ['student', 'parent'] as const
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number]

/**
 * Bildirim konuları (DOM-ILT-020 listesi). `enrollment` listede yoktur: kesin kayıt bildirimi
 * için eklendi (kayıt ve kurumla ilişki; tercih ekranı geldiğinde konu adı gözden geçirilir).
 */
export const NOTIFICATION_TOPICS = [
  'homework',
  'grade',
  'attendance',
  'payment',
  'announcement',
  'message',
  'appointment',
  'consent',
  'bulletin',
  'enrollment',
] as const
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]

/** Hizmet bildirimi ve ticari ileti (DOM-ILT-022). Ticari tür ileti onayı gelmeden eklenmez. */
export type NotificationCategory = 'service' | 'commercial'

type KindSpec = {
  readonly topic: NotificationTopic
  readonly category: NotificationCategory
  /** Kapatılamayan bildirim (DOM-ILT-020: acil durum, devamsızlık, onay son tarihi). */
  readonly mandatory: boolean
  /** Alıcı kitlesi: 18 yaş altı öğrencide ve yetişkin kursiyerde. */
  readonly audiences: {
    readonly minor: readonly NotificationAudience[]
    readonly adult: readonly NotificationAudience[]
  }
  /** Konu kaydının türü (istemci bağlantısı için). */
  readonly subjectType: string
  /**
   * Gösterilen başlık şablonu; `{öğrenci}` öğrencinin ilk adıyla değişir. Ayrıntı (puan, geri
   * bildirim metni, tutar) yazılmaz (DOM-ILT-023).
   */
  readonly titles: Readonly<Record<NotificationAudience, string>>
}

/** Bildirim türleri kaydı. Yeni tür buraya eklenir; üreten işlem yalnız kayıtlı türü yazar. */
export const NOTIFICATION_KINDS = {
  /** Öğretmen geri bildirimi açıldı: puan kesinleşti ve kursiyere açıldı (DOM-BEC-045). */
  feedback_released: {
    topic: 'homework',
    category: 'service',
    mandatory: false,
    audiences: { minor: ['student', 'parent'], adult: ['student'] },
    subjectType: 'task_submission',
    titles: {
      student: 'Görevine öğretmen geri bildirimi geldi.',
      parent: '{öğrenci} için öğretmen geri bildirimi geldi.',
    },
  },
  /** Kesin kayıt tamamlandı (DOM-KAY-011); 18 yaş altında veliye, yetişkinde kursiyere. */
  enrollment_completed: {
    topic: 'enrollment',
    category: 'service',
    mandatory: false,
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'students',
    titles: {
      student: 'Kesin kaydın tamamlandı.',
      parent: '{öğrenci} için kesin kayıt tamamlandı.',
    },
  },
} as const satisfies Record<string, KindSpec>

export type NotificationKind = keyof typeof NOTIFICATION_KINDS
export const NOTIFICATION_KIND_NAMES = Object.keys(NOTIFICATION_KINDS) as NotificationKind[]
const KINDS: Readonly<Record<string, KindSpec>> = NOTIFICATION_KINDS

const identifier = z.string().trim().min(1).max(200)

/** Saklanan bildirim; serbest metin alanı yoktur (DOM-ILT-023). */
export const notificationRecordSchema = z.strictObject({
  id: identifier,
  kind: z.enum(NOTIFICATION_KIND_NAMES as [NotificationKind, ...NotificationKind[]]),
  audience: z.enum(NOTIFICATION_AUDIENCES),
  studentId: identifier,
  subject: z.strictObject({ type: identifier, id: identifier }),
  createdAt: z.iso.datetime(),
})
export type NotificationRecord = z.infer<typeof notificationRecordSchema>

/** Kullanıcının okundu işareti; kimlik `notificationReadId`. */
export const notificationReadRecordSchema = z.strictObject({
  id: identifier,
  notificationId: identifier,
  // kvkk: K — okuyan kullanıcının kimliği; hiçbir yanıtta dönmez.
  userId: identifier,
  readAt: z.iso.datetime(),
})
export type NotificationReadRecord = z.infer<typeof notificationReadRecordSchema>

/** Okundu kaydının kimliği: bildirim ve kullanıcı başına bir kayıt. */
export const notificationReadId = (notificationId: string, userId: string) =>
  `${notificationId}:${userId}`

export const notificationSpec = (kind: NotificationKind): KindSpec => NOTIFICATION_KINDS[kind]

/**
 * Öğrenci 18 yaş altında mı (bildirimin veliye gidip gitmeyeceği). Okulda her öğrenci velilidir.
 * Dil okulunda doğum tarihi, yoksa kesin kayda alınan adayın 18 yaş seçimi belirler; ikisi de
 * yoksa kesin kayıttaki varsayılan gibi 18 yaş altı sayılır (`lib/domain.ts` `enrollProspect`).
 * Dil okulunda `students` ve `prospects` okunur (yalnız öğrencinin kaydı ve adayı yeter).
 */
export function learnerIsMinor(
  state: Pick<State, 'students'> & Partial<Pick<State, 'prospects'>>,
  studentId: string,
  options: { institutionType: InstitutionType; now: string },
): boolean {
  if (options.institutionType === 'school') return true
  const student = state.students.find((s) => s.id === studentId)
  if (student?.birthDate !== undefined) return isUnderAdultAge(student.birthDate, options.now)
  const prospect = state.prospects?.find((p) => p.studentId === studentId)
  return prospect?.minor ?? true
}

export type StudentEvent = {
  kind: NotificationKind
  studentId: string
  /** Konu kaydının kimliği; türü kayıttan gelir (`subjectType`). */
  subjectId: string
  /** `learnerIsMinor`; yetişkin kursiyerin bildirimi veliye gitmez. */
  minor: boolean
}

/**
 * Öğrenciye ait olay için bildirimleri yazar: türün alıcı kitlesi başına bir kayıt. Ticari tür
 * ileti onayı denetimi gelmeden yazılmaz (DOM-ILT-022). Yalnız `notifications` yazılır.
 */
export function notifyStudentEvent(
  state: Pick<State, 'notifications'>,
  event: StudentEvent,
  makeId: MakeId,
  now: string,
): NotificationRecord[] {
  const spec = KINDS[event.kind]
  if (spec === undefined) throw new Error(`unknown notification kind: ${event.kind}`)
  // TODO(F6-ticari-ileti): ticari tür, kanal bazında ileti onayı (DOM-KAY-004) denetimiyle gelir.
  if (spec.category !== 'service') throw new Error('commercial notification needs consent check')
  const audiences = event.minor ? spec.audiences.minor : spec.audiences.adult
  const created = audiences.map((audience) =>
    notificationRecordSchema.parse({
      id: makeId('ntf'),
      kind: event.kind,
      audience,
      studentId: event.studentId,
      subject: { type: spec.subjectType, id: event.subjectId },
      createdAt: now,
    }),
  )
  state.notifications.push(...created)
  return created
}

/**
 * Aktörün gördüğü bildirimlerin öğrencileri, alıcı kitlesine göre: öğrenci kendi kaydının
 * `student`, veli bağlı çocuklarının `parent` bildirimlerini görür. Personelin bugün bildirimi
 * yoktur (boş). Kapsam istemcinin gönderdiği kimlikten değil üyelik bağlantılarından gelir.
 */
export function notificationAudienceOf(
  actor: Pick<Actor, 'role' | 'links'>,
): Record<NotificationAudience, string[]> {
  const ids = (kind: 'student' | 'child') =>
    [...new Set(actor.links.filter((l) => l.kind === kind).map((l) => l.recordId))].sort()
  return {
    student: actor.role === 'ogrenci' ? ids('student') : [],
    parent: actor.role === 'veli' ? ids('child') : [],
  }
}

/** Aktör bu bildirimi görür mü (`notificationAudienceOf`). */
export function canSeeNotification(
  actor: Pick<Actor, 'role' | 'links'>,
  notification: Pick<NotificationRecord, 'audience' | 'studentId'>,
): boolean {
  return notificationAudienceOf(actor)[notification.audience].includes(notification.studentId)
}

type Reader = Pick<Actor, 'role' | 'links'> & { userId: string }
type ReadState = Pick<State, 'notifications' | 'notificationReads'>
export type NotificationOptions = { institutionType?: InstitutionType }

const notFound = () =>
  new DomainError('notification_not_found', 'Bildirim bulunamadı.', { kind: 'not_found' })

/**
 * Bildirimi okundu işaretler. Modül kapalıysa 403 `module_disabled` (`requireAuthorized`). Görülemeyen veya olmayan bildirim 404 (`notification_not_found`;
 * varlık sızmaz). Okunmuşsa ilk okuma anı korunur, hiçbir kayıt değişmez.
 */
export function markNotificationRead(
  state: State,
  by: Participant,
  notificationId: string,
  now: string,
  options: NotificationOptions = {},
): NotificationReadRecord {
  requireAuthorized(by, 'notification.read', {}, state, options)
  const notification = state.notifications.find((n) => n.id === notificationId)
  if (notification === undefined || !canSeeNotification(by, notification)) throw notFound()
  const id = notificationReadId(notification.id, by.userId)
  const existing = state.notificationReads.find((r) => r.id === id)
  if (existing) return existing
  const read: NotificationReadRecord = {
    id,
    notificationId: notification.id,
    userId: by.userId,
    readAt: now,
  }
  state.notificationReads.push(read)
  return read
}

/**
 * Aktörün gördüğü bütün okunmamış bildirimleri okundu işaretler; işaretlenen sayıyı döndürür.
 * Görmediği bildirim (yüklenmiş olsa da) işaretlenmez.
 */
export function markAllNotificationsRead(
  state: State,
  by: Participant,
  now: string,
  options: NotificationOptions = {},
): number {
  requireAuthorized(by, 'notification.read_all', {}, state, options)
  const read = new Set(state.notificationReads.map((r) => r.id))
  let marked = 0
  for (const notification of state.notifications) {
    if (!canSeeNotification(by, notification)) continue
    const id = notificationReadId(notification.id, by.userId)
    if (read.has(id)) continue
    state.notificationReads.push({
      id,
      notificationId: notification.id,
      userId: by.userId,
      readAt: now,
    })
    read.add(id)
    marked += 1
  }
  return marked
}

/** Aktörün okunmamış bildirim sayısı (saklanmaz; API aynı sonucu SQL'de hesaplar). */
export function unreadNotificationCount(state: ReadState, by: Reader): number {
  const read = new Set(
    state.notificationReads.filter((r) => r.userId === by.userId).map((r) => r.notificationId),
  )
  return state.notifications.filter((n) => canSeeNotification(by, n) && !read.has(n.id)).length
}

/** Ad soyaddan ilk ad (bildirim başlığı yalnız ilk adı taşır). */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/**
 * Bildirimin gösterilen başlığı: türün şablonu ve öğrencinin ilk adı (DOM-ILT-023). Ad yoksa
 * "Öğrenci" yazılır.
 */
export function notificationTitle(
  notification: Pick<NotificationRecord, 'kind' | 'audience'>,
  studentName: string | null | undefined,
): string {
  const template = notificationSpec(notification.kind).titles[notification.audience]
  return template.replace('{öğrenci}', firstName(studentName ?? '') || 'Öğrenci')
}
