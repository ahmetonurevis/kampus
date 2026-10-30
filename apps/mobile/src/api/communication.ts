// API modunda duyuru ve mesaj ekranlarının saf dönüşümleri (docs/domain/iletisim-ve-veli.md
// DOM-ILT-001…004, -010…014, -024). Yetki ve kapsam sunucudadır: duyuru satırı role göre
// daraltılmış gelir, yazışma satırı yalnız kimlik taşır. Burada yalnız gösterim kararı verilir.
// Web karşılığı `apps/web-react/src/pages/communication/*-model.ts`; davranış aynıdır, mobilde
// yönetici ve ön büro mesaj ekranı görmez.
import { z } from 'zod'
import type {
  ConversationSummary,
  StartConversationInput,
} from '@kampus/react-shared/use-communication.ts'
import { sendMessageSchema } from '@kampus/school-core/lib/communication.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { Tone } from '../ui/components.tsx'
import type { MemberRole } from './session-state.ts'

// --- Duyuru ----------------------------------------------------------------------------------

/** API'nin döndürdüğü duyuru kaydı; alanların bir kısmı role göre yoktur. */
export type AnnouncementRecord = {
  id: string
  title?: string
  /** Geri çekilen duyuruda alıcıya gelmez. */
  text?: string
  date?: string
  category?: string
  revisedAt?: string
  withdrawnAt?: string
  /** Yalnız alıcıya: ilk açılış anı, açılmadıysa `null`. */
  myReadAt?: string | null
}

export const STATUS_UNREAD = 'Okunmadı'
export const STATUS_UPDATED = 'Güncellendi'
export const STATUS_WITHDRAWN = 'Geri çekildi'
export const WITHDRAWN_NOTICE = 'Bu duyuru geri çekildi. İçeriği artık görüntülenemez.'

export type StatusBadge = { text: string; tone: Tone }

export type AnnouncementView = {
  id: string
  title: string
  category: string
  /** Yayın günü, gösterim biçiminde; tarih yoksa boş. */
  date: string
  /** Geri çekilen duyurunun metni her durumda gizlenir. */
  text: string
  withdrawn: boolean
  unread: boolean
  badges: StatusBadge[]
}

/**
 * Satırın rozetleri: geri çekilen yalnız "Geri çekildi" alır; diğerlerinde okunmadı ve
 * güncellendi birlikte görünebilir (güncellenmiş duyuru yeniden okunmamış sayılabilir).
 */
export function announcementBadges(record: AnnouncementRecord): StatusBadge[] {
  if (record.withdrawnAt) return [{ text: STATUS_WITHDRAWN, tone: 'red' }]
  const badges: StatusBadge[] = []
  if (record.myReadAt === null) badges.push({ text: STATUS_UNREAD, tone: 'primary' })
  if (record.revisedAt) badges.push({ text: STATUS_UPDATED, tone: 'amber' })
  return badges
}

export function announcementView(record: AnnouncementRecord): AnnouncementView {
  const withdrawn = Boolean(record.withdrawnAt)
  return {
    id: record.id,
    title: record.title ?? 'Başlıksız duyuru',
    category: record.category ?? '',
    date: record.date ? dateLabel(record.date, { year: 'numeric' }) : '',
    text: withdrawn ? '' : (record.text ?? ''),
    withdrawn,
    unread: record.myReadAt === null && !withdrawn,
    badges: announcementBadges(record),
  }
}

// --- Yazışma ---------------------------------------------------------------------------------

/** Mobilde mesaj ekranı yalnız bu rollerindir; yönetici gerekçeli erişimi web'de yapar. */
export const MESSAGE_ROLES: readonly MemberRole[] = ['ogretmen', 'ogrenci', 'veli']

export function canUseMessages(role: MemberRole): boolean {
  return MESSAGE_ROLES.includes(role)
}

/** Ad çözümlemesi için başvuru kayıtları (hepsi okuyanın kapsamıyla sunucuda daraltılmıştır). */
export type PartyNames = {
  students: ReadonlyMap<string, string>
  teachers: ReadonlyMap<string, string>
  /** Öğrenci kimliği → o öğrencinin velileri (kayıt adı); veli hesabı adı değildir. */
  parentsByStudent: ReadonlyMap<string, readonly string[]>
}

export type ConversationLabel = { title: string; subtitle: string }

/**
 * Karşı tarafın etiketi. Öğretmen: öğrenci veya veli; öğrenci ve veli: öğretmen. Veli hesabı adı
 * yalnız öğrencinin tek velisi varsa bilinir; iki veli varsa "Veli" yazılır. Ad bulunamazsa genel
 * etiket gösterilir, kimlik gösterilmez.
 */
export function conversationLabel(
  conversation: Pick<ConversationSummary, 'studentId' | 'teacherId' | 'audience'>,
  role: MemberRole,
  names: PartyNames,
): ConversationLabel {
  const student = names.students.get(conversation.studentId) ?? 'Öğrenci'
  if (role === 'ogretmen') {
    if (conversation.audience === 'student')
      return { title: student, subtitle: 'Öğrenci ile yazışma' }
    const parents = names.parentsByStudent.get(conversation.studentId) ?? []
    const [only] = parents
    return {
      title: parents.length === 1 && only ? `${only} (veli)` : 'Veli',
      subtitle: `Öğrenci: ${student}`,
    }
  }
  const teacher = names.teachers.get(conversation.teacherId) ?? 'Öğretmen'
  return { title: teacher, subtitle: role === 'veli' ? `Öğrenci: ${student}` : 'Öğretmen' }
}

