// Mobil bildirim merkezi kararları (IST-065, DOM-ILT-020): zilin görünürlüğü, bildirimin hedef
// ekranı, okunmamış sayısı ve metin biçimi. Saf işlevlerdir; liste, sayı ve okundu sunucudadır
// (`@kampus/react-shared/use-notifications.ts`). Rozet, erişilebilir ad ve konu → sayfa tablosu
// web ile ortaktır (`@kampus/react-shared/notification-model.ts`).
import {
  NOTIFICATION_MODULE,
  NOTIFICATION_RECIPIENT_ROLES,
  notificationTopicPath,
} from '@kampus/react-shared/notification-model.ts'
import { messageStamp } from '@kampus/react-shared/conversation-model.ts'
import type { NotificationView } from '@kampus/react-shared/use-notifications.ts'
import type { TeacherAttendanceTab } from './attendance-history.ts'
import { apiPages, type ApiScreen } from './pages.ts'
import type { ParentTab } from './parent-tracking.ts'
import { isModuleOpen, type MobileSession } from './session-state.ts'

type SessionScope = Pick<MobileSession, 'role' | 'modules'>
type Topic = NotificationView['topic']

/** Zil yalnız bildirim alan rolde ve bildirim merkezi modülü kapalı değilken görünür. */
export function notificationBellVisible(session: SessionScope): boolean {
  return (
    NOTIFICATION_RECIPIENT_ROLES.includes(session.role) &&
    isModuleOpen(session.modules, NOTIFICATION_MODULE)
  )
}

/**
 * Telefonda karşılığı olmayan (rol, konu) çiftleri: öğrenci randevu ekranı telefondadır
 * (`StudentAppointments`, IST-124), ama veli randevusu henüz yoktur ve veli "Randevu ve mesaj"
 * sayfası telefonda yalnız mesajları açar; bu yüzden velinin randevu bildirimi mesaj ekranına
 * yönlendirilmez.
 */
const WEB_ONLY_TOPICS: Readonly<Record<string, readonly Topic[]>> = {
  veli: ['appointment'],
  ogretmen: ['appointment'],
}

/**
 * Bildirimin açacağı mobil ekran. Konunun rol sayfası mobilde kayıtlı ve modülü açıksa o ekran;
 * aksi halde `null` (ayrıntı bildirim ekranında gösterilir).
 */
export function notificationTarget(session: SessionScope, topic: Topic): ApiScreen | null {
  if (WEB_ONLY_TOPICS[session.role]?.includes(topic)) return null
  const path = topicPath(session.role, topic)
  if (!path) return null
  return apiPages(session).find((page) => page.path === path)?.screen ?? null
}

/**
 * Konunun rol sayfası: ortak tablo (`notification-model.ts`) artı telefonda öğretmenin yoklama
 * sayfası. Öğretmen bugün bildirim almaz (alıcılar öğrenci ve veli; zil görünmez), ama alırsa
 * devamsızlık konusu yoklama geçmişine gider.
 */
function topicPath(role: string, topic: Topic): string | null {
  if (role === 'ogretmen' && topic === 'attendance') return 'yoklama'
  return notificationTopicPath(role, topic)
}

/** Çocuğa özgü konular: hedef ekran bildirimin çocuğu seçili açılır (veli çocuk seçicisi). */
const CHILD_SCOPED_TOPICS: readonly Topic[] = ['homework', 'grade', 'attendance']

/**
 * Hedef ekran ve varsa açılacak sekme. Devamsızlık bildirimi velide Akademik Takip'in Devamsızlık
 * sekmesini, öğretmende Yoklama'nın geçmiş sekmesini açar; diğer konular parametresiz gider.
 */
export type NotificationRoute =
  | { screen: 'ParentTracking'; params: { tab: ParentTab } | undefined }
  | { screen: 'TeacherAttendance'; params: { tab: TeacherAttendanceTab } | undefined }
  | { screen: Exclude<ApiScreen, 'ParentTracking' | 'TeacherAttendance'>; params?: undefined }

/** Hedef ekran adı ve konuya göre sekme parametresi; ekran yoksa `null`. */
export function notificationRoute(
  screen: ApiScreen | null,
  topic: Topic,
): NotificationRoute | null {
  if (screen === null) return null
  if (screen === 'ParentTracking')
    return { screen, params: topic === 'attendance' ? { tab: 'devamsizlik' } : undefined }
  if (screen === 'TeacherAttendance')
    return { screen, params: topic === 'attendance' ? { tab: 'gecmis' } : undefined }
  return { screen }
}

