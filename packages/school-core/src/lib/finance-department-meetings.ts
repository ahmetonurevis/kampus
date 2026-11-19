import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Zümre toplantısı tutanağı (docs/domain/finans.md DOM-FIN-132; ON-217). Bir branşın (ders)
 * öğretmenlerinin dönem başı, dönem sonu ya da ara toplantısının gündemi, katılımı ve kararları;
 * kararın sorumlusu, termini ve takibi. Personel kaydı ayrı tablo değildir: başkan, katılımcı ve
 * sorumlu kurum üyeliğidir. Tutanak imza günüyle kesinleşir; sonra toplantı ve karar metni
 * değişmez, yalnız kararın durumu ve takip notu yazılır (K-453). Fonksiyonlar saftır.
 */

/** Tutanakları yalnız yönetici okur ve yazar (K-451). */
export const FINANCE_DEPARTMENT_MEETING_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Katılımcı, başkan ve karar sorumlusu olabilecek üyelik rolleri (K-452). */
export const DEPARTMENT_MEETING_MEMBER_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]

export const DEPARTMENT_MEETING_KINDS = ['term_start', 'term_end', 'interim'] as const
export type DepartmentMeetingKind = (typeof DEPARTMENT_MEETING_KINDS)[number]
export const DEPARTMENT_MEETING_KIND_LABELS = {
  term_start: 'Dönem başı',
  term_end: 'Dönem sonu',
  interim: 'Ara toplantı',
} as const satisfies Record<DepartmentMeetingKind, string>

export const DEPARTMENT_MEETING_STATUSES = ['draft', 'finalized'] as const
export type DepartmentMeetingStatus = (typeof DEPARTMENT_MEETING_STATUSES)[number]
export const DEPARTMENT_MEETING_STATUS_LABELS = {
  draft: 'Taslak',
  finalized: 'Kesinleşti',
} as const satisfies Record<DepartmentMeetingStatus, string>

export const DEPARTMENT_MEETING_ATTENDANCE = ['attended', 'absent', 'excused'] as const
export type DepartmentMeetingAttendance = (typeof DEPARTMENT_MEETING_ATTENDANCE)[number]
export const DEPARTMENT_MEETING_ATTENDANCE_LABELS = {
  attended: 'Katıldı',
  absent: 'Katılmadı',
  excused: 'Mazeretli',
} as const satisfies Record<DepartmentMeetingAttendance, string>

export const DEPARTMENT_DECISION_STATUSES = ['open', 'completed', 'cancelled'] as const
export type DepartmentDecisionStatus = (typeof DEPARTMENT_DECISION_STATUSES)[number]
export const DEPARTMENT_DECISION_STATUS_LABELS = {
  open: 'Açık',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
} as const satisfies Record<DepartmentDecisionStatus, string>

export const DEPARTMENT_MEETING_SUBJECT_MAX = 60
export const DEPARTMENT_MEETING_LOCATION_MIN = 2
export const DEPARTMENT_MEETING_LOCATION_MAX = 200
export const DEPARTMENT_MEETING_AGENDA_MAX = 30
export const DEPARTMENT_MEETING_AGENDA_TITLE_MIN = 2
export const DEPARTMENT_MEETING_AGENDA_TITLE_MAX = 300
export const DEPARTMENT_MEETING_DISCUSSION_MAX = 4000
export const DEPARTMENT_MEETING_ATTENDEES_MAX = 100
export const DEPARTMENT_DECISION_TEXT_MIN = 2
export const DEPARTMENT_DECISION_TEXT_MAX = 2000
export const DEPARTMENT_DECISION_NOTE_MAX = 1000

const membershipIdSchema = (message: string) =>
  z.string(message).trim().min(1, message).max(100, 'Personel geçersiz.')

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

export const departmentMeetingAgendaItemSchema = z.strictObject({
  id: z
    .uuid('Gündem maddesi geçersiz.')
    .nullable()
    .default(null)
    .describe('Var olan gündem maddesinin kimliği; yeni maddede boş'),
  title: z
    .string('Gündem maddesini yazın.')
    .trim()
    .min(DEPARTMENT_MEETING_AGENDA_TITLE_MIN, 'Gündem maddesini en az 2 karakterle yazın.')
    .max(DEPARTMENT_MEETING_AGENDA_TITLE_MAX, 'Gündem maddesi en fazla 300 karakter olabilir.')
    .describe('Gündem maddesinin başlığı'),
  discussion: optionalText(DEPARTMENT_MEETING_DISCUSSION_MAX, 'Görüşme özeti').describe(
    'Maddede yapılan görüşmelerin özeti (isteğe bağlı)',
  ),
})

export const departmentMeetingAttendeeSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: membershipIdSchema('Katılımcı seçin.').describe('Katılımcının kurum üyeliği'),
  status: z
    .enum(DEPARTMENT_MEETING_ATTENDANCE, 'Katılım durumunu seçin.')
    .describe('`attended` katıldı, `absent` katılmadı, `excused` mazeretli'),
})

/** Toplantı gövdesi (oluşturma ve taslak düzeltmesi tam gövdedir). */
export const departmentMeetingInputSchema = z
  .strictObject({
    subjectId: z
      .string('Zümreyi (dersi) seçin.')
      .trim()
      .min(1, 'Zümreyi (dersi) seçin.')
      .max(DEPARTMENT_MEETING_SUBJECT_MAX, 'Zümre geçersiz.')
      .describe('Zümrenin dersi (kurum ders kaydı ya da müfredat ders kimliği)'),
    kind: z
      .enum(DEPARTMENT_MEETING_KINDS, 'Toplantı türünü seçin.')
      .describe('`term_start` dönem başı, `term_end` dönem sonu, `interim` ara toplantı'),
    meetingDate: daySchema.describe('Toplantı günü (YYYY-MM-DD)'),
    location: z
      .string('Toplantı yerini yazın.')
      .trim()
      .min(DEPARTMENT_MEETING_LOCATION_MIN, 'Toplantı yerini en az 2 karakterle yazın.')
      .max(DEPARTMENT_MEETING_LOCATION_MAX, 'Toplantı yeri en fazla 200 karakter olabilir.')
      .describe('Toplantı yeri'),
    // kvkk: K (personel üyeliği)
    chairMembershipId: membershipIdSchema('Toplantı başkanını seçin.').describe(
      'Toplantı başkanının kurum üyeliği; katılımcılar arasında "katıldı" olmalı',
    ),
    agenda: z
      .array(departmentMeetingAgendaItemSchema)
      .min(1, 'En az bir gündem maddesi yazın.')
      .max(DEPARTMENT_MEETING_AGENDA_MAX, 'En fazla 30 gündem maddesi yazılabilir.')
      .describe('Gündem maddeleri, görüşülme sırasıyla'),
    attendees: z
      .array(departmentMeetingAttendeeSchema)
      .min(1, 'En az bir katılımcı ekleyin.')
      .max(DEPARTMENT_MEETING_ATTENDEES_MAX, 'En fazla 100 katılımcı eklenebilir.')
      .describe('Zümre öğretmenleri ve katılım durumları'),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    value.agenda.forEach((item, index) => {
      if (item.id === null) return
      if (ids.has(item.id))
        ctx.addIssue({
          code: 'custom',
          path: ['agenda', index, 'id'],
          message: 'Gündem maddesi iki kez yazılmış.',
        })
      ids.add(item.id)
    })
    const people = new Set<string>()
    value.attendees.forEach((attendee, index) => {
      if (people.has(attendee.membershipId))
        ctx.addIssue({
          code: 'custom',
          path: ['attendees', index, 'membershipId'],
          message: 'Katılımcı iki kez eklenmiş.',
        })
      people.add(attendee.membershipId)
    })
    const chair = value.attendees.find(
      (attendee) => attendee.membershipId === value.chairMembershipId,
    )
    if (chair?.status !== 'attended')
      ctx.addIssue({
        code: 'custom',
        path: ['chairMembershipId'],
        message: 'Toplantı başkanı katılımcılar arasında "katıldı" olarak yer almalı.',
      })
  })
export type DepartmentMeetingInput = z.output<typeof departmentMeetingInputSchema>
export type DepartmentMeetingAgendaItemInput = DepartmentMeetingInput['agenda'][number]

export const departmentMeetingFinalizeSchema = z.strictObject({
  signedDate: daySchema.describe('Tutanağın imzalandığı gün (YYYY-MM-DD)'),
})

