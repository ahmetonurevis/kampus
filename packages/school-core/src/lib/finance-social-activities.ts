import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { MemberCheck } from './finance-transport.ts'

/**
 * Lise sosyal etkinlik ve gönüllülük saatleri (docs/domain/finans.md DOM-FIN-160; ON-170;
 * DOM-AKD-021; K-535…K-537; H-115). Yalnız `school` türü kurumda ve 9–12. sınıf öğrencilerinde
 * çalışır. Etkinlik kulüp/topluluk çalışması ya da gönüllülük faaliyetidir; saat öğrenci × etkinlik
 * × gün başına bir kayıttır. Sorumlu öğretmen ya da yönetici girdiği saat onaylı açılır, öğrenci
 * beyanı onay bekler; öğretmen onaylar ya da gerekçeyle reddeder. Onaylı saat değişmez, düzeltme
 * gerekçeli ters kayıttır. Özet ve belge yalnız onaylı (net) saati sayar.
 *
 * Hedef ortaöğrenim boyunca 40 saattir (OKY md. 50/8); yıllık hedef mevzuatta yoktur, kurum
 * ayarıdır (öneri 10). Özürsüz devamsızlığın süreye eklenmesi ve meslekî program hedefi (20)
 * uygulanmaz (H-115). Fonksiyonlar saftır.
 */

/** Etkinlik ve saat girişi: yönetici bütün etkinliklerde, öğretmen sorumlu olduğu etkinlikte. */
export const SOCIAL_ACTIVITY_STAFF_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]
/** Hedef ayarı yalnız yöneticide. */
export const SOCIAL_ACTIVITY_SETTINGS_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kendi (çocuğunun) saatlerini okuyan roller; kapsam sunucuda daralır. */
export const SOCIAL_ACTIVITY_FAMILY_ROLES = ['ogrenci', 'veli'] as const satisfies readonly Role[]
/** Beyan yalnız öğrencinin kendisinden. */
export const SOCIAL_ACTIVITY_DECLARE_ROLES = ['ogrenci'] as const satisfies readonly Role[]

/** Sorumlu kişi olabilen roller (K-535). */
export const SOCIAL_ACTIVITY_RESPONSIBLE_ROLES = ['ogretmen', 'yonetici'] as const

export const HIGH_SCHOOL_GRADES = [9, 10, 11, 12] as const
export const isHighSchoolGrade = (grade: number | null | undefined): boolean =>
  typeof grade === 'number' && grade >= 9 && grade <= 12

export const SOCIAL_ACTIVITY_KINDS = ['club', 'volunteering'] as const
export type SocialActivityKind = (typeof SOCIAL_ACTIVITY_KINDS)[number]
export const SOCIAL_ACTIVITY_KIND_LABELS = {
  club: 'Kulüp / topluluk çalışması',
  volunteering: 'Gönüllülük / toplum hizmeti',
} as const satisfies Record<SocialActivityKind, string>

export const SOCIAL_ACTIVITY_SCOPES = ['internal', 'external'] as const
export type SocialActivityScope = (typeof SOCIAL_ACTIVITY_SCOPES)[number]
export const SOCIAL_ACTIVITY_SCOPE_LABELS = {
  internal: 'Kurum içi',
  external: 'Kurum dışı',
} as const satisfies Record<SocialActivityScope, string>

export const SOCIAL_HOUR_STATUSES = ['pending', 'approved', 'rejected'] as const
export type SocialHourStatus = (typeof SOCIAL_HOUR_STATUSES)[number]
export const SOCIAL_HOUR_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
} as const satisfies Record<SocialHourStatus, string>

export const SOCIAL_HOUR_KINDS = ['entry', 'reversal'] as const
export type SocialHourKind = (typeof SOCIAL_HOUR_KINDS)[number]

