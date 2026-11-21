import { z } from 'zod'
import type {
  CreateObservationPlanBody,
  ObservationPlan,
  PostponeObservationPlanBody,
  UpdateObservationPlanBody,
} from '@kampus/react-shared/use-finance-observation-plans.ts'
import {
  OBSERVATION_PLAN_DURATION_DEFAULT,
  OBSERVATION_PLAN_DURATION_MAX,
  OBSERVATION_PLAN_DURATION_MIN,
  OBSERVATION_PLAN_NOTE_MAX,
  OBSERVATION_PLAN_REASON_MAX,
  OBSERVATION_PLAN_REASON_MIN,
  OPEN_OBSERVATION_PLAN_STATUSES,
  PLAN_TIME_PATTERN,
  type ObservationPlanStatus,
} from '@kampus/school-core/lib/finance-observation-plans.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Gözlem planı formlarının ve takvim listesinin saf mantığı (DOM-FIN-139; ON-207): açma,
// düzeltme ve erteleme gövdeleri, gün gruplaması, durum tonu (K-472…K-474). Bileşen yalnız bağlar;
// kesin kurallar (çakışma, sınır, geçmiş gün) sunucudadır.

const durationField = z
  .string()
  .trim()
  .min(1, 'Süreyi girin.')
  .refine((value) => /^\d+$/.test(value), 'Süre tam dakika olmalı.')
  .refine(
    (value) => {
      const minutes = Number(value)
      return minutes >= OBSERVATION_PLAN_DURATION_MIN && minutes <= OBSERVATION_PLAN_DURATION_MAX
    },
    `Süre ${String(OBSERVATION_PLAN_DURATION_MIN)}–${String(OBSERVATION_PLAN_DURATION_MAX)} dakika olmalı.`,
  )
const timeField = z.string().regex(PLAN_TIME_PATTERN, 'Saati SS:DD biçiminde girin (ör. 09:40).')

