import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { JobOfferStatus } from './finance-staff-onboarding.ts'

/**
 * Yeni öğretmen mentorluğu (docs/domain/finans.md DOM-FIN-136; ON-219). Yönetici kurumun yeni
 * öğretmenini deneyimli bir mentorla eşleştirir (K-463): ikisi de kurum üyeliğidir, aynı kişi
 * olamaz; yeni öğretmenin aynı anda tek süren eşleşmesi, mentorun en çok kurum ayarındaki kadar
 * (varsayılan 3) süren eşleşmesi olur. Eşleşme isteğe bağlı olarak yeni öğretmenin işe başlama
 * listesine (DOM-FIN-121, kabul edilmiş iş teklifi) bağlanır. Durum: sürüyor → tamamlandı ya da
 * erken sonlandı (gerekçeli); kapanan eşleşme değişmez.
 *
 * Görüşme kaydı (K-464) gün, süre, konu, not ve sonraki adımdır; yalnız süren eşleşmeye eklenir.
 * Kontrol listesi (K-465) kurum ayarındaki maddelerin eşleşme açılırken kopyasıdır; madde
 * tamamlanır ya da geri alınır, kim ve ne zaman saklanır. Takip: son görüşmeden (yoksa
 * başlangıçtan) bu yana 30 günü aşan süren eşleşme "görüşme gecikti" sayılır; tamamlanma oranı
 * maddelerden hesaplanır, saklanmaz. Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü)
 * ile gelir.
 */

/** Okuma ve yazma bu turda yalnız yönetici (K-465; mentor ve yeni öğretmen ekranı ayrı iştir). */
export const TEACHER_MENTORSHIP_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Mentor olabilecek roller: deneyimli öğretmen ya da yönetici (K-463). */
export const MENTOR_ROLES = ['ogretmen', 'yonetici'] as const satisfies readonly Role[]
/** Mentorluk alan rol: öğretmen (K-463). */
export const MENTEE_ROLE = 'ogretmen' as const satisfies Role

export const MENTORSHIP_STATUSES = ['active', 'completed', 'ended_early'] as const
export type MentorshipStatus = (typeof MENTORSHIP_STATUSES)[number]
export const MENTORSHIP_STATUS_LABELS = {
  active: 'Sürüyor',
  completed: 'Tamamlandı',
  ended_early: 'Erken sonlandı',
} as const satisfies Record<MentorshipStatus, string>

/** Son görüşmeden bu yana bu kadar günü aşan süren eşleşme "görüşme gecikti" sayılır (K-465). */
export const MENTORSHIP_CONTACT_GAP_DAYS = 30
/** Mentor başına aynı anda süren eşleşme sınırı: kurum ayarı (K-463). */
export const MENTOR_LOAD_DEFAULT = 3
export const MENTOR_LOAD_MIN = 1
export const MENTOR_LOAD_MAX = 10
/** Eşleşme süresi (başlangıç → planlanan bitiş) en çok bir yıl (K-463). */
export const MENTORSHIP_DURATION_MAX_DAYS = 366
export const MENTORSHIP_CHECKLIST_MAX = 20
export const CHECKLIST_LABEL_MIN = 2
export const CHECKLIST_LABEL_MAX = 120
export const MEETING_DURATION_MIN = 5
export const MEETING_DURATION_MAX = 480
export const MEETING_TOPIC_MIN = 2
export const MEETING_TOPIC_MAX = 200
export const MEETING_NOTE_MAX = 4000
export const MEETING_NEXT_STEP_MAX = 500
export const MENTORSHIP_END_REASON_MIN = 5
export const MENTORSHIP_END_REASON_MAX = 500

export interface MentorshipChecklistTemplateItem {
  label: string
  required: boolean
}