/** Liste önizlemesi: tek satır, uzun metin kısaltılır. */
export function messagePreview(text: string | undefined, max = 80): string {
  if (!text) return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Mesaj zamanı: bugün yalnız saat, diğer günler tarih ve saat (Europe/Istanbul). */
export function messageStamp(iso: string, now: Date = new Date()): string {
  const day = (value: Date | string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(value))
  return day(iso) === day(now) ? timeLabel(iso) : `${dateLabel(iso)} ${timeLabel(iso)}`
}

/** Okunmamış rozetinin erişilebilir adı. */
export function unreadLabel(count: number): string {
  return `${count} okunmamış mesaj`
}

/** Yanıt bekleme rozeti (yalnız öğretmende; DOM-ILT-013): süre aşıldıysa kırmızı, yoksa sarı. */
export function awaitingBadge(
  awaiting: ConversationSummary['awaitingReply'],
  role: MemberRole,
): StatusBadge | null {
  if (role !== 'ogretmen' || !awaiting) return null
  return awaiting.overdue
    ? { text: 'Yanıt süresi aştı', tone: 'red' }
    : { text: 'Yanıt bekliyor', tone: 'amber' }
}

const SENDER_LABELS: Readonly<Record<string, string>> = {
  teacher: 'Öğretmen',
  student: 'Öğrenci',
  parent: 'Veli',
}

export function senderLabel(sender: string): string {
  return SENDER_LABELS[sender] ?? 'Katılımcı'
}

/** Mesajın altındaki durum: yalnız kendi mesajında, karşı tarafın görmesine göre (DOM-ILT-024). */
export function deliveryLabel(message: { fromMe: boolean; readAt: string | null }): string | null {
  if (!message.fromMe) return null
  return message.readAt ? 'Okundu' : 'Gönderildi'
}

/**
 * Okunmamış mesajı olan yazışma açıldığında okundu yazılır; aynı okunmamış sayısı için tek kez
 * (yeni mesaj gelirse sayı değişir ve yeniden yazılır). `null` yazılacak bir şey olmadığını söyler.
 */
export function readMarkKey(
  conversationId: string,
  unreadCount: number,
  messagesLoaded: boolean,
): string | null {
  if (!messagesLoaded || unreadCount === 0) return null
  return `${conversationId}:${unreadCount}`
}

// --- Yeni yazışma ----------------------------------------------------------------------------

export const COUNTERPART_STUDENT = 'student'
export const COUNTERPART_PARENT_PREFIX = 'parent:'

export function parentCounterpart(userId: string): string {
  return `${COUNTERPART_PARENT_PREFIX}${userId}`
}

/** Seçilen karşı tarafı API gövdesine çevirir (öğretmenin başlatması). */
export function counterpartBody(counterpart: string): {
  audience: 'student' | 'parent'
  parentUserId?: string
} {
  if (counterpart.startsWith(COUNTERPART_PARENT_PREFIX))
    return {
      audience: 'parent',
      parentUserId: counterpart.slice(COUNTERPART_PARENT_PREFIX.length),
    }
  return { audience: 'student' }
}

/**
 * Yeni yazışma formu: öğretmen öğrenciyi ve muhatabı (öğrenci/veli), öğrenci ve veli öğretmeni
 * seçer. İlk mesaj zorunludur; boş yazışma açılmaz.
 */
export function newConversationSchema(role: MemberRole) {
  return z
    .object({
      studentId: z.string().min(1, 'Öğrenci seçin.'),
      teacherId: z.string(),
      counterpart: z.string(),
      text: sendMessageSchema.shape.text,
    })
    .superRefine((value, context) => {
      if (role === 'ogretmen' && value.counterpart === '')
        context.addIssue({
          code: 'custom',
          path: ['counterpart'],
          message: 'Yazışılacak kişiyi seçin.',
        })
      if (role !== 'ogretmen' && value.teacherId === '')
        context.addIssue({ code: 'custom', path: ['teacherId'], message: 'Öğretmen seçin.' })
    })
}
export type NewConversationValues = z.output<ReturnType<typeof newConversationSchema>>

/** Form değerlerini `POST /conversations` gövdesine çevirir; rolün kullanmadığı alan gönderilmez. */
export function newConversationBody(
  role: MemberRole,
  values: NewConversationValues,
): StartConversationInput {
  const base = { studentId: values.studentId, text: values.text }
  return role === 'ogretmen'
    ? { ...base, ...counterpartBody(values.counterpart) }
    : { ...base, teacherId: values.teacherId }
}

/**
 * Alan hataları: sunucu şeması Zod'dur; ilk hata alan başına döner (alan adı → Türkçe mesaj).
 * Geçerliyse `values` dolu gelir.
 */
export function validateNewConversation(
  role: MemberRole,
  input: { studentId: string; teacherId: string; counterpart: string; text: string },
):
  | { ok: true; values: NewConversationValues }
  | { ok: false; errors: Partial<Record<keyof typeof input, string>> } {
  const result = newConversationSchema(role).safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: Partial<Record<keyof typeof input, string>> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (
      (key === 'studentId' || key === 'teacherId' || key === 'counterpart' || key === 'text') &&
      errors[key] === undefined
    )
      errors[key] = issue.message
  }
  return { ok: false, errors }
}

/** Mesaj gönderme alanının doğrulaması (boş/çok uzun metin); ilk hatanın Türkçe mesajı. */
export function validateMessageText(
  text: string,
): { ok: true; text: string } | { ok: false; message: string } {
  const result = sendMessageSchema.safeParse({ text })
  if (result.success) return { ok: true, text: result.data.text }
  return { ok: false, message: result.error.issues[0]?.message ?? 'Mesaj geçersiz.' }
}