export const SOCIAL_HOUR_SOURCES = ['teacher', 'student'] as const
export type SocialHourSource = (typeof SOCIAL_HOUR_SOURCES)[number]
export const SOCIAL_HOUR_SOURCE_LABELS = {
  teacher: 'Öğretmen girişi',
  student: 'Öğrenci beyanı',
} as const satisfies Record<SocialHourSource, string>

export const SOCIAL_PROGRESS_STATUSES = ['met', 'on_track', 'behind'] as const
export type SocialProgressStatus = (typeof SOCIAL_PROGRESS_STATUSES)[number]
export const SOCIAL_PROGRESS_STATUS_LABELS = {
  met: 'Hedef tamamlandı',
  on_track: 'Yıllık hedefte',
  behind: 'Eksik',
} as const satisfies Record<SocialProgressStatus, string>

/** Mevzuat önerisi: ortaöğrenim boyunca en az 40 saat (OKY md. 50/8; K-537). */
export const DEFAULT_SOCIAL_TOTAL_TARGET_HOURS = 40
/** Yıllık hedef mevzuatta yoktur; öneri 40 saatin dört yıla bölünmesidir (K-537, H-115). */
export const DEFAULT_SOCIAL_YEARLY_TARGET_HOURS = 10
export const SOCIAL_TARGET_MAX_HOURS = 200
/** Bir öğrencinin bir etkinlikte bir günde en çok 10 saati yazılır; yarım saat adımlı (K-536). */
export const SOCIAL_ENTRY_MAX_HOURS = 10
export const SOCIAL_ENTRY_STEP_MINUTES = 30
export const SOCIAL_ENTRY_BULK_MAX = 100
export const SOCIAL_ACTIVITY_NAME_MAX = 120
export const SOCIAL_ACTIVITY_PLACE_MAX = 160
export const SOCIAL_ACTIVITY_ORGANIZATION_MAX = 160
export const SOCIAL_HOUR_NOTE_MAX = 500
export const SOCIAL_HOUR_REASON_MIN = 5
export const SOCIAL_HOUR_REASON_MAX = 500

// --- Şemalar -------------------------------------------------------------------------------------

const text = (missing: string, max: number, min = 2) =>
  z
    .string(missing)
    .trim()
    .min(min, min === 1 ? missing : `En az ${String(min)} karakter girin.`)
    .max(max, `En çok ${String(max)} karakter girebilirsiniz.`)

const nameSchema = text('Etkinlik adını girin.', SOCIAL_ACTIVITY_NAME_MAX).describe(
  'Etkinlik adı (2–120)',
)
const kindSchema = z
  .enum(SOCIAL_ACTIVITY_KINDS, 'Etkinlik türünü seçin.')
  .describe('`club` kulüp/topluluk çalışması, `volunteering` gönüllülük/toplum hizmeti')
const locationSchema = text('Yeri girin.', SOCIAL_ACTIVITY_PLACE_MAX).describe(
  'Etkinliğin yapıldığı yer (2–160)',
)
const responsibleSchema = z
  .string('Sorumlu öğretmeni seçin.')
  .trim()
  .min(1, 'Sorumlu öğretmeni seçin.')
  .max(100)
  .describe('Sorumlu öğretmenin (ya da yöneticinin) kurum üyeliği')
const scopeSchema = z
  .enum(SOCIAL_ACTIVITY_SCOPES, 'Kurum içi ya da dışı seçin.')
  .describe('`internal` kurum içi, `external` kurum dışı (dış kuruluşla)')
const organizationSchema = text('Kuruluş adını girin.', SOCIAL_ACTIVITY_ORGANIZATION_MAX)
  .nullable()
  .describe('Kuruluş adı (2–160); kurum dışında zorunlu')
const clubSchema = z
  .uuid('Kulüp geçersiz.')
  .nullable()
  .describe('Bağlı kulüp (`/finance/clubs`); yalnız kulüp çalışmasında')