/** Kurum ayarı yazılmamışsa kontrol listesi (K-465); yönetici değiştirir. */
export const DEFAULT_MENTORSHIP_CHECKLIST = [
  { label: 'Okul kuralları ve günlük işleyişin tanıtımı', required: true },
  { label: 'Ders planı ve müfredat beklentilerinin gözden geçirilmesi', required: true },
  { label: 'Ölçme-değerlendirme ve not girişinin gösterilmesi', required: true },
  { label: 'Mentorun dersinin izlenmesi', required: true },
  { label: 'Veli iletişimi kurallarının konuşulması', required: false },
] as const satisfies readonly MentorshipChecklistTemplateItem[]

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (label: string, max: number) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

const membershipSchema = (message: string) =>
  z.string(message).trim().min(1, message).max(100, message)

const checklistItemSchema = z.strictObject({
  label: z
    .string('Maddeyi yazın.')
    .trim()
    .min(CHECKLIST_LABEL_MIN, `Madde en az ${String(CHECKLIST_LABEL_MIN)} karakter olmalıdır.`)
    .max(CHECKLIST_LABEL_MAX, `Madde en çok ${String(CHECKLIST_LABEL_MAX)} karakter olabilir.`)
    .describe('Madde (2–120)'),
  required: z
    .boolean('Zorunlu olup olmadığını seçin.')
    .describe('Eşleşmenin tamamlanması için şart mı'),
})

/** Kurum ayarı (K-463, K-465): mentor sınırı ve kontrol listesi bütünüyle yazılır. */
export const mentorshipSettingsSchema = z.strictObject({
  maxActivePerMentor: z
    .number('Mentor başına sınırı girin.')
    .int('Sınır tam sayı olmalıdır.')
    .min(MENTOR_LOAD_MIN, `Sınır en az ${String(MENTOR_LOAD_MIN)} olmalıdır.`)
    .max(MENTOR_LOAD_MAX, `Sınır en çok ${String(MENTOR_LOAD_MAX)} olabilir.`)
    .describe('Bir mentorun aynı anda süren en çok eşleşme sayısı (1–10)'),
  checklistItems: z
    .array(checklistItemSchema)
    .max(MENTORSHIP_CHECKLIST_MAX, `En çok ${String(MENTORSHIP_CHECKLIST_MAX)} madde olabilir.`)
    .superRefine((items, context) => {
      const seen = new Set<string>()
      items.forEach((item, index) => {
        const key = item.label.toLocaleLowerCase('tr-TR')
        if (seen.has(key))
          context.addIssue({
            code: 'custom',
            path: [index, 'label'],
            message: 'Aynı madde iki kez yazılamaz.',
          })
        seen.add(key)
      })
    })
    .describe('Yeni eşleşmelere kopyalanan kontrol listesi maddeleri, sırasıyla (en çok 20)'),
})
export type MentorshipSettingsFields = z.output<typeof mentorshipSettingsSchema>

export const mentorshipCreateSchema = z.strictObject({
  // kvkk: K (mentor üyeliği)
  mentorMembershipId: membershipSchema('Mentoru seçin.').describe(
    'Mentorun kurum üyeliği (etkin öğretmen ya da yönetici)',
  ),
  // kvkk: K (yeni öğretmen üyeliği)
  menteeMembershipId: membershipSchema('Yeni öğretmeni seçin.').describe(
    'Yeni öğretmenin kurum üyeliği (etkin öğretmen)',
  ),
  startDate: daySchema.describe('Eşleşmenin başlangıç günü'),
  endDate: daySchema.describe('Planlanan bitiş günü; başlangıçtan sonra, en çok 366 gün'),
  onboardingOfferId: z
    .uuid('İşe başlama listesi geçersiz.')
    .nullable()
    .default(null)
    .describe(
      'İsteğe bağlı işe başlama listesi (kabul edilmiş iş teklifi, DOM-FIN-121); hesabı yeni öğretmen olmalı',
    ),
})
export type MentorshipCreateInput = z.input<typeof mentorshipCreateSchema>
export type MentorshipCreateFields = z.output<typeof mentorshipCreateSchema>