export type NotificationPress = {
  /** Dokununca okundu yazılsın mı (zaten okunmuşsa yazılmaz). */
  markRead: boolean
  /** Gidilecek ekran; `null` ise ayrıntı sayfa içinde açılır. */
  screen: ApiScreen | null
  /** `screen` ve açılacak sekme; ekran yoksa `null`. */
  route: NotificationRoute | null
  /** Hedef ekranda seçilecek çocuk (yalnız veli, çocuğa özgü konu ve hesabın çocuğuysa). */
  childId: string | null
}

export function notificationPress(
  session: SessionScope & { childIds?: readonly string[] },
  item: Pick<NotificationView, 'topic' | 'readAt'> & { studentId?: string },
): NotificationPress {
  const screen = notificationTarget(session, item.topic)
  const childId =
    screen !== null &&
    session.role === 'veli' &&
    CHILD_SCOPED_TOPICS.includes(item.topic) &&
    item.studentId !== undefined &&
    session.childIds?.includes(item.studentId) === true
      ? item.studentId
      : null
  return {
    markRead: item.readAt === null,
    screen,
    route: notificationRoute(screen, item.topic),
    childId,
  }
}

/**
 * Ayrıntı penceresinin içeriği: dokunma anındaki bildirimin anlık görüntüsüdür. Okundu işareti
 * listeyi tazeleyip kaydı (ör. "Okunmamış" süzgecinde) düşürse de pencere açık kalır; okunma
 * durumu anlık görüntüde olmadığı için eskimiş durum gösterilmez.
 */
export type NotificationDetail = {
  id: string
  title: string
  topicLabel: string
  time: string
}

export function notificationDetail(
  item: Pick<NotificationView, 'id' | 'title' | 'topic' | 'createdAt'>,
  now: Date = new Date(),
): NotificationDetail {
  return {
    id: item.id,
    title: item.title,
    topicLabel: notificationTopicLabel(item.topic),
    time: messageStamp(item.createdAt, now),
  }
}

/** Yüklü bildirimler arasında okunmamış olanların sayısı (yalnız sunucu sayısı yokken yedek). */
export function countUnread(items: readonly Pick<NotificationView, 'readAt'>[]): number {
  return items.filter((item) => item.readAt === null).length
}

/**
 * Gösterilen okunmamış sayısı: sunucu sayısı esastır; henüz gelmediyse yüklü liste sayılır, o da
 * yoksa bilinmez (`undefined`).
 */
export function displayUnread(
  serverCount: number | undefined,
  items: readonly Pick<NotificationView, 'readAt'>[] | undefined,
): number | undefined {
  if (serverCount !== undefined) return serverCount
  return items ? countUnread(items) : undefined
}

/** Listenin üstündeki özet: "3 okunmamış bildirim" ya da "Okunmamış bildirim yok." */
export function unreadSummary(count: number | undefined): string {
  if (count === undefined) return 'Bildirimlerin burada listelenir.'
  return count > 0 ? `${count} okunmamış bildirim` : 'Okunmamış bildirim yok.'
}

/** Boş liste metni (süzgece göre). */
export function emptyNotificationsText(unreadOnly: boolean): { title: string; text: string } {
  return unreadOnly
    ? { title: 'Okunmamış bildirim yok', text: 'Yeni bildirimler burada görünür.' }
    : {
        title: 'Henüz bildirim yok',
        text: 'Ödev, not, devamsızlık ve duyuru bildirimleri burada görünür.',
      }
}

const TOPIC_LABELS: Record<Topic, string> = {
  homework: 'Ödev',
  grade: 'Not',
  attendance: 'Devamsızlık',
  payment: 'Ödeme',
  announcement: 'Duyuru',
  message: 'Mesaj',
  appointment: 'Randevu',
  consent: 'Onay',
  bulletin: 'Bülten',
  enrollment: 'Kayıt',
}

export function notificationTopicLabel(topic: Topic): string {
  return TOPIC_LABELS[topic]
}

/**
 * Satırın erişilebilir adı: okunmamış durumu, konu, başlık, zaman ve dokunma sonucu. `time` biçimli
 * zaman metnidir (`messageStamp`).
 */
export function notificationRowLabel(
  item: Pick<NotificationView, 'title' | 'topic' | 'readAt'>,
  time: string,
  opensScreen: boolean,
): string {
  return [
    item.readAt === null ? 'Okunmamış' : '',
    notificationTopicLabel(item.topic),
    item.title,
    time,
    opensScreen ? 'İlgili ekranı açar' : 'Ayrıntıyı açar',
  ]
    .filter(Boolean)
    .join(', ')
}

/** Telefonda ilgili ekranı olmayan bildirimin ayrıntı notu. */
export const NO_SCREEN_NOTICE =
  'Bu bildirimin ilgili sayfası telefonda yok. Ayrıntıyı web uygulamasında görebilirsiniz.'