export const departmentDecisionInputSchema = z.strictObject({
  agendaItemId: z.uuid('Gündem maddesini seçin.').describe('Kararın bağlı olduğu gündem maddesi'),
  text: z
    .string('Karar metnini yazın.')
    .trim()
    .min(DEPARTMENT_DECISION_TEXT_MIN, 'Karar metnini en az 2 karakterle yazın.')
    .max(DEPARTMENT_DECISION_TEXT_MAX, 'Karar metni en fazla 2000 karakter olabilir.')
    .describe('Karar metni'),
  // kvkk: K (personel üyeliği)
  responsibleMembershipId: membershipIdSchema('Sorumlu personeli seçin.').describe(
    'Kararın sorumlusu (kurum üyeliği)',
  ),
  dueDate: daySchema.nullable().default(null).describe('Termin günü (YYYY-MM-DD); boşsa terminsiz'),
})
export type DepartmentDecisionInput = z.output<typeof departmentDecisionInputSchema>

export const departmentDecisionFollowUpSchema = z
  .strictObject({
    status: z
      .enum(DEPARTMENT_DECISION_STATUSES, 'Karar durumunu seçin.')
      .describe('`open` açık, `completed` tamamlandı, `cancelled` iptal'),
    followUpNote: optionalText(DEPARTMENT_DECISION_NOTE_MAX, 'Takip notu').describe(
      'Takip notu; iptalde zorunlu',
    ),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'cancelled' && value.followUpNote === null)
      ctx.addIssue({
        code: 'custom',
        path: ['followUpNote'],
        message: 'İptal gerekçesini takip notuna yazın.',
      })
  })
export type DepartmentDecisionFollowUp = z.output<typeof departmentDecisionFollowUpSchema>

// --- Kurallar -----------------------------------------------------------------------------------

const rule = (code: string, message: string, path?: readonly (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path === undefined ? {} : { path: path.map(String) }),
  })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Kesinleşmiş tutanakta toplantı, katılım ve karar metni değişmez (K-453). */
export function assertMeetingEditable(status: DepartmentMeetingStatus): void {
  if (status === 'finalized')
    throw conflict('department_meeting_finalized', 'Kesinleşmiş tutanak değiştirilemez.')
}

export interface MeetingStaff {
  role: string
  active: boolean
}

/**
 * Tutanaktaki kişiler (K-452): başkan, katılımcı ve karar sorumlusu kurumun öğretmen ya da yönetici
 * üyeliği olmalı. Yeni eklenen kişi etkin olmalı; tutanakta zaten yer alan kişi sonradan ayrılmışsa
 * kalır (geçmiş toplantının kaydı bozulmaz).
 */
export function assertMeetingPerson(input: {
  staff: MeetingStaff | null
  alreadyListed: boolean
  path: readonly (string | number)[]
}): void {
  if (input.staff === null)
    throw rule('department_meeting_staff_not_found', 'Personel bu kurumda bulunamadı.', input.path)
  if (!(DEPARTMENT_MEETING_MEMBER_ROLES as readonly string[]).includes(input.staff.role))
    throw rule(
      'department_meeting_not_staff',
      'Yalnız öğretmen ya da yönetici eklenir.',
      input.path,
    )
  if (!input.staff.active && !input.alreadyListed)
    throw rule(
      'department_meeting_staff_inactive',
      'Ayrılmış personel tutanağa eklenemez.',
      input.path,
    )
}

export interface StoredAgendaItem {
  id: string
  title: string
  discussion: string | null
}

/**
 * Gündem düzeltmesi (K-452): kimliği verilen madde tutanakta olmalı; karar bağlı maddeler
 * silinemez. Yeni maddelere `newId` ile kimlik verilir; sıra gövdedeki sıradır.
 */
export function mergeAgenda(input: {
  previous: readonly StoredAgendaItem[]
  next: readonly DepartmentMeetingAgendaItemInput[]
  usedIds: ReadonlySet<string>
  newId: () => string
}): StoredAgendaItem[] {
  const known = new Set(input.previous.map((item) => item.id))
  const merged = input.next.map((item, index) => {
    if (item.id !== null && !known.has(item.id))
      throw rule('department_meeting_agenda_unknown', 'Gündem maddesi bu tutanakta bulunamadı.', [
        'agenda',
        index,
        'id',
      ])
    return { id: item.id ?? input.newId(), title: item.title, discussion: item.discussion }
  })
  const kept = new Set(merged.map((item) => item.id))
  for (const id of input.usedIds)
    if (known.has(id) && !kept.has(id))
      throw rule(
        'department_meeting_agenda_in_use',
        'Kararı olan gündem maddesi silinemez; önce kararı kaldırın.',
        ['agenda'],
      )
  return merged
}

/**
 * Karar (K-452): bağlı gündem maddesi tutanakta olmalı; termin toplantı gününden önce olamaz.
 */
