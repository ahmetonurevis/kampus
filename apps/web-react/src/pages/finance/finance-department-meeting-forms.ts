import { z } from 'zod'
import type {
  DepartmentDecisionBody,
  DepartmentMeeting,
  DepartmentMeetingBody,
  DepartmentMeetingDecision,
  DepartmentMeetingTemplate,
  DepartmentMeetingTemplateBody,
  DepartmentMeetingTemplateUpdateBody,
} from '@kampus/react-shared/use-finance-department-meetings.ts'
import {
  agendaFromTemplate,
  departmentDecisionFollowUpSchema,
  departmentDecisionInputSchema,
  departmentMeetingInputSchema,
  DEPARTMENT_DECISION_STATUSES,
  DEPARTMENT_MEETING_ATTENDANCE,
  DEPARTMENT_MEETING_KINDS,
  DEPARTMENT_MEETING_MEMBER_ROLES,
  meetingAgendaTemplateInputSchema,
  MEETING_BOARDS,
  SUGGESTED_AGENDAS,
  type DepartmentDecisionStatus,
  type DepartmentMeetingAttendance,
  type DepartmentMeetingKind,
  type MeetingBoard,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

// Kurul ve zümre tutanağı formlarının saf mantığı (DOM-FIN-132, DOM-FIN-135; ON-217, ON-218):
// form değerleri gövdeye çevrilir, doğrulama core şemasıyla yapılır ve hata alana düşer. Katılım,
// seçilebilir personelin her biri için bir seçimdir ("listede değil" ya da katılım durumu).
// Kurul türü hedefi belirler (zümrede ders, şube kurulunda sınıf); gündem şablondan doldurulur.

export type AttendanceChoice = '' | DepartmentMeetingAttendance

export type MeetingFormValues = {
  board: MeetingBoard
  subjectId: string
  classId: string
  /** Gündemin doldurulduğu şablon; `''` şablonsuz. */
  agendaTemplateId: string
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

export const emptyMeetingForm = (
  meetingDate: string,
  board: MeetingBoard = 'department',
): MeetingFormValues => ({
  board,
  subjectId: '',
  classId: '',
  agendaTemplateId: '',
  kind: 'term_start',
  meetingDate,
  location: '',
  chairMembershipId: '',
  agenda: [{ id: '', title: '', discussion: '' }],
  attendance: {},
})

export function meetingFormFrom(meeting: DepartmentMeeting): MeetingFormValues {
  return {
    board: meeting.board,
    subjectId: meeting.subjectId ?? '',
    classId: meeting.classId ?? '',
    agendaTemplateId: meeting.agendaTemplateId ?? '',
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

/**
 * Gövde: boş madde kimliği yeni maddedir; katılım seçilenlerden, sırası kişi kimliğine göre.
 * Kurul türüne ait olmayan hedef gönderilmez (tür değişince eski seçim kalsa da).
 */
export function meetingBody(values: MeetingFormValues): DepartmentMeetingBody {
  return {
    board: values.board,
    subjectId: values.board === 'department' ? values.subjectId : null,
    classId: values.board === 'class' ? values.classId : null,
    agendaTemplateId: values.agendaTemplateId === '' ? null : values.agendaTemplateId,
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

const MEETING_FIELDS = [
  'board',
  'subjectId',
  'classId',
  'agendaTemplateId',
  'kind',
  'meetingDate',
  'location',
  'chairMembershipId',
]

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
    board: z.enum(MEETING_BOARDS),
    subjectId: z.string(),
    classId: z.string(),
    agendaTemplateId: z.string(),
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
      const field = meetingFormField(issue.path as (string | number)[]) ?? 'board'
      if (seen.has(field)) continue
      seen.add(field)
      context.addIssue({ code: 'custom', path: field.split('.'), message: issue.message })
    }
  })

/**
 * Şablondan gündem (K-461): maddeler kopyalanır (görüşme boş), şablon iz olarak seçilir; mevcut
 * maddelerin yerini alır. Taslak düzeltmede de kullanılabilir; kararı olan madde sunucuda korunur.
 */
export function withTemplateAgenda(
  values: MeetingFormValues,
  template: Pick<DepartmentMeetingTemplate, 'id' | 'items'>,
): MeetingFormValues {
  return {
    ...values,
    agendaTemplateId: template.id,
    agenda: agendaFromTemplate(template.items).map((item) => ({
      id: '',
      title: item.title,
      discussion: '',
    })),
  }
}

// --- Gündem şablonu formu (DOM-FIN-135; K-461) ---------------------------------------------------

export type TemplateFormValues = {
  board: MeetingBoard
  name: string
  items: { title: string }[]
}

/** Yeni şablon önerilen gündemle açılır (H-101); kurum düzenler. */
export const suggestedItems = (board: MeetingBoard) =>
  SUGGESTED_AGENDAS[board].map((title) => ({ title }))

export const emptyTemplateForm = (board: MeetingBoard = 'department'): TemplateFormValues => ({
  board,
  name: '',
  items: suggestedItems(board),
})

export const templateFormFrom = (template: DepartmentMeetingTemplate): TemplateFormValues => ({
  board: template.board,
  name: template.name,
  items: template.items.map((item) => ({ title: item.title })),
})

export const templateBody = (values: TemplateFormValues): DepartmentMeetingTemplateBody => ({
  board: values.board,
  name: values.name,
  items: values.items.map((item) => ({ title: item.title })),
})

/** Düzeltme gövdesi: kurul türü değişmez, gönderilmez. */
export const templateUpdateBody = (
  values: TemplateFormValues,
): DepartmentMeetingTemplateUpdateBody => ({
  name: values.name,
  items: values.items.map((item) => ({ title: item.title })),
})

/** Hata yolu → form alanı: `items.<i>.title`, `items`, `name`, `board`; yoksa `null`. */
export function templateFormField(path: readonly (string | number)[]): string | null {
  const [head, index, leaf] = path.map(String)
  if (head === 'name' || head === 'board') return head
  if (head === 'items')
    return index !== undefined && leaf === 'title' ? `items.${index}.title` : 'items'
  return null
}

export const templateFormSchema = z
  .object({
    board: z.enum(MEETING_BOARDS),
    name: z.string(),
    items: z.array(z.object({ title: z.string() })),
  })
  .superRefine((values, context) => {
    const result = meetingAgendaTemplateInputSchema.safeParse(templateBody(values))
    if (result.success) return
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const field = templateFormField(issue.path as (string | number)[]) ?? 'name'
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
