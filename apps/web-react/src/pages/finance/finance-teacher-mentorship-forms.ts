// Yeni öğretmen mentorluğu formları ve gösterimi (DOM-FIN-136; ON-219). Formlar düz nesnedir;
// süre formda metin, gövdede dakikadır. Sınırlar ve mesajlar core şemalarındandır; takip
// (son görüşme, 30 gün, tamamlanma oranı) sunucunun hesabıdır, burada yalnız metne çevrilir.
import { z } from 'zod'
import type {
  CreateMentorshipBody,
  MentorshipMeetingBody,
  MentorshipRow,
  MentorshipSettingsBody,
} from '@kampus/react-shared/use-finance-teacher-mentorships.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  CHECKLIST_LABEL_MAX,
  MEETING_DURATION_MAX,
  MEETING_DURATION_MIN,
  MEETING_NEXT_STEP_MAX,
  MEETING_NOTE_MAX,
  MEETING_TOPIC_MAX,
  MENTOR_LOAD_MAX,
  MENTOR_LOAD_MIN,
  MENTORSHIP_CHECKLIST_MAX,
  MENTORSHIP_CONTACT_GAP_DAYS,
  MENTORSHIP_END_REASON_MAX,
  MENTORSHIP_END_REASON_MIN,
  mentorshipAddDays,
  type MentorshipStatus,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/** Gün gösterimi: "2 Kas 2026". */
export const dayText = (day: string | null) =>
  day === null ? '—' : dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** An gösterimi (madde işareti): "2 Kas 2026 12:30". */
export const momentText = (at: string) =>
  dateLabel(at, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const STATUS_TONES = {
  active: 'amber',
  completed: 'green',
  ended_early: 'gray',
} as const satisfies Record<MentorshipStatus, string>

type Contact = Pick<MentorshipRow, 'status' | 'lastMeetingDate' | 'daysSinceContact' | 'overdue'>

/** Takip metni (K-465): son görüşme ve süren eşleşmede geçen gün. */
export function contactText(row: Contact): string {
  const last =
    row.lastMeetingDate === null ? 'Görüşme yok' : `Son görüşme ${dayText(row.lastMeetingDate)}`
  if (row.status !== 'active' || row.daysSinceContact === null) return last
  if (row.daysSinceContact === 0) return last
  return `${last} · ${String(row.daysSinceContact)} gün`
}

/** Gecikme uyarısı metni; gecikmemişse `null`. */
export const overdueText = (row: Pick<MentorshipRow, 'overdue'>) =>
  row.overdue ? `${String(MENTORSHIP_CONTACT_GAP_DAYS)} günü aştı` : null

/** Kontrol listesi ilerlemesi: "3/5 madde · %60". */
export function progressText(checklist: MentorshipRow['checklist']): string {
  if (checklist.total === 0) return 'Madde yok'
  return `${String(checklist.done)}/${String(checklist.total)} madde · %${String(checklist.percent ?? 0)}`
}

// --- Eşleşme formu -------------------------------------------------------------------------------

export const mentorshipFormSchema = z
  .object({
    mentorMembershipId: z.string().min(1, 'Mentoru seçin.'),
    menteeMembershipId: z.string().min(1, 'Yeni öğretmeni seçin.'),
    startDate: daySchema,
    endDate: daySchema,
    onboardingOfferId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.mentorMembershipId !== '' && value.mentorMembershipId === value.menteeMembershipId)
      context.addIssue({
        code: 'custom',
        path: ['menteeMembershipId'],
        message: 'Öğretmen kendi kendisinin mentoru olamaz.',
      })
    if (value.endDate <= value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden sonra olmalı.',
      })
  })
export type MentorshipFormValues = z.infer<typeof mentorshipFormSchema>

/** Varsayılan: bugün başlar, 180 gün sürer (yönetici değiştirir). */
export const mentorshipDefaults = (today: string): MentorshipFormValues => ({
  mentorMembershipId: '',
  menteeMembershipId: '',
  startDate: today,
  endDate: mentorshipAddDays(today, 180),
  onboardingOfferId: '',
})

export const mentorshipBody = (values: MentorshipFormValues): CreateMentorshipBody => ({
  mentorMembershipId: values.mentorMembershipId,
  menteeMembershipId: values.menteeMembershipId,
  startDate: values.startDate,
  endDate: values.endDate,
  onboardingOfferId: values.onboardingOfferId === '' ? null : values.onboardingOfferId,
})

const MENTORSHIP_FIELDS = new Set<string>([
  'mentorMembershipId',
  'menteeMembershipId',
  'startDate',
  'endDate',
  'onboardingOfferId',
])
export const mentorshipFormField = (path: string) =>
  MENTORSHIP_FIELDS.has(path) ? (path as keyof MentorshipFormValues) : undefined

