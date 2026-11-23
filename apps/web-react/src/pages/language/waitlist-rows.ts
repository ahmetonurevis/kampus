// Grup bekleme sırası sekmesinin saf yardımcıları (DOM-DIL-043): sıra satırları, durum metinleri ve
// core teklif önerisinin bilgi metni. Sekme salt okurdur; sıraya alma, teklif ve kabul kayıt
// akışındadır (ON-058).
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { WaitlistStatus } from '@kampus/school-core/lib/language-groups.ts'
import type { GroupWaitlist } from '@kampus/react-shared/language-groups.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { RoleKey } from '@/lib/navigation.ts'

export const WAITLIST_STATUS_LABELS = {
  waiting: 'Sırada',
  offered: 'Teklif edildi',
  accepted: 'Kabul etti',
  expired: 'Süresi doldu',
  withdrawn: 'Çekildi',
} as const satisfies Record<WaitlistStatus, string>

const STATUS_TONES = {
  waiting: 'amber',
  offered: 'purple',
  accepted: 'green',
  expired: 'gray',
  withdrawn: 'gray',
} as const satisfies Record<WaitlistStatus, BadgeTone>
export const waitlistStatusTone = (status: WaitlistStatus): BadgeTone => STATUS_TONES[status]

/** Sekmeyi kim görür: sunucu yetkisiyle aynı (`group.waitlist`: yönetici, ön büro). */
export const canReadWaitlist = (role: RoleKey | undefined) =>
  role === 'yonetici' || role === 'onburo'

/** "2 Kas 2026 18:30" (İstanbul). */
const instantText = (value: string | null | undefined) =>
  value
    ? dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

export type WaitlistRow = {
  id: string
  /** "1." ya da sırası olmayan (teklif almış) satırda "—". */
  position: string
  person: string
  scope: string
  requested: string
  status: string
  statusKey: WaitlistStatus
  /** Açık teklifin son anı ya da core önerisi; yoksa `null`. */
  note: string | null
}

/**
 * Bekleyenler sunucunun sırasıyla (istek sırası, sonra açık teklifler). Kişi öğrenci kaydından
 * adlandırılır; kapsam dışı öğrenci "Kursiyer", aday "Aday" olarak kalır. Öneri bilgi amaçlıdır:
 * teklif önerilen satırda önerinin son anı, süresi dolmuş teklifte sonuçlandırma notu görünür.
 */
export function waitlistRows(
  waitlist: GroupWaitlist,
  studentNames: ReadonlyMap<string, string>,
): WaitlistRow[] {
  const offers = new Map(
    waitlist.suggestion.offers.map((offer) => [offer.entryId, offer.offerExpiresAt]),
  )
  const expire = new Set(waitlist.suggestion.expire)
  return waitlist.entries.map((entry) => {
    const suggested = offers.get(entry.id)
    const note = expire.has(entry.id)
      ? 'Teklif süresi doldu; sonuçlandırılmalı.'
      : suggested
        ? `Teklif önerisi: ${instantText(suggested)} tarihine kadar.`
        : entry.status === 'offered'
          ? `Teklif son günü: ${instantText(entry.offerExpiresAt)}`
          : null
    return {
      id: entry.id,
      position: entry.position === null ? '—' : `${entry.position}.`,
      person: entry.studentId
        ? (studentNames.get(entry.studentId) ?? 'Kursiyer')
        : entry.prospectId
          ? 'Aday'
          : '—',
      scope: entry.groupId === null ? 'Kurun herhangi bir grubu' : 'Bu grup',
      requested: instantText(entry.requestedAt),
      status: WAITLIST_STATUS_LABELS[entry.status],
      statusKey: entry.status,
      note,
    }
  })
}

/** Önerinin özeti: "2 kişiye teklif önerilir · 1 teklifin süresi doldu"; öneri yoksa `null`. */
export function suggestionSummary(waitlist: GroupWaitlist): string | null {
  const parts: string[] = []
  const offers = waitlist.suggestion.offers.length
  const expired = waitlist.suggestion.expire.length
  if (offers > 0) parts.push(`Boş yer için ${offers} kişiye 48 saatlik teklif önerilir`)
  if (expired > 0) parts.push(`${expired} teklifin süresi doldu`)
  return parts.length > 0 ? parts.join(' · ') : null
}
