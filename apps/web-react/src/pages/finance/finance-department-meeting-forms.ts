import { z } from 'zod'
import type {
  DepartmentDecisionBody,
  DepartmentMeeting,
  DepartmentMeetingBody,
  DepartmentMeetingDecision,
} from '@kampus/react-shared/use-finance-department-meetings.ts'
import {
  departmentDecisionFollowUpSchema,
  departmentDecisionInputSchema,
  departmentMeetingInputSchema,
  DEPARTMENT_DECISION_STATUSES,
  DEPARTMENT_MEETING_ATTENDANCE,
  DEPARTMENT_MEETING_KINDS,
  DEPARTMENT_MEETING_MEMBER_ROLES,
  type DepartmentDecisionStatus,
  type DepartmentMeetingAttendance,
  type DepartmentMeetingKind,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

// Zümre tutanağı formlarının saf mantığı (DOM-FIN-132; ON-217): form değerleri gövdeye çevrilir,
// doğrulama core şemasıyla yapılır ve hata alana düşer. Katılım, seçilebilir personelin her biri
// için bir seçimdir ("listede değil" ya da katılım durumu).

export type AttendanceChoice = '' | DepartmentMeetingAttendance

export type MeetingFormValues = {
  subjectId: string
  kind: DepartmentMeetingKind
  meetingDate: string
  location: string
  chairMembershipId: string
  agenda: { id: string; title: string; discussion: string }[]
  /** Üyelik → seçim; `''` listede değil. */
  attendance: Record<string, AttendanceChoice>
}

export interface MeetingStaffOption {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/**
 * Seçilebilir kişiler (K-452): etkin öğretmen ve yönetici; tutanakta zaten olan ayrılmış personel
 * de listelenir. Ada göre sıralı.
 */
export function meetingStaffOptions(
  staff: readonly MeetingStaffOption[],
  listed: ReadonlySet<string>,
): MeetingStaffOption[] {
  return staff
    .filter(
      (person) =>
        (DEPARTMENT_MEETING_MEMBER_ROLES as readonly string[]).includes(person.role) &&
        (person.active || listed.has(person.membershipId)),
    )
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'tr') || a.membershipId.localeCompare(b.membershipId),
    )
}

export const emptyMeetingForm = (meetingDate: string): MeetingFormValues => ({
  subjectId: '',
  kind: 'term_start',
  meetingDate,
  location: '',
  chairMembershipId: '',
  agenda: [{ id: '', title: '', discussion: '' }],
  attendance: {},
})

export function meetingFormFrom(meeting: DepartmentMeeting): MeetingFormValues {
  return {
    subjectId: meeting.subjectId,
    kind: meeting.kind,
    meetingDate: meeting.meetingDate,
    location: meeting.location,
    chairMembershipId: meeting.chairMembershipId,
    agenda: meeting.agenda.map((item) => ({
      id: item.id,
      title: item.title,
      discussion: item.discussion ?? '',
    })),
    attendance: Object.fromEntries(
      meeting.attendees.map((attendee) => [attendee.membershipId, attendee.status]),
    ),
  }
}

/** Gövde: boş madde kimliği yeni maddedir; katılım seçilenlerden, sırası kişi kimliğine göre. */
export function meetingBody(values: MeetingFormValues): DepartmentMeetingBody {
  return {
    subjectId: values.subjectId,
    kind: values.kind,
    meetingDate: values.meetingDate,
    location: values.location,
    chairMembershipId: values.chairMembershipId,
    agenda: values.agenda.map((item) => ({
      id: item.id === '' ? null : item.id,
      title: item.title,
      discussion: item.discussion,
    })),
    attendees: Object.entries(values.attendance)
      .filter((entry): entry is [string, DepartmentMeetingAttendance] => entry[1] !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([membershipId, status]) => ({ membershipId, status })),
  }
}

const MEETING_FIELDS = ['subjectId', 'kind', 'meetingDate', 'location', 'chairMembershipId']

/**
 * Sunucu ya da core hata yolunu form alanına çevirir: gündem maddesi `agenda.<i>.title`, gündem
 * listesi `agenda`, katılım hataları `attendance`; karşılığı yoksa `null` (kök hata).
 */