export const mentorshipMeetingSchema = z.strictObject({
  meetingDate: daySchema.describe('Görüşme günü; başlangıçtan önce ve bugünden sonra olamaz'),
  durationMinutes: z
    .number('Süreyi girin.')
    .int('Süre tam dakika olmalıdır.')
    .min(MEETING_DURATION_MIN, `Süre en az ${String(MEETING_DURATION_MIN)} dakika olmalıdır.`)
    .max(MEETING_DURATION_MAX, `Süre en çok ${String(MEETING_DURATION_MAX)} dakika olabilir.`)
    .describe('Süre, dakika (5–480)'),
  topic: z
    .string('Konuyu yazın.')
    .trim()
    .min(MEETING_TOPIC_MIN, `Konu en az ${String(MEETING_TOPIC_MIN)} karakter olmalıdır.`)
    .max(MEETING_TOPIC_MAX, `Konu en çok ${String(MEETING_TOPIC_MAX)} karakter olabilir.`)
    .describe('Konu (2–200)'),
  // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
  note: optionalText('Not', MEETING_NOTE_MAX).describe('İsteğe bağlı görüşme notu (en çok 4000)'),
  // kvkk: K (serbest metin; denetime yazılmaz)
  nextStep: optionalText('Sonraki adım', MEETING_NEXT_STEP_MAX).describe(
    'İsteğe bağlı sonraki adım (en çok 500)',
  ),
})
export type MentorshipMeetingInput = z.input<typeof mentorshipMeetingSchema>
export type MentorshipMeetingFields = z.output<typeof mentorshipMeetingSchema>

export const mentorshipCompleteSchema = z.strictObject({
  closedOn: daySchema.describe('Tamamlanma günü; başlangıçtan önce ve bugünden sonra olamaz'),
})

export const mentorshipEndSchema = z.strictObject({
  closedOn: daySchema.describe('Sonlanma günü; başlangıçtan önce ve bugünden sonra olamaz'),
  // kvkk: K (serbest metin; denetime yazılmaz)
  reason: z
    .string('Gerekçeyi yazın.')
    .trim()
    .min(
      MENTORSHIP_END_REASON_MIN,
      `Gerekçe en az ${String(MENTORSHIP_END_REASON_MIN)} karakter olmalıdır.`,
    )
    .max(
      MENTORSHIP_END_REASON_MAX,
      `Gerekçe en çok ${String(MENTORSHIP_END_REASON_MAX)} karakter olabilir.`,
    )
    .describe('Erken sonlanma gerekçesi (5–500); denetime yazılmaz'),
})
export type MentorshipEndFields = z.output<typeof mentorshipEndSchema>

/** Gövdesiz komutlar (madde işaretleme, görüşme arşivi) boş nesne alır. */
export const mentorshipEmptySchema = z.strictObject({})

// --- Takvim --------------------------------------------------------------------------------------

const DAY_MS = 86_400_000
/** İki takvim günü arasındaki gün farkı (`to − from`). */
export const mentorshipDaysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS)
/** Takvim gününe gün ekler ya da çıkarır. */
export const mentorshipAddDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Kurumdaki üyelik; kurumda yoksa `null`. `active` pasifleştirilmemiş demektir. */
export interface MentorshipMember {
  membershipId: string
  role: string
  active: boolean
}

/** Bağlanacak işe başlama listesi: `undefined` istenmedi, `null` kurumda yok. */
export type MentorshipOnboardingCheck =
  { status: JobOfferStatus; membershipId: string | null } | null | undefined

export interface MentorshipChecks {
  mentor: MentorshipMember | null
  mentee: MentorshipMember | null
  /** Yeni öğretmenin süren başka eşleşmesi var mı. */
  menteeHasActive: boolean
  /** Mentorun süren eşleşme sayısı. */
  mentorActiveCount: number
  maxActivePerMentor: number
  onboarding: MentorshipOnboardingCheck
  checklist: readonly MentorshipChecklistTemplateItem[]
}