/** Yeni öğretmene bağlanabilecek işe başlama listeleri: hesabı ona bağlı kabul edilmiş teklif. */
export function onboardingOptions<T extends { membershipId: string }>(
  options: readonly T[],
  menteeMembershipId: string,
): T[] {
  if (menteeMembershipId === '') return []
  return options.filter((option) => option.membershipId === menteeMembershipId)
}

// --- Görüşme formu -------------------------------------------------------------------------------

const DURATION_PATTERN = /^\d{1,3}$/

export const meetingFormSchema = z.object({
  meetingDate: daySchema,
  duration: z
    .string()
    .trim()
    .refine(
      (value) =>
        DURATION_PATTERN.test(value) &&
        Number(value) >= MEETING_DURATION_MIN &&
        Number(value) <= MEETING_DURATION_MAX,
      `Süreyi ${String(MEETING_DURATION_MIN)}–${String(MEETING_DURATION_MAX)} dakika arasında tam sayı girin.`,
    ),
  topic: z
    .string()
    .trim()
    .min(2, 'Konuyu yazın.')
    .max(MEETING_TOPIC_MAX, `Konu en çok ${String(MEETING_TOPIC_MAX)} karakter olabilir.`),
  note: z
    .string()
    .max(
      MEETING_NOTE_MAX,
      `Not en çok ${MEETING_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
    ),
  nextStep: z
    .string()
    .max(
      MEETING_NEXT_STEP_MAX,
      `Sonraki adım en çok ${String(MEETING_NEXT_STEP_MAX)} karakter olabilir.`,
    ),
})
export type MeetingFormValues = z.infer<typeof meetingFormSchema>

export const meetingDefaults = (today: string): MeetingFormValues => ({
  meetingDate: today,
  duration: '45',
  topic: '',
  note: '',
  nextStep: '',
})

export const meetingBody = (values: MeetingFormValues): MentorshipMeetingBody => ({
  meetingDate: values.meetingDate,
  durationMinutes: Number(values.duration.trim()),
  topic: values.topic.trim(),
  note: values.note.trim() === '' ? null : values.note.trim(),
  nextStep: values.nextStep.trim() === '' ? null : values.nextStep.trim(),
})

const MEETING_FIELDS: Readonly<Record<string, keyof MeetingFormValues>> = {
  meetingDate: 'meetingDate',
  durationMinutes: 'duration',
  topic: 'topic',
  note: 'note',
  nextStep: 'nextStep',
}
export const meetingFormField = (path: string): keyof MeetingFormValues | undefined =>
  MEETING_FIELDS[path]

// --- Kapanış ---------------------------------------------------------------------------------------

/** Erken sonlandırma gerekçesi; tamamlamada gerekçe yoktur (`null`). */
export function closeReasonError(kind: 'complete' | 'end', reason: string): string | null {
  if (kind === 'complete') return null
  const length = reason.trim().length
  if (length < MENTORSHIP_END_REASON_MIN)
    return `Gerekçe en az ${String(MENTORSHIP_END_REASON_MIN)} karakter olmalıdır.`
  if (length > MENTORSHIP_END_REASON_MAX)
    return `Gerekçe en çok ${String(MENTORSHIP_END_REASON_MAX)} karakter olabilir.`
  return null
}

// --- Ayar ------------------------------------------------------------------------------------------

export interface SettingsFormValues {
  maxActivePerMentor: string
  items: { label: string; required: boolean }[]
}

/**
 * Ayar gövdesi: boş satırlar atılır. Sınır ya da madde geçersizse hata metni döner (sunucu
 * aynı kuralı yeniden denetler).
 */
export function settingsBody(
  values: SettingsFormValues,
): { body: MentorshipSettingsBody } | { error: string } {
  const load = values.maxActivePerMentor.trim()
  if (!/^\d{1,2}$/.test(load) || Number(load) < MENTOR_LOAD_MIN || Number(load) > MENTOR_LOAD_MAX)
    return {
      error: `Mentor başına sınırı ${String(MENTOR_LOAD_MIN)}–${String(MENTOR_LOAD_MAX)} arasında girin.`,
    }
  const items = values.items
    .map((item) => ({ label: item.label.trim(), required: item.required }))
    .filter((item) => item.label !== '')
  if (items.length > MENTORSHIP_CHECKLIST_MAX)
    return { error: `En çok ${String(MENTORSHIP_CHECKLIST_MAX)} madde olabilir.` }
  if (items.some((item) => item.label.length < 2 || item.label.length > CHECKLIST_LABEL_MAX))
    return { error: `Her madde 2–${String(CHECKLIST_LABEL_MAX)} karakter olmalıdır.` }
  const keys = items.map((item) => item.label.toLocaleLowerCase('tr-TR'))
  if (new Set(keys).size !== keys.length) return { error: 'Aynı madde iki kez yazılamaz.' }
  return { body: { maxActivePerMentor: Number(load), checklistItems: items } }
}