export function meetingFormField(path: readonly (string | number)[]): string | null {
  const [head, index, leaf] = path.map(String)
  if (head === undefined) return null
  if (MEETING_FIELDS.includes(head)) return head
  if (head === 'agenda') {
    if (index !== undefined && (leaf === 'title' || leaf === 'discussion'))
      return `agenda.${index}.${leaf}`
    return 'agenda'
  }
  if (head === 'attendees') return 'attendance'
  return null
}

export const meetingFormSchema = z
  .object({
    subjectId: z.string(),
    kind: z.enum(DEPARTMENT_MEETING_KINDS),
    meetingDate: z.string(),
    location: z.string(),
    chairMembershipId: z.string(),
    agenda: z.array(z.object({ id: z.string(), title: z.string(), discussion: z.string() })),
    attendance: z.record(z.string(), z.enum(['', ...DEPARTMENT_MEETING_ATTENDANCE])),
  })
  .superRefine((values, context) => {
    const result = departmentMeetingInputSchema.safeParse(meetingBody(values))
    if (result.success) return
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const field = meetingFormField(issue.path as (string | number)[]) ?? 'subjectId'
      if (seen.has(field)) continue
      seen.add(field)
      context.addIssue({ code: 'custom', path: field.split('.'), message: issue.message })
    }
  })

export type DecisionFormValues = {
  agendaItemId: string
  text: string
  responsibleMembershipId: string
  dueDate: string
}

export const emptyDecisionForm = (agendaItemId: string): DecisionFormValues => ({
  agendaItemId,
  text: '',
  responsibleMembershipId: '',
  dueDate: '',
})

export const decisionFormFrom = (decision: DepartmentMeetingDecision): DecisionFormValues => ({
  agendaItemId: decision.agendaItemId,
  text: decision.text,
  responsibleMembershipId: decision.responsibleMembershipId,
  dueDate: decision.dueDate ?? '',
})

export const decisionBody = (values: DecisionFormValues): DepartmentDecisionBody => ({
  agendaItemId: values.agendaItemId,
  text: values.text,
  responsibleMembershipId: values.responsibleMembershipId,
  dueDate: values.dueDate === '' ? null : values.dueDate,
})

const DECISION_FIELDS = ['agendaItemId', 'text', 'responsibleMembershipId', 'dueDate'] as const
export function decisionFormField(name: string): (typeof DECISION_FIELDS)[number] | null {
  return (DECISION_FIELDS as readonly string[]).includes(name)
    ? (name as (typeof DECISION_FIELDS)[number])
    : null
}

export const decisionFormSchema = z
  .object({
    agendaItemId: z.string(),
    text: z.string(),
    responsibleMembershipId: z.string(),
    dueDate: z.string(),
  })
  .superRefine((values, context) => {
    const result = departmentDecisionInputSchema.safeParse(decisionBody(values))
    if (result.success) return
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const field = decisionFormField(String(issue.path[0] ?? '')) ?? 'text'
      if (seen.has(field)) continue
      seen.add(field)
      context.addIssue({ code: 'custom', path: [field], message: issue.message })
    }
  })

export type FollowUpFormValues = { status: DepartmentDecisionStatus; followUpNote: string }

export const followUpFormSchema = z
  .object({ status: z.enum(DEPARTMENT_DECISION_STATUSES), followUpNote: z.string() })
  .superRefine((values, context) => {
    const result = departmentDecisionFollowUpSchema.safeParse(values)
    if (result.success) return
    const [issue] = result.error.issues
    if (issue !== undefined)
      context.addIssue({ code: 'custom', path: ['followUpNote'], message: issue.message })
  })

/** Katılım sütunu: "4 / 6 katıldı". */
export const attendanceText = (meeting: { attendedCount: number; attendeeCount: number }) =>
  `${String(meeting.attendedCount)} / ${String(meeting.attendeeCount)} katıldı`

/** Karar sütunu: "2 açık / 5" ya da karar yoksa tire. */
export const decisionCountText = (meeting: { openDecisionCount: number; decisionCount: number }) =>
  meeting.decisionCount === 0
    ? '—'
    : `${String(meeting.openDecisionCount)} açık / ${String(meeting.decisionCount)}`