/**
 * Yeni eşleşme (K-463). Mentor kurumun etkin öğretmeni ya da yöneticisi, yeni öğretmen etkin
 * öğretmen ve ikisi ayrı kişi; bitiş başlangıçtan sonra ve süre en çok 366 gün. Yeni öğretmenin
 * süren başka eşleşmesi varsa 409; mentor sınırı doluysa 422. İşe başlama listesi verilirse kabul
 * edilmiş (geri çekilmemiş) teklif olmalı ve bağlı hesabı yeni öğretmen olmalı. Dönen liste kurum
 * ayarındaki maddelerin kopyasıdır (K-465).
 */
export function planMentorship(
  input: MentorshipCreateFields,
  checks: MentorshipChecks,
): MentorshipChecklistTemplateItem[] {
  const { mentor, mentee } = checks
  if (mentor === null)
    throw ruleError('mentorship_mentor_not_found', 'Mentor bulunamadı.', 'mentorMembershipId')
  if (!(MENTOR_ROLES as readonly string[]).includes(mentor.role) || !mentor.active)
    throw ruleError(
      'mentorship_mentor_invalid',
      'Mentor kurumun etkin öğretmeni ya da yöneticisi olmalı.',
      'mentorMembershipId',
    )
  if (mentee === null)
    throw ruleError(
      'mentorship_mentee_not_found',
      'Yeni öğretmen bulunamadı.',
      'menteeMembershipId',
    )
  if (mentee.role !== MENTEE_ROLE)
    throw ruleError(
      'mentorship_mentee_not_teacher',
      'Mentorluk yalnız öğretmene verilir.',
      'menteeMembershipId',
    )
  if (!mentee.active)
    throw ruleError(
      'mentorship_mentee_inactive',
      'Ayrılan (pasifleştirilmiş) öğretmene mentor atanmaz.',
      'menteeMembershipId',
    )
  if (mentor.membershipId === mentee.membershipId)
    throw ruleError(
      'mentorship_self',
      'Öğretmen kendi kendisinin mentoru olamaz.',
      'mentorMembershipId',
    )
  if (input.endDate <= input.startDate)
    throw ruleError(
      'mentorship_dates_invalid',
      'Bitiş günü başlangıç gününden sonra olmalı.',
      'endDate',
    )
  if (mentorshipDaysBetween(input.startDate, input.endDate) > MENTORSHIP_DURATION_MAX_DAYS)
    throw ruleError(
      'mentorship_too_long',
      `Eşleşme en çok ${String(MENTORSHIP_DURATION_MAX_DAYS)} gün sürebilir.`,
      'endDate',
    )
  if (checks.onboarding === null)
    throw ruleError(
      'mentorship_onboarding_not_found',
      'İşe başlama listesi bulunamadı.',
      'onboardingOfferId',
    )
  if (
    checks.onboarding !== undefined &&
    (checks.onboarding.status !== 'accepted' ||
      checks.onboarding.membershipId !== mentee.membershipId)
  )
    throw ruleError(
      'mentorship_onboarding_mismatch',
      'İşe başlama listesi bu öğretmenin kabul edilmiş, hesabı bağlı teklifi olmalı.',
      'onboardingOfferId',
    )
  if (checks.menteeHasActive)
    throw conflict(
      'mentorship_mentee_has_active',
      'Bu öğretmenin süren bir mentorluk eşleşmesi var; önce onu kapatın.',
    )
  if (checks.mentorActiveCount >= checks.maxActivePerMentor)
    throw ruleError(
      'mentorship_mentor_limit',
      `Bir mentorun aynı anda en çok ${String(checks.maxActivePerMentor)} süren eşleşmesi olabilir.`,
      'mentorMembershipId',
    )
  return checks.checklist.map((item) => ({ label: item.label, required: item.required }))
}

const closedError = () => conflict('mentorship_closed', 'Eşleşme sona erdi; artık değiştirilemez.')

function assertActive(mentorship: { status: MentorshipStatus }) {
  if (mentorship.status !== 'active') throw closedError()
}

