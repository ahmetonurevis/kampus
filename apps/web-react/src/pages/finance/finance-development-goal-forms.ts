import { z } from 'zod'
import type {
  CreateDevelopmentGoalBody,
  CreateObservationDebriefBody,
  DevelopmentGoalDetail,
  DevelopmentGoalFollowUpBody,
  ObservationDebrief,
  UpdateDevelopmentGoalBody,
  UpdateObservationDebriefBody,
} from '@kampus/react-shared/use-finance-development-goals.ts'
import {
  DEBRIEF_TEXT_MAX,
  DEVELOPMENT_GOAL_CRITERION_MAX,
  DEVELOPMENT_GOAL_NOTE_MAX,
  DEVELOPMENT_GOAL_STATUS_LABELS,
  DEVELOPMENT_GOAL_STATUSES,
  DEVELOPMENT_GOAL_TITLE_MAX,
  type DevelopmentGoalStatus,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'

// Gözlem sonrası görüşme ve gelişim hedefi formlarının saf mantığı (DOM-FIN-133; ON-209): form
// değerleri, sunucu gövdeleri ve durum seçenekleri (K-454, K-455). Bileşen yalnız bağlar; kesin
// doğrulama core şemasıyla sunucudadır.

const text = (label: string, max: number) =>
  z.string().max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)

export const debriefFormSchema = z.object({
  debriefDate: z.string().min(1, 'Görüşme gününü seçin.'),
  participantMembershipIds: z.array(z.string()).min(1, 'Görüşmeye katılanları seçin.'),
  strengths: text('Güçlü yönler', DEBRIEF_TEXT_MAX),
  developmentAreas: text('Gelişim alanları', DEBRIEF_TEXT_MAX),
  teacherComment: text('Öğretmenin görüşü', DEBRIEF_TEXT_MAX),
})
export type DebriefFormValues = z.infer<typeof debriefFormSchema>

/** Yeni görüşme: gözlenen öğretmen ve gözlemci önceden seçilidir (K-454). */
export function emptyDebrief(
  today: string,
  observation: { teacherMembershipId: string; observerMembershipId: string },
): DebriefFormValues {
  return {
    debriefDate: today,
    participantMembershipIds: [
      ...new Set([observation.teacherMembershipId, observation.observerMembershipId]),
    ],
    strengths: '',
    developmentAreas: '',
    teacherComment: '',
  }
}

export function debriefValues(debrief: ObservationDebrief): DebriefFormValues {
  return {
    debriefDate: debrief.debriefDate,
    participantMembershipIds: debrief.participants.map((row) => row.membershipId),
    strengths: debrief.strengths ?? '',
    developmentAreas: debrief.developmentAreas ?? '',
    teacherComment: debrief.teacherComment ?? '',
  }
}

/** Boş metin sunucuda `null` olur; gövde hep tam gönderilir. */
export function debriefBody(
  values: DebriefFormValues,
): CreateObservationDebriefBody & UpdateObservationDebriefBody {
  return {
    debriefDate: values.debriefDate,
    participantMembershipIds: values.participantMembershipIds,
    strengths: values.strengths,
    developmentAreas: values.developmentAreas,
    teacherComment: values.teacherComment,
  }
}

/** Katılımcı seçimini açıp kapatır; gözlenen öğretmen listeden çıkarılamaz. */
export function toggleParticipant(
  selected: readonly string[],
  membershipId: string,
  locked: string,
): string[] {
  if (membershipId === locked) return [...selected]
  return selected.includes(membershipId)
    ? selected.filter((id) => id !== membershipId)
    : [...selected, membershipId]
}

export const goalFormSchema = z.object({
  teacherMembershipId: z.string(),
  title: z
    .string()
    .trim()
    .min(2, 'Hedefi en az 2 karakterle yazın.')
    .max(DEVELOPMENT_GOAL_TITLE_MAX, 'Hedef çok uzun.'),
  successCriterion: z
    .string()
    .trim()
    .min(2, 'Ölçütü en az 2 karakterle yazın.')
    .max(DEVELOPMENT_GOAL_CRITERION_MAX, 'Ölçüt çok uzun.'),
  followUpDate: z.string().min(1, 'Takip tarihini seçin.'),
  performancePeriodId: z.string(),
})
export type GoalFormValues = z.infer<typeof goalFormSchema>