function refineActivity(
  value: {
    kind?: SocialActivityKind | undefined
    startDate?: string | undefined
    endDate?: string | null | undefined
    organizationScope?: SocialActivityScope | undefined
    organizationName?: string | null | undefined
    clubId?: string | null | undefined
  },
  context: z.RefinementCtx,
) {
  if (
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    value.endDate < value.startDate
  )
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Bitiş günü başlangıçtan önce olamaz.',
    })
  if (value.organizationScope === 'external' && value.organizationName === null)
    context.addIssue({
      code: 'custom',
      path: ['organizationName'],
      message: 'Kurum dışı etkinlikte kuruluş adını girin.',
    })
  if (value.kind === 'volunteering' && typeof value.clubId === 'string')
    context.addIssue({
      code: 'custom',
      path: ['clubId'],
      message: 'Kulüp yalnız kulüp çalışmasına bağlanır.',
    })
}

export const socialActivityCreateSchema = z
  .strictObject({
    name: nameSchema,
    kind: kindSchema,
    startDate: daySchema.describe('Başlangıç günü (YYYY-MM-DD)'),
    endDate: daySchema
      .nullable()
      .default(null)
      .describe('Bitiş günü (dahil); boşsa süren etkinlik'),
    location: locationSchema,
    responsibleMembershipId: responsibleSchema,
    organizationScope: scopeSchema,
    organizationName: organizationSchema.default(null),
    clubId: clubSchema.default(null),
  })
  .superRefine(refineActivity)
export type SocialActivityCreateInput = z.input<typeof socialActivityCreateSchema>
export type SocialActivityCreateFields = z.output<typeof socialActivityCreateSchema>