/**
 * Görüşme kaydı (K-464): yalnız süren eşleşmeye eklenir (tamamlanan ya da erken sonlanan 409
 * `mentorship_closed`). Gün başlangıçtan önce ve bugünden sonra olamaz.
 */
export function planMentorshipMeeting(
  mentorship: { status: MentorshipStatus; startDate: string },
  input: Pick<MentorshipMeetingFields, 'meetingDate'>,
  today: string,
): void {
  assertActive(mentorship)
  if (input.meetingDate > today)
    throw ruleError(
      'mentorship_meeting_date_future',
      'Görüşme günü bugünden sonra olamaz.',
      'meetingDate',
    )
  if (input.meetingDate < mentorship.startDate)
    throw ruleError(
      'mentorship_meeting_before_start',
      'Görüşme günü eşleşmenin başlangıcından önce olamaz.',
      'meetingDate',
    )
}

/** Yanlış girilmiş görüşmenin arşivi (K-464): yalnız süren eşleşmede. */
export function planMentorshipMeetingArchive(mentorship: { status: MentorshipStatus }): void {
  assertActive(mentorship)
}

export interface MentorshipChecklistItemState {
  required: boolean
  completedAt: string | null
}

/** Maddeyi tamamla (K-465): süren eşleşmede, işaretsiz maddede. */
export function planChecklistItemComplete(
  mentorship: { status: MentorshipStatus },
  item: Pick<MentorshipChecklistItemState, 'completedAt'>,
): void {
  assertActive(mentorship)
  if (item.completedAt !== null)
    throw ruleError('mentorship_item_completed', 'Madde zaten tamamlandı.', 'completedAt')
}

/** İşareti geri al (K-465): süren eşleşmede, işaretli maddede. */
export function planChecklistItemReopen(
  mentorship: { status: MentorshipStatus },
  item: Pick<MentorshipChecklistItemState, 'completedAt'>,
): void {
  assertActive(mentorship)
  if (item.completedAt === null)
    throw ruleError('mentorship_item_not_completed', 'Madde tamamlanmamış.', 'completedAt')
}

function assertCloseDay(mentorship: { startDate: string }, closedOn: string, today: string) {
  if (closedOn > today)
    throw ruleError('mentorship_close_date_future', 'Gün bugünden sonra olamaz.', 'closedOn')
  if (closedOn < mentorship.startDate)
    throw ruleError(
      'mentorship_close_before_start',
      'Gün eşleşmenin başlangıcından önce olamaz.',
      'closedOn',
    )
}

/**
 * Tamamlama (K-463, K-465): süren eşleşmede; gün başlangıçla bugün arasında; en az bir görüşme
 * kaydı (422 `mentorship_no_meetings`) ve zorunlu maddelerin hepsi tamamlanmış (422
 * `mentorship_checklist_incomplete`) olmalı. Tamamlanan eşleşme değişmez.
 */
export function planMentorshipComplete(
  mentorship: { status: MentorshipStatus; startDate: string },
  facts: { meetingCount: number; items: readonly MentorshipChecklistItemState[] },
  closedOn: string,
  today: string,
): void {
  assertActive(mentorship)
  assertCloseDay(mentorship, closedOn, today)
  // Gün alanının değil eşleşmenin eksiği: yolsuz hata (formda alan altında değil, bildirimde).
  if (facts.meetingCount === 0)
    throw new DomainError(
      'mentorship_no_meetings',
      'Görüşme kaydı olmayan eşleşme tamamlanmaz; önce görüşmeyi kaydedin.',
      { kind: 'rule' },
    )
  const missing = facts.items.filter((item) => item.required && item.completedAt === null).length
  if (missing > 0)
    throw new DomainError(
      'mentorship_checklist_incomplete',
      `Tamamlanmamış ${String(missing)} zorunlu madde var; önce maddeleri tamamlayın.`,
      { kind: 'rule' },
    )
}

