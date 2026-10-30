// API modunda mesaj ekranlarının mobile özgü kuralları. Duyuru ve yazışma modeli (etiketler,
// rozetler, form şeması) web ile ortaktır: `@kampus/react-shared/announcement-model.ts` ve
// `conversation-model.ts`. Burada yalnız mobil platform kararı ve ekran doğrulama yardımcıları var.
import {
  newConversationSchema,
  type NewConversationValues,
} from '@kampus/react-shared/conversation-model.ts'
import { sendMessageSchema } from '@kampus/school-core/lib/communication.ts'
import type { MemberRole } from './session-state.ts'

/** Mobilde mesaj ekranı yalnız bu rollerindir; yönetici gerekçeli erişimi web'de yapar. */
export const MESSAGE_ROLES: readonly MemberRole[] = ['ogretmen', 'ogrenci', 'veli']

export function canUseMessages(role: MemberRole): boolean {
  return MESSAGE_ROLES.includes(role)
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
