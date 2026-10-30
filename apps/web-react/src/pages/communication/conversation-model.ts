// Mesaj ekranının saf hesapları (docs/domain/iletisim-ve-veli.md DOM-ILT-010…014, -024). Yazışma
// satırı yalnız kimlik taşır (öğrenci, öğretmen, veli hesabı); karşı tarafın adı başvuru
// koleksiyonlarından kurulur. Ad bulunamazsa genel etiket gösterilir, kimlik gösterilmez.
import { z } from 'zod'
import type {
  ConversationSummary,
  StartConversationInput,
} from '@kampus/react-shared/use-communication.ts'
import { sendMessageSchema } from '@kampus/school-core/lib/communication.ts'
import { timeLabel, dateLabel } from '@kampus/school-core/lib/format.ts'
import type { RoleKey } from '@/lib/navigation.ts'

/** Ad çözümlemesi için başvuru kayıtları (hepsi okuyanın kapsamıyla sunucuda daraltılmıştır). */
export type PartyNames = {
  students: ReadonlyMap<string, string>
  teachers: ReadonlyMap<string, string>
  /** Öğrenci kimliği → o öğrencinin velileri (kayıt adı); veli hesabı adı değildir. */
  parentsByStudent: ReadonlyMap<string, readonly string[]>
}

export type ConversationLabel = {
  /** Satır başlığı: karşı taraf. */
  title: string
  /** Satır alt başlığı: bağlı öğrenci ve (yöneticide) taraflar. */
  subtitle: string
}

/**
 * Karşı tarafın etiketi. Öğretmen: öğrenci veya veli; öğrenci ve veli: öğretmen; yönetici:
 * öğrenci–öğretmen çifti. Veli yazışmasında hesap adı yalnız öğrencinin tek velisi varsa bilinir;
 * iki veli varsa "Veli" yazılır (hesap adı listede yoktur).
 */
export function conversationLabel(
  conversation: Pick<ConversationSummary, 'studentId' | 'teacherId' | 'audience'>,
  role: RoleKey,
  names: PartyNames,
): ConversationLabel {
  const student = names.students.get(conversation.studentId) ?? 'Öğrenci'
  const teacher = names.teachers.get(conversation.teacherId) ?? 'Öğretmen'
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
  if (role === 'yonetici') return { title: `${teacher} ↔ ${student}`, subtitle: 'Öğrenci–öğretmen' }
  return { title: teacher, subtitle: role === 'veli' ? `Öğrenci: ${student}` : 'Öğretmen' }
}

/** Liste önizlemesi: tek satır, uzun metin kısaltılır; yöneticide son mesaj yoktur. */
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

/** Okunmamış rozetinin erişilebilir adı ("3 okunmamış mesaj"). */
export function unreadLabel(count: number): string {
  return `${count} okunmamış mesaj`
}

/** Yanıt bekleme rozeti: süre aşıldıysa kırmızı, yoksa sakin sarı (DOM-ILT-013). */
export function awaitingLabel(awaiting: ConversationSummary['awaitingReply']): {
  text: string
  tone: 'amber' | 'red'
} | null {
  if (!awaiting) return null
  return awaiting.overdue
    ? { text: 'Yanıt süresi aştı', tone: 'red' }
    : { text: 'Yanıt bekliyor', tone: 'amber' }
}

/** Kalan erişim süresi `dd:ss` (dakika:saniye); bitmişse `00:00`. */
export function remainingLabel(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Yazışma başlatabilen roller (yönetici ve ön büro başlatmaz; core `WRITE_ACTION_ROLES`). */
export const STARTER_ROLES: readonly RoleKey[] = ['ogretmen', 'ogrenci', 'veli']

export function canStartConversation(role: RoleKey): boolean {
  return STARTER_ROLES.includes(role)
}

/** Yazışma listesini okuyabilen roller (ön büro taraf olamaz). */
export function canListConversations(role: RoleKey): boolean {
  return role !== 'onburo'
}

/** Yöneticide içerik kapalıdır; gerekçeli erişim gerekir (DOM-YTK-052). */
export function contentLocked(role: RoleKey, accessActive: boolean): boolean {
  return role === 'yonetici' && !accessActive
}

/** Karşı taraf seçimi değeri: öğrenci ya da belirli bir veli hesabı. */
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
 * Gerekçeli erişim yalnız öğrenci–öğretmen yazışmasında açılır (DOM-YTK-052); veli yazışması
 * yönetici erişimine kapalıdır, bu yüzden "Gerekçeyle aç" yalnız burada gösterilir.
 */
export function canOpenAccess(conversation: Pick<ConversationSummary, 'audience'>): boolean {
  return conversation.audience === 'student'
}

const SENDER_LABELS: Readonly<Record<string, string>> = {
  teacher: 'Öğretmen',
  student: 'Öğrenci',
  parent: 'Veli',
}

/** Mesajın gönderen etiketi (yönetici görünümünde iki taraf da karşı taraftır). */
export function senderLabel(sender: string): string {
  return SENDER_LABELS[sender] ?? 'Katılımcı'
}

/** Mesajın altındaki durum: yalnız kendi mesajında, karşı tarafın görmesine göre (DOM-ILT-024). */
export function deliveryLabel(message: { fromMe: boolean; readAt: string | null }): string | null {
  if (!message.fromMe) return null
  return message.readAt ? 'Okundu' : 'Gönderildi'
}

/**
 * Yeni yazışma formu: öğretmen öğrenciyi ve muhatabı (öğrenci/veli), öğrenci ve veli öğretmeni
 * seçer. Alan şekli API gövdesinden ayrıdır (`newConversationBody` çevirir); ilk mesaj zorunludur,
 * boş yazışma açılmaz.
 */
export function newConversationSchema(role: RoleKey) {
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
  role: RoleKey,
  values: NewConversationValues,
): StartConversationInput {
  const base = { studentId: values.studentId, text: values.text }
  return role === 'ogretmen'
    ? { ...base, ...counterpartBody(values.counterpart) }
    : { ...base, teacherId: values.teacherId }
}
