import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType, ModuleKey } from '../modules/collection-modules.ts'
import {
  NOTIFICATION_TYPE_NAMES,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '../modules/notification-types.ts'
import { isUnderAdultAge } from './age.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_TOPICS,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationTopic,
  type NotificationTypeSpec,
} from './notification-type.ts'
import type { Actor } from './scope.ts'

/**
 * Uygulama içi bildirim merkezi (docs/domain/iletisim-ve-veli.md DOM-ILT-020, -022, -023, -073;
 * IST-065). Saf kurallar: tür kaydına erişim (türler alan başına dosyalardadır, birleşimi
 * `modules/notification-types.ts`), üretim kararı (modül, kitle, veri şeması), alıcı kapsamı,
 * okundu durumu ve gösterilen başlık. API üretimi `services/notify.ts` `notify`'dadır. Web, mobil ve API aynı kuralları çalıştırır; çevrimdışı demo bildirim
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

export {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_TOPICS,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationTopic,
}

/**
 * Bildirim türleri kaydı (birleşik; `modules/notification-types.ts`). Yeni tür alanın kendi tür
 * dosyasına eklenir; üreten işlem yalnız kayıtlı türü yazar.
 */
export const NOTIFICATION_KINDS = NOTIFICATION_TYPES
export type NotificationKind = NotificationType
export const NOTIFICATION_KIND_NAMES = NOTIFICATION_TYPE_NAMES
const KINDS: Readonly<Record<string, NotificationTypeSpec>> = NOTIFICATION_KINDS

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

export const notificationSpec = (kind: NotificationKind): NotificationTypeSpec =>
  NOTIFICATION_KINDS[kind]

/**
 * Tür bu kurumda üretilir mi: bildirim merkezi (`communication`) ve türün ilgili modülü açık
 * olmalıdır (DOM-YTK-040). Kapalıysa bildirim hiç yazılmaz; modül sonradan açılınca geçmiş
 * olaylar için bildirim oluşmaz.
 */
export function notificationEnabled(
  kind: NotificationKind,
  modules: Partial<Readonly<Record<ModuleKey, boolean>>>,
): boolean {
  const spec = notificationSpec(kind)
  return modules.communication === true && (spec.module === null || modules[spec.module] === true)
}

/** Alıcı öğrenciye ait karar: türün kitlesinden hangileri (`learnerIsMinor`). */
export function notificationAudiences(
  kind: NotificationKind,
  minor: boolean,
): readonly NotificationAudience[] {
  const spec = notificationSpec(kind)
  return minor ? spec.audiences.minor : spec.audiences.adult
}

/**
 * Çağıranın verisini türün şemasıyla doğrular ve konu kaydını döndürür. Bilinmeyen tür, eksik ya
 * da fazla alan programlama hatasıdır (`Error`; API'de 500): veri kullanıcıdan gelmez. Ticari
 * tür ileti onayı denetimi gelmeden üretilmez (DOM-ILT-022).
 */
export function notificationSubject(
  kind: string,
  data: unknown,
): { kind: NotificationKind; subject: NotificationRecord['subject'] } {
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`unknown notification kind: ${kind}`)
  const known = kind as NotificationKind
  const spec = notificationSpec(known)
  // TODO(F6-ticari-ileti): ticari tür, kanal bazında ileti onayı (DOM-KAY-004) denetimiyle gelir.
  if (spec.category !== 'service') throw new Error('commercial notification needs consent check')
  const parsed = spec.data.safeParse(data)
  if (!parsed.success)
    throw new Error(`invalid notification data: ${kind}`, { cause: parsed.error })
  return {
    kind: known,
    subject: { type: spec.subjectType, id: identifier.parse(spec.subjectId(parsed.data)) },
  }
}

/** Öğrencinin yaşına dair bilinenler (`learnerIsMinor`). */
export type LearnerAgeFacts = {
  /** Öğrencinin doğum tarihi (`YYYY-MM-DD`; API'de `student_identities`, State'te yok). */
  birthDate?: string | undefined
  /** Kesin kayda alınan adayın 18 yaş seçimi (dil okulu). */
  prospectMinor?: boolean | undefined
}

/**
 * Öğrenci 18 yaş altında mı (bildirimin veliye gidip gitmeyeceği). Okulda her öğrenci velilidir.
 * Dil okulunda doğum tarihi, yoksa kesin kayda alınan adayın 18 yaş seçimi belirler; ikisi de
 * yoksa kesin kayıttaki varsayılan gibi 18 yaş altı sayılır (`lib/domain.ts` `enrollProspect`).
 */
export function isMinorLearner(
  facts: LearnerAgeFacts,
  options: { institutionType: InstitutionType; now: string },
): boolean {
  if (options.institutionType === 'school') return true
  if (facts.birthDate !== undefined) return isUnderAdultAge(facts.birthDate, options.now)
  return facts.prospectMinor ?? true
}

/**
 * `isMinorLearner`, kesin kayda alınan adayı State'ten okunarak. Doğum tarihi State'te tutulmaz
 * (kimlik bilgisi API'de `student_identities` tablosundadır, ADR 0006 karar 9); State'te yalnız
 * adayın 18 yaş seçimi vardır ve kesin kayıt onu doğum tarihiyle uyumlu ister.
 */
export function learnerIsMinor(
  state: Partial<Pick<State, 'prospects'>>,
  studentId: string,
  options: { institutionType: InstitutionType; now: string },
): boolean {
  const prospect = state.prospects?.find((p) => p.studentId === studentId)
  return isMinorLearner({ prospectMinor: prospect?.minor }, options)
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
  const created = notificationAudiences(event.kind, event.minor).map((audience) =>
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