export const socialActivityUpdateSchema = z
  .strictObject({
    name: nameSchema.optional(),
    kind: kindSchema.optional(),
    startDate: daySchema.optional().describe('Başlangıç günü'),
    endDate: daySchema.nullable().optional().describe('Bitiş günü; `null` süren etkinlik'),
    location: locationSchema.optional(),
    responsibleMembershipId: responsibleSchema.optional(),
    organizationScope: scopeSchema.optional(),
    organizationName: organizationSchema.optional(),
    clubId: clubSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type SocialActivityUpdateFields = z.output<typeof socialActivityUpdateSchema>

const hoursSchema = z
  .number('Saati girin.')
  .min(0.5, 'Saat en az 0,5 olmalı.')
  .max(SOCIAL_ENTRY_MAX_HOURS, `Bir günde en çok ${String(SOCIAL_ENTRY_MAX_HOURS)} saat yazılır.`)
  .multipleOf(0.5, 'Saati yarım saat adımıyla girin.')
  .describe('Saat (0,5–10, yarım saat adımlı)')
const noteSchema = z
  .string('Notu metin olarak girin.')
  .trim()
  .max(SOCIAL_HOUR_NOTE_MAX, `En çok ${String(SOCIAL_HOUR_NOTE_MAX)} karakter girebilirsiniz.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)
  .describe('Yapılan çalışmanın kısa açıklaması (≤ 500)')
const studentIdSchema = z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(100)

export const socialHourEntrySchema = z.strictObject({
  activityDate: daySchema.describe('Çalışma günü (YYYY-MM-DD); bugünden sonra olamaz'),
  hours: hoursSchema,
  studentIds: z
    .array(studentIdSchema, 'Öğrencileri seçin.')
    .min(1, 'En az bir öğrenci seçin.')
    .max(SOCIAL_ENTRY_BULK_MAX, `Tek seferde en çok ${String(SOCIAL_ENTRY_BULK_MAX)} öğrenci.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı öğrenci iki kez seçilmiş.')
    .describe('Saati yazılacak öğrenciler (1–100); hepsi aynı gün ve saatle'),
  note: noteSchema,
})
export type SocialHourEntryFields = z.output<typeof socialHourEntrySchema>

export const socialHourDeclarationSchema = z.strictObject({
  activityId: z.uuid('Etkinliği seçin.').describe('Etkinlik'),
  activityDate: daySchema.describe('Çalışma günü (YYYY-MM-DD); bugünden sonra olamaz'),
  hours: hoursSchema,
  note: noteSchema,
})
export type SocialHourDeclarationFields = z.output<typeof socialHourDeclarationSchema>

const reasonSchema = text('Gerekçeyi girin.', SOCIAL_HOUR_REASON_MAX, SOCIAL_HOUR_REASON_MIN)

export const socialHourRejectSchema = z.strictObject({
  reason: reasonSchema.describe('Ret gerekçesi (5–500); öğrenci ve veli görür'),
})
export const socialHourReverseSchema = z.strictObject({
  reason: reasonSchema.describe('Düzeltme gerekçesi (5–500)'),
})

const targetSchema = z
  .number('Hedef saati girin.')
  .int('Hedef saat tam sayı olmalı.')
  .min(1, 'Hedef saat en az 1 olmalı.')
  .max(SOCIAL_TARGET_MAX_HOURS, `Hedef saat en çok ${String(SOCIAL_TARGET_MAX_HOURS)} olabilir.`)

export const socialActivitySettingsSchema = z
  .strictObject({
    totalTargetHours: targetSchema
      .optional()
      .describe('Ortaöğrenim boyunca hedef (tam saat; öneri 40)'),
    yearlyTargetHours: targetSchema
      .nullable()
      .optional()
      .describe('Öğretim yılı hedefi (tam saat; öneri 10); `null` yıllık hedef yok'),
  })
  .superRefine((value, context) => {
    if (value.totalTargetHours === undefined && value.yearlyTargetHours === undefined)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir hedefi değiştirin.' })
  })
export type SocialActivitySettingsFields = z.output<typeof socialActivitySettingsSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/** Yarım saat adımlı saat → dakika. */
export const hoursToMinutes = (hours: number): number => Math.round(hours * 60)
/** Dakika → saat (yarım saat adımı korunur). */
export const minutesToHours = (minutes: number): number => Math.round((minutes / 60) * 10) / 10
/** `12,5 saat`. */
export const hoursLabel = (minutes: number): string =>
  `${minutesToHours(minutes).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} saat`

export interface SocialActor {
  role: string
  membershipId: string
}

/** Yönetici her etkinliği, öğretmen yalnız sorumlu olduğu etkinliği yönetir. */
export const canManageSocialActivity = (
  actor: SocialActor,
  activity: { responsibleMembershipId: string },
): boolean =>
  actor.role === 'yonetici' ||
  (actor.role === 'ogretmen' && activity.responsibleMembershipId === actor.membershipId)

/** Sorumlu kişi kurumun etkin öğretmeni ya da yöneticisi (K-535). */
export function assertSocialActivityResponsible(member: MemberCheck): void {
  if (member === undefined) return
  const path = ['responsibleMembershipId']
  if (member === null)
    throw ruleError('social_activity_teacher_not_found', 'Sorumlu öğretmen bulunamadı.', path)
  if (!(SOCIAL_ACTIVITY_RESPONSIBLE_ROLES as readonly string[]).includes(member.role))
    throw ruleError(
      'social_activity_teacher_not_teacher',
      'Sorumlu kişi öğretmen ya da yönetici olmalı.',
      path,
    )
  if (!member.active)
    throw ruleError('social_activity_teacher_inactive', 'Sorumlu kişinin hesabı pasif.', path)
}

function assertOwnResponsibility(actor: SocialActor, responsibleMembershipId: string) {
  if (actor.role === 'ogretmen' && responsibleMembershipId !== actor.membershipId)
    throw ruleError(
      'social_activity_teacher_not_self',
      'Öğretmen yalnız kendi sorumlu olduğu etkinliği açar.',
      ['responsibleMembershipId'],
    )
}

/** Yeni etkinlik (K-535): öğretmen kendini sorumlu yazar; kulüp kurumda olmalı. */
export function planSocialActivity(
  input: SocialActivityCreateFields,
  checks: { actor: SocialActor; responsible: MemberCheck; clubFound: boolean | null },
): void {
  assertOwnResponsibility(checks.actor, input.responsibleMembershipId)
  assertSocialActivityResponsible(checks.responsible)
  if (checks.clubFound === false)
    throw ruleError('social_activity_club_not_found', 'Kulüp bulunamadı.', ['clubId'])
}

export interface StoredSocialActivityFields {
  name: string
  kind: SocialActivityKind
  startDate: string
  endDate: string | null
  location: string
  responsibleMembershipId: string
  organizationScope: SocialActivityScope
  organizationName: string | null
  clubId: string | null
}

/** Etkinliğin kabul ettiği gün: başlangıçtan bitişe (dahil); bitişsiz etkinlik sürer. */
export const activityCovers = (
  activity: Pick<StoredSocialActivityFields, 'startDate' | 'endDate'>,
  day: string,
): boolean => day >= activity.startDate && (activity.endDate === null || day <= activity.endDate)

/**
 * Etkinlik düzenleme (K-535): türe, kurum dışı kuruluşa ve kulübe uyum; öğretmen sorumluyu
 * değiştiremez; etkin saat kaydı olan günler yeni aralığın dışında kalamaz. Değişen alanlar döner.
 */
export function planSocialActivityUpdate(
  current: StoredSocialActivityFields,
  input: SocialActivityUpdateFields,
  checks: {
    actor: SocialActor
    responsible: MemberCheck
    clubFound: boolean | null
    entryDays: { first: string; last: string } | null
  },
): { next: StoredSocialActivityFields; changed: (keyof StoredSocialActivityFields)[] } {
  const pick = <K extends keyof StoredSocialActivityFields>(key: K) =>
    (input[key] === undefined ? current[key] : input[key]) as StoredSocialActivityFields[K]
  const next: StoredSocialActivityFields = {
    name: pick('name'),
    kind: pick('kind'),
    startDate: pick('startDate'),
    endDate: pick('endDate'),
    location: pick('location'),
    responsibleMembershipId: pick('responsibleMembershipId'),
    organizationScope: pick('organizationScope'),
    organizationName: pick('organizationName'),
    clubId: pick('clubId'),
  }
  const changed = (Object.keys(next) as (keyof StoredSocialActivityFields)[]).filter(
    (key) => next[key] !== current[key],
  )
  if (changed.length === 0)
    throw ruleError('social_activity_unchanged', 'Etkinlikte değişiklik yok.')
  if (changed.includes('responsibleMembershipId')) {
    if (checks.actor.role !== 'yonetici')
      throw ruleError(
        'social_activity_teacher_not_self',
        'Sorumlu öğretmeni yalnız yönetici değiştirir.',
        ['responsibleMembershipId'],
      )
    assertSocialActivityResponsible(checks.responsible)
  }
  if (next.endDate !== null && next.endDate < next.startDate)
    throw ruleError('social_activity_date_order', 'Bitiş günü başlangıçtan önce olamaz.', [
      'endDate',
    ])
  if (next.organizationScope === 'external' && next.organizationName === null)
    throw ruleError(
      'social_activity_organization_required',
      'Kurum dışı etkinlikte kuruluş adını girin.',
      ['organizationName'],
    )
  if (next.kind !== 'club' && next.clubId !== null)
    throw ruleError('social_activity_club_kind', 'Kulüp yalnız kulüp çalışmasına bağlanır.', [
      'clubId',
    ])
  if (changed.includes('clubId') && checks.clubFound === false)
    throw ruleError('social_activity_club_not_found', 'Kulüp bulunamadı.', ['clubId'])
  if (
    checks.entryDays !== null &&
    (!activityCovers(next, checks.entryDays.first) || !activityCovers(next, checks.entryDays.last))
  )
    throw ruleError(
      'social_activity_entries_outside_range',
      'Saat kaydı olan günler yeni tarih aralığının dışında kalıyor.',
      ['startDate'],
    )
  return { next, changed }
}

/** Onay bekleyen beyanı olan etkinlik arşivlenmez; onaylı saatler belgede kalır (K-535). */
export function assertSocialActivityArchivable(pendingCount: number): void {
  if (pendingCount > 0)
    throw ruleError(
      'social_activity_has_pending',
      'Etkinlikte onay bekleyen beyan var; önce onaylayın ya da reddedin.',
    )
}

/** Öğrencinin saat yazılabilirliği: kurumda, etkin ve lise (9–12) öğrencisi. */
export type SocialStudentCheck = { active: boolean; grade: number | undefined } | null

export function assertSocialStudent(student: SocialStudentCheck, path: string[]): void {
  if (student === null)
    throw ruleError('social_activity_student_not_found', 'Öğrenci bulunamadı.', path)
  if (!student.active)
    throw ruleError('social_activity_student_inactive', 'Öğrencinin kaydı etkin değil.', path)
  if (!isHighSchoolGrade(student.grade))
    throw ruleError(
      'social_activity_student_not_high_school',
      'Sosyal etkinlik saati yalnız lise (9–12. sınıf) öğrencisine yazılır.',
      path,
    )
}

function assertEntryDay(activity: StoredSocialActivityFields, day: string, today: string) {
  if (day > today)
    throw ruleError('social_activity_date_future', 'Bugünden sonraki bir güne saat yazılmaz.', [
      'activityDate',
    ])
  if (!activityCovers(activity, day))
    throw ruleError('social_activity_date_outside', 'Gün etkinliğin tarih aralığının dışında.', [
      'activityDate',
    ])
}

const duplicateError = (path: string[]) =>
  conflict(
    'social_activity_entry_exists',
    'Bu öğrencinin aynı etkinlikte aynı güne kaydı var.',
    path,
  )

/**
 * Öğretmen ya da yönetici girişi (K-536): gün bugünü geçmez ve etkinlik aralığında; her öğrenci
 * etkin lise öğrencisi; aynı öğrenci × etkinlik × günün etkin (bekleyen ya da onaylı, ters kaydı
 * olmayan) kaydı varsa 409. Bir satır reddedilirse hiçbiri yazılmaz.
 */
export function planSocialHourEntries(
  activity: StoredSocialActivityFields,
  input: SocialHourEntryFields,
  checks: {
    today: string
    students: ReadonlyMap<string, SocialStudentCheck>
    existing: ReadonlySet<string>
  },
): void {
  assertEntryDay(activity, input.activityDate, checks.today)
  input.studentIds.forEach((studentId, index) => {
    const path = ['studentIds', String(index)]
    assertSocialStudent(checks.students.get(studentId) ?? null, path)
    if (checks.existing.has(studentId)) throw duplicateError(path)
  })
}

/** Öğrenci beyanı (K-536): aynı gün ve etkinlik kuralı; beyan onay bekler. */
export function planSocialHourDeclaration(
  activity: StoredSocialActivityFields,
  input: SocialHourDeclarationFields,
  checks: { today: string; student: SocialStudentCheck; exists: boolean },
): void {
  assertSocialStudent(checks.student, [])
  assertEntryDay(activity, input.activityDate, checks.today)
  if (checks.exists) throw duplicateError(['activityDate'])
}

export interface StoredSocialHour {
  kind: SocialHourKind
  status: SocialHourStatus
  reversedByEntryId: string | null
}

/** Onay ve ret yalnız bekleyen beyanda (K-536); karar verilmiş kayıt 409. */
export function assertSocialHourPending(entry: StoredSocialHour): void {
  if (entry.kind !== 'entry' || entry.status !== 'pending')
    throw conflict('social_activity_entry_decided', 'Bu kayıt için karar zaten verilmiş.')
}

/** Ters kayıt (K-536): yalnız onaylı ve daha önce düzeltilmemiş saat kaydına. */
export function assertSocialHourReversible(entry: StoredSocialHour): void {
  if (entry.kind !== 'entry' || entry.status !== 'approved')
    throw conflict(
      'social_activity_entry_not_reversible',
      'Yalnız onaylı saat kaydı ters kayıtla düzeltilir.',
    )
  if (entry.reversedByEntryId !== null)
    throw conflict('social_activity_entry_reversed', 'Bu kayıt zaten ters kayıtla düzeltilmiş.')
}

// --- Özet ----------------------------------------------------------------------------------------

/** Günün öğretim yılı (başlangıç yılı): Eylül'de başlar (DOM-YTK-063 varsayılan aralığı). */
export function socialAcademicYearOf(day: string): number {
  const year = Number(day.slice(0, 4))
  return Number(day.slice(5, 7)) >= 9 ? year : year - 1
}

/** `2026–2027`. */
export const socialAcademicYearLabel = (startYear: number) =>
  `${String(startYear)}–${String(startYear + 1)}`

/** Onaylı net dakika: onaylı kayıtlar ve ters kayıtların (eksi) toplamı. */
export function approvedMinutes(
  rows: readonly { status: SocialHourStatus; minutes: number }[],
): number {
  return rows.reduce((sum, row) => (row.status === 'approved' ? sum + row.minutes : sum), 0)
}

export interface SocialTargets {
  totalTargetHours: number
  yearlyTargetHours: number | null
}

export const DEFAULT_SOCIAL_TARGETS: SocialTargets = {
  totalTargetHours: DEFAULT_SOCIAL_TOTAL_TARGET_HOURS,
  yearlyTargetHours: DEFAULT_SOCIAL_YEARLY_TARGET_HOURS,
}

export interface SocialProgress {
  totalMinutes: number
  yearMinutes: number
  totalTargetHours: number
  yearlyTargetHours: number | null
  totalMissingMinutes: number
  yearMissingMinutes: number | null
  status: SocialProgressStatus
}

/**
 * Hedefe göre durum (K-537): toplam hedef tamamlandıysa `met`; değilse yıllık hedef varsa ve bu
 * yıl tamamlandıysa `on_track`; aksi `behind` (eksik). Eksik dakika sıfırın altına inmez.
 */
export function socialProgress(input: {
  totalMinutes: number
  yearMinutes: number
  targets: SocialTargets
}): SocialProgress {
  const { totalTargetHours, yearlyTargetHours } = input.targets
  const totalMissingMinutes = Math.max(0, totalTargetHours * 60 - input.totalMinutes)
  const yearMissingMinutes =
    yearlyTargetHours === null ? null : Math.max(0, yearlyTargetHours * 60 - input.yearMinutes)
  const status: SocialProgressStatus =
    totalMissingMinutes === 0 ? 'met' : yearMissingMinutes === 0 ? 'on_track' : 'behind'
  return {
    totalMinutes: input.totalMinutes,
    yearMinutes: input.yearMinutes,
    totalTargetHours,
    yearlyTargetHours,
    totalMissingMinutes,
    yearMissingMinutes,
    status,
  }
}

export interface CertificateSourceRow {
  id: string
  kind: SocialHourKind
  status: SocialHourStatus
  reversedByEntryId: string | null
  activityDate: string
  minutes: number
}

/**
 * Belge satırları (K-537): yalnız onaylı ve ters kaydı olmayan saat kayıtları; ters kayıtlar
 * düzelttiği kaydı belgeden düşürür. Gün sırasıyla; toplam satırların toplamıdır.
 */
export function certificateRows<T extends CertificateSourceRow>(
  rows: readonly T[],
): { rows: T[]; totalMinutes: number } {
  const kept = rows
    .filter(
      (row) => row.kind === 'entry' && row.status === 'approved' && row.reversedByEntryId === null,
    )
    .sort((a, b) => a.activityDate.localeCompare(b.activityDate) || a.id.localeCompare(b.id))
  return { rows: kept, totalMinutes: kept.reduce((sum, row) => sum + row.minutes, 0) }
}