export function assertDecision(input: {
  agenda: readonly StoredAgendaItem[]
  agendaItemId: string
  meetingDate: string
  dueDate: string | null
}): void {
  if (!input.agenda.some((item) => item.id === input.agendaItemId))
    throw rule('department_meeting_agenda_not_found', 'Gündem maddesi bu tutanakta bulunamadı.', [
      'agendaItemId',
    ])
  if (input.dueDate !== null && input.dueDate < input.meetingDate)
    throw rule('department_meeting_due_before_meeting', 'Termin toplantı gününden önce olamaz.', [
      'dueDate',
    ])
}

/** Toplantı günü değişirse açık kararların termini yeni günden önce kalamaz (K-452). */
export function assertMeetingDateFitsDecisions(
  meetingDate: string,
  earliestDueDate: string | null,
): void {
  if (earliestDueDate !== null && earliestDueDate < meetingDate)
    throw rule(
      'department_meeting_due_before_meeting',
      'Kararlardan birinin termini bu toplantı gününden önce; önce termini düzeltin.',
      ['meetingDate'],
    )
}

/**
 * Kesinleştirme (K-453): yalnız taslak; imza günü toplantı gününden önce ve bugünden (İstanbul)
 * sonra olamaz.
 */
export function assertFinalize(input: {
  status: DepartmentMeetingStatus
  meetingDate: string
  signedDate: string
  today: string
}): void {
  assertMeetingEditable(input.status)
  if (input.signedDate < input.meetingDate)
    throw rule('department_meeting_signed_before_meeting', 'İmza günü toplantıdan önce olamaz.', [
      'signedDate',
    ])
  if (input.signedDate > input.today)
    throw rule('department_meeting_signed_in_future', 'İmza günü bugünden sonra olamaz.', [
      'signedDate',
    ])
}

/**
 * Karar takibi (K-453): yalnız kesinleşmiş tutanakta; iptal edilmiş karar yeniden açılmaz ve
 * notu değişmez. Açık ↔ tamamlandı geçişi serbesttir.
 */
export function assertFollowUp(input: {
  meetingStatus: DepartmentMeetingStatus
  from: DepartmentDecisionStatus
}): void {
  if (input.meetingStatus !== 'finalized')
    throw conflict(
      'department_meeting_not_finalized',
      'Karar takibi tutanak kesinleşince yazılır; taslakta kararı düzeltin.',
    )
  if (input.from === 'cancelled')
    throw conflict('department_decision_cancelled', 'İptal edilmiş karar güncellenemez.')
}

/** Termini geçmiş açık karar (K-453): termin günü bugünden (İstanbul) önce. */
export function isDecisionOverdue(
  decision: { status: DepartmentDecisionStatus; dueDate: string | null },
  today: string,
): boolean {
  return decision.status === 'open' && decision.dueDate !== null && decision.dueDate < today
}

/** Gecikme günü (termin ertesinden bugüne); gecikmemişse 0. */
export function overdueDays(
  decision: { status: DepartmentDecisionStatus; dueDate: string | null },
  today: string,
): number {
  if (!isDecisionOverdue(decision, today) || decision.dueDate === null) return 0
  const day = (value: string) => Date.parse(`${value}T00:00:00.000Z`)
  return Math.round((day(today) - day(decision.dueDate)) / 86_400_000)
}

/**
 * Karar numarası saklanmaz (K-452): gündem sırası, sonra karar açılış sırası; tutanakta "1.2"
 * biçiminde (madde no.karar no) gösterilir.
 */
export function numberDecisions<T extends { agendaItemId: string; createdAt: string; id: string }>(
  agenda: readonly { id: string }[],
  decisions: readonly T[],
): (T & { number: string })[] {
  const position = new Map(agenda.map((item, index) => [item.id, index]))
  const sorted = [...decisions].sort(
    (a, b) =>
      (position.get(a.agendaItemId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.agendaItemId) ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  const counters = new Map<string, number>()
  return sorted.map((decision) => {
    const count = (counters.get(decision.agendaItemId) ?? 0) + 1
    counters.set(decision.agendaItemId, count)
    const item = (position.get(decision.agendaItemId) ?? -1) + 1
    return { ...decision, number: `${String(item)}.${String(count)}` }
  })
}

/** Katılım sayıları (tutanak özeti). */
export function attendanceCounts(
  attendees: readonly { status: DepartmentMeetingAttendance }[],
): Record<DepartmentMeetingAttendance, number> {
  const counts = { attended: 0, absent: 0, excused: 0 }
  for (const attendee of attendees) counts[attendee.status] += 1
  return counts
}