/** Erken sonlandırma (K-463): süren eşleşmede; gün başlangıçla bugün arasında; gerekçe zorunlu. */
export function planMentorshipEnd(
  mentorship: { status: MentorshipStatus; startDate: string },
  closedOn: string,
  today: string,
): void {
  assertActive(mentorship)
  assertCloseDay(mentorship, closedOn, today)
}

// --- Takip ---------------------------------------------------------------------------------------

export interface ChecklistProgress {
  total: number
  done: number
  requiredTotal: number
  requiredDone: number
  /** Tamamlanan madde / toplam madde, yüzde (tam sayı); madde yoksa `null`. */
  percent: number | null
}

/** Kontrol listesi ilerlemesi (K-465); saklanmaz. */
export function checklistProgress(
  items: readonly MentorshipChecklistItemState[],
): ChecklistProgress {
  const done = items.filter((item) => item.completedAt !== null).length
  const required = items.filter((item) => item.required)
  return {
    total: items.length,
    done,
    requiredTotal: required.length,
    requiredDone: required.filter((item) => item.completedAt !== null).length,
    percent: items.length === 0 ? null : Math.round((done * 100) / items.length),
  }
}

export interface MentorshipContact {
  /** Son görüşme günü; görüşme yoksa `null`. */
  lastMeetingDate: string | null
  /** Süren eşleşmede son görüşmeden (yoksa başlangıçtan) bu yana gün; kapanmışsa `null`. */
  daysSinceContact: number | null
  /** Süren eşleşmede 30 günü aşan görüşmesizlik (K-465). */
  overdue: boolean
}

/**
 * Görüşme takibi (K-465): süren eşleşmede son görüşme (yoksa başlangıç) gününden bugüne geçen
 * gün; 30'u aşarsa gecikti. Henüz başlamamış eşleşme gecikmez (gün 0). Kapanan eşleşme izlenmez.
 */
export function mentorshipContact(
  mentorship: { status: MentorshipStatus; startDate: string },
  lastMeetingDate: string | null,
  today: string,
): MentorshipContact {
  if (mentorship.status !== 'active')
    return { lastMeetingDate, daysSinceContact: null, overdue: false }
  const since = lastMeetingDate ?? mentorship.startDate
  const days = Math.max(0, mentorshipDaysBetween(since, today))
  return { lastMeetingDate, daysSinceContact: days, overdue: days > MENTORSHIP_CONTACT_GAP_DAYS }
}

/**
 * Gecikme sınırı: son temas günü bu günden önceyse (yani bugünden 30 günden eski) gecikmiştir.
 * Sunucu listesi SQL süzgecinde aynı sınırı kullanır.
 */
export const mentorshipOverdueBefore = (today: string) =>
  mentorshipAddDays(today, -MENTORSHIP_CONTACT_GAP_DAYS)

export interface MentorshipSummary {
  active: number
  overdue: number
  completed: number
  endedEarly: number
  /** Süren eşleşmelerin bütün maddelerinde tamamlanma oranı, yüzde; madde yoksa `null`. */
  activeChecklistPercent: number | null
}

/** Kurum özeti (K-465): durum sayıları, geciken görüşme ve süren listelerin tamamlanma oranı. */
export function mentorshipSummary(
  rows: readonly {
    status: MentorshipStatus
    overdue: boolean
    checklist: Pick<ChecklistProgress, 'total' | 'done'>
  }[],
): MentorshipSummary {
  const active = rows.filter((row) => row.status === 'active')
  const total = active.reduce((sum, row) => sum + row.checklist.total, 0)
  const done = active.reduce((sum, row) => sum + row.checklist.done, 0)
  return {
    active: active.length,
    overdue: active.filter((row) => row.overdue).length,
    completed: rows.filter((row) => row.status === 'completed').length,
    endedEarly: rows.filter((row) => row.status === 'ended_early').length,
    activeChecklistPercent: total === 0 ? null : Math.round((done * 100) / total),
  }
}