export const emptyGoal = (followUpDate: string): GoalFormValues => ({
  teacherMembershipId: '',
  title: '',
  successCriterion: '',
  followUpDate,
  performancePeriodId: '',
})

/** Kaynak görüşmeyse öğretmen gönderilmez (gözlemden gelir); boş dönem gönderilmez. */
export function goalCreateBody(
  values: GoalFormValues,
  debriefId: string | null,
): CreateDevelopmentGoalBody {
  return {
    ...(debriefId === null ? { teacherMembershipId: values.teacherMembershipId } : { debriefId }),
    title: values.title.trim(),
    successCriterion: values.successCriterion.trim(),
    followUpDate: values.followUpDate,
    ...(values.performancePeriodId === ''
      ? {}
      : { performancePeriodId: values.performancePeriodId }),
  }
}

export function goalValues(goal: DevelopmentGoalDetail): GoalFormValues {
  return {
    teacherMembershipId: goal.teacherMembershipId,
    title: goal.title,
    successCriterion: goal.successCriterion,
    followUpDate: goal.followUpDate,
    performancePeriodId: goal.performancePeriodId ?? '',
  }
}

/** Yalnız değişen alanlar; boş dönem bağı kaldırır. Değişiklik yoksa `null`. */
export function goalUpdateBody(
  goal: DevelopmentGoalDetail,
  values: GoalFormValues,
): UpdateDevelopmentGoalBody | null {
  const body: UpdateDevelopmentGoalBody = {}
  if (values.title.trim() !== goal.title) body.title = values.title.trim()
  if (values.successCriterion.trim() !== goal.successCriterion)
    body.successCriterion = values.successCriterion.trim()
  if (values.followUpDate !== goal.followUpDate) body.followUpDate = values.followUpDate
  const period = values.performancePeriodId === '' ? null : values.performancePeriodId
  if (period !== goal.performancePeriodId) body.performancePeriodId = period
  return Object.keys(body).length === 0 ? null : body
}

export const followUpFormSchema = z.object({
  note: z
    .string()
    .trim()
    .min(2, 'Takip notunu en az 2 karakterle yazın.')
    .max(DEVELOPMENT_GOAL_NOTE_MAX, 'Takip notu çok uzun.'),
  status: z.string(),
  nextFollowUpDate: z.string(),
})
export type FollowUpFormValues = z.infer<typeof followUpFormSchema>
export const emptyFollowUp = (): FollowUpFormValues => ({
  note: '',
  status: '',
  nextFollowUpDate: '',
})

/** Geçilebilecek durumlar (K-455): yalnız ileri. */
export function nextStatuses(status: DevelopmentGoalStatus): DevelopmentGoalStatus[] {
  if (status === 'open') return ['in_progress', 'achieved', 'dropped']
  if (status === 'in_progress') return ['achieved', 'dropped']
  return []
}

const isStatus = (value: string): value is DevelopmentGoalStatus =>
  (DEVELOPMENT_GOAL_STATUSES as readonly string[]).includes(value)

export function followUpBody(values: FollowUpFormValues): DevelopmentGoalFollowUpBody {
  return {
    note: values.note.trim(),
    ...(isStatus(values.status) ? { status: values.status } : {}),
    ...(values.nextFollowUpDate === '' ? {} : { nextFollowUpDate: values.nextFollowUpDate }),
  }
}

export const goalStatusLabel = (status: DevelopmentGoalStatus) =>
  DEVELOPMENT_GOAL_STATUS_LABELS[status]

/** Durum rozetinin tonu: gecikmiş kırmızı, ulaşıldı yeşil, bırakıldı gri. */
export function goalTone(goal: {
  status: DevelopmentGoalStatus
  overdue: boolean
}): 'red' | 'green' | 'gray' | 'amber' {
  if (goal.overdue) return 'red'
  if (goal.status === 'achieved') return 'green'
  if (goal.status === 'dropped') return 'gray'
  return 'amber'
}