export const planFormSchema = z.object({
  templateId: z.string().min(1, 'Gözlem formunu seçin.'),
  teacherMembershipId: z.string().min(1, 'Öğretmeni seçin.'),
  observerMembershipId: z.string().min(1, 'Gözlemciyi seçin.'),
  plannedDate: z.string().min(1, 'Plan gününü seçin.'),
  startTime: timeField,
  durationMinutes: durationField,
  classId: z.string(),
  subjectId: z.string(),
  performancePeriodId: z.string(),
  note: z
    .string()
    .max(
      OBSERVATION_PLAN_NOTE_MAX,
      `Not en fazla ${OBSERVATION_PLAN_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
    ),
})
export type PlanFormValues = z.infer<typeof planFormSchema>

export const emptyPlanForm = (today: string): PlanFormValues => ({
  templateId: '',
  teacherMembershipId: '',
  observerMembershipId: '',
  plannedDate: today,
  startTime: '09:00',
  durationMinutes: String(OBSERVATION_PLAN_DURATION_DEFAULT),
  classId: '',
  subjectId: '',
  performancePeriodId: '',
  note: '',
})

/** Düzeltme formu planın bugünkü değerleriyle açılır (öğretmen değişmez). */
export const planFormValues = (plan: ObservationPlan): PlanFormValues => ({
  templateId: plan.templateId,
  teacherMembershipId: plan.teacherMembershipId,
  observerMembershipId: plan.observerMembershipId,
  plannedDate: plan.plannedDate,
  startTime: plan.startTime,
  durationMinutes: String(plan.durationMinutes),
  classId: plan.classId ?? '',
  subjectId: plan.subjectId ?? '',
  performancePeriodId: plan.performancePeriodId ?? '',
  note: plan.note ?? '',
})

/** Açma gövdesi: boş seçimler gönderilmez. */
export function planCreateBody(values: PlanFormValues): CreateObservationPlanBody {
  return {
    templateId: values.templateId,
    teacherMembershipId: values.teacherMembershipId,
    observerMembershipId: values.observerMembershipId,
    plannedDate: values.plannedDate,
    startTime: values.startTime,
    durationMinutes: Number(values.durationMinutes),
    ...(values.classId === '' ? {} : { classId: values.classId }),
    ...(values.subjectId === '' ? {} : { subjectId: values.subjectId }),
    ...(values.performancePeriodId === ''
      ? {}
      : { performancePeriodId: values.performancePeriodId }),
    ...(values.note.trim() === '' ? {} : { note: values.note }),
  }
}

/**
 * Düzeltme gövdesi: yalnız değişen alanlar. Form seçimi aynı kaldıysa gönderilmez (sunucu son
 * sürümü yazar; form değişmeden sürüm yükseltmek istenmez). Boş seçim bağı kaldırır. Değişiklik
 * yoksa `null`.
 */
export function planUpdateBody(
  values: PlanFormValues,
  plan: ObservationPlan,
): UpdateObservationPlanBody | null {
  const before = planFormValues(plan)
  const body: UpdateObservationPlanBody = {}
  if (values.templateId !== before.templateId) body.templateId = values.templateId
  if (values.observerMembershipId !== before.observerMembershipId)
    body.observerMembershipId = values.observerMembershipId
  if (values.plannedDate !== before.plannedDate) body.plannedDate = values.plannedDate
  if (values.startTime !== before.startTime) body.startTime = values.startTime
  if (Number(values.durationMinutes) !== plan.durationMinutes)
    body.durationMinutes = Number(values.durationMinutes)
  if (values.classId !== before.classId) body.classId = values.classId
  if (values.subjectId !== before.subjectId) body.subjectId = values.subjectId
  if (values.performancePeriodId !== before.performancePeriodId)
    body.performancePeriodId = values.performancePeriodId === '' ? null : values.performancePeriodId
  if (values.note.trim() !== before.note.trim()) body.note = values.note
  return Object.keys(body).length === 0 ? null : body
}

export const postponeFormSchema = z.object({
  plannedDate: z.string().min(1, 'Yeni günü seçin.'),
  startTime: timeField,
  durationMinutes: durationField,
  reason: z
    .string()
    .trim()
    .min(OBSERVATION_PLAN_REASON_MIN, 'Gerekçeyi en az 3 karakterle yazın.')
    .max(
      OBSERVATION_PLAN_REASON_MAX,
      `Gerekçe en fazla ${String(OBSERVATION_PLAN_REASON_MAX)} karakter olabilir.`,
    ),
})
export type PostponeFormValues = z.infer<typeof postponeFormSchema>

export const postponeFormValues = (plan: ObservationPlan): PostponeFormValues => ({
  plannedDate: plan.plannedDate,
  startTime: plan.startTime,
  durationMinutes: String(plan.durationMinutes),
  reason: '',
})

export const postponeBody = (values: PostponeFormValues): PostponeObservationPlanBody => ({
  plannedDate: values.plannedDate,
  startTime: values.startTime,
  durationMinutes: Number(values.durationMinutes),
  reason: values.reason,
})

export const cancelFormSchema = postponeFormSchema.pick({ reason: true })

// --- Takvim --------------------------------------------------------------------------------------

/** Plan açık mı (düzeltilir, ertelenir, iptal edilir, başlatılır). */
export const isOpenPlan = (plan: Pick<ObservationPlan, 'status'>) =>
  (OPEN_OBSERVATION_PLAN_STATUSES as readonly string[]).includes(plan.status)

/** Gözlem başlatılabilir mi: açık, başlamamış ve günü gelmiş (K-473). */
export const canStartPlan = (
  plan: Pick<ObservationPlan, 'status' | 'observationId' | 'plannedDate'>,
  today: string,
) => isOpenPlan(plan) && plan.observationId === null && plan.plannedDate <= today

/** Yalnız planı olan günler, gün sırasıyla; gün içinde saat sırası sunucunun sırasıdır. */
export function plansByDay<T extends Pick<ObservationPlan, 'plannedDate'>>(
  plans: readonly T[],
): { day: string; plans: T[] }[] {
  const days = new Map<string, T[]>()
  for (const plan of plans) {
    const list = days.get(plan.plannedDate)
    if (list === undefined) days.set(plan.plannedDate, [plan])
    else list.push(plan)
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, plans: list }))
}

export const planTimeText = (plan: Pick<ObservationPlan, 'startTime' | 'endTime'>) =>
  `${plan.startTime}–${plan.endTime}`

export const PLAN_STATUS_TONES = {
  planned: 'purple',
  postponed: 'amber',
  done: 'green',
  cancelled: 'gray',
} as const satisfies Record<ObservationPlanStatus, BadgeTone>
