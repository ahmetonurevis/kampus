import { z } from 'zod'

import type {
  JobApplicationBody,
  JobApplicationDetail,
  JobApplicationSettingsBody,
  JobApplicationUpdateBody,
  JobPostingBody,
  JobPostingRow,
} from '@kampus/react-shared/use-finance-job-postings.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  CANDIDATE_NAME_MAX,
  JOB_APPLICATION_CHANNEL_LABELS,
  JOB_APPLICATION_CHANNELS,
  JOB_APPLICATION_NOTE_MAX,
  JOB_APPLICATION_RETENTION_MAX_MONTHS,
  JOB_APPLICATION_RETENTION_MIN_MONTHS,
  JOB_APPLICATION_STAGE_LABELS,
  JOB_APPLICATION_STAGES,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_EMPLOYMENT_TYPES,
  JOB_POSITION_MAX,
  JOB_POSTING_STATUS_LABELS,
  JOB_POSTING_TITLE_MAX,
  JOB_TEXT_MAX,
  PRIVACY_NOTICE_VERSION_MAX,
  type JobApplicationChannel,
  type JobApplicationStage,
  type JobEmploymentType,
  type JobPostingStatus,
} from '@kampus/school-core/lib/finance-job-postings.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * İş ilanları sekmesinin saf mantığı (DOM-FIN-128; ON-177): ilan, başvuru, aşama ve saklama ayarı
 * formlarının şeması, gövdesi ve tablo metinleri. Bileşen yalnız bunları çağırır; kural ayrıntısı
 * sunucudadır (alan hatası `setError` ile forma döner).
 */

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const trimmed = (min: number, max: number, minMessage: string, maxMessage: string) =>
  z.string().trim().min(min, minMessage).max(max, maxMessage)

export const jobPostingFormSchema = z
  .object({
    title: trimmed(
      2,
      JOB_POSTING_TITLE_MAX,
      'İlan başlığı en az 2 karakter olmalı.',
      `İlan başlığı en çok ${String(JOB_POSTING_TITLE_MAX)} karakter olabilir.`,
    ),
    position: trimmed(
      2,
      JOB_POSITION_MAX,
      'Pozisyon en az 2 karakter olmalı.',
      `Pozisyon en çok ${String(JOB_POSITION_MAX)} karakter olabilir.`,
    ),
    employmentType: z.enum(JOB_EMPLOYMENT_TYPES, 'Çalışma türünü seçin.'),
    description: trimmed(
      10,
      JOB_TEXT_MAX,
      'Açıklama en az 10 karakter olmalı.',
      `Açıklama en çok ${String(JOB_TEXT_MAX)} karakter olabilir.`,
    ),
    requirements: z
      .string()
      .trim()
      .max(JOB_TEXT_MAX, `Nitelikler en çok ${String(JOB_TEXT_MAX)} karakter olabilir.`),
    publishOn: daySchema,
    deadlineOn: daySchema,
  })
  .refine((value) => value.deadlineOn >= value.publishOn, {
    path: ['deadlineOn'],
    message: 'Son başvuru günü yayın gününden önce olamaz.',
  })
export type JobPostingFormValues = z.infer<typeof jobPostingFormSchema>

/** Yeni ilan: bugün yayın, 30 gün sonra son başvuru; düzeltmede ilanın değerleri. */
export function jobPostingDefaults(
  today: string,
  posting: JobPostingRow | null,
): JobPostingFormValues {
  if (posting !== null)
    return {
      title: posting.title,
      position: posting.position,
      employmentType: posting.employmentType,
      description: posting.description,
      requirements: posting.requirements ?? '',
      publishOn: posting.publishOn,
      deadlineOn: posting.deadlineOn,
    }
  const deadline = new Date(`${today}T09:00:00.000Z`)
  deadline.setUTCDate(deadline.getUTCDate() + 30)
  return {
    title: '',
    position: '',
    employmentType: 'full_time',
    description: '',
    requirements: '',
    publishOn: today,
    deadlineOn: deadline.toISOString().slice(0, 10),
  }
}

export function jobPostingBody(values: JobPostingFormValues): JobPostingBody {
  const requirements = values.requirements.trim()
  return {
    title: values.title.trim(),
    position: values.position.trim(),
    employmentType: values.employmentType,
    description: values.description.trim(),
    requirements: requirements === '' ? null : requirements,
    publishOn: values.publishOn,
    deadlineOn: values.deadlineOn,
  }
}

const POSTING_FIELDS = [
  'title',
  'position',
  'employmentType',
  'description',
  'requirements',
  'publishOn',
  'deadlineOn',
] as const
/** Sunucu alanını forma eşler; eşleşmeyen alan kök hatadır. */
export function jobPostingFormField(name: string): keyof JobPostingFormValues | null {
  return POSTING_FIELDS.find((field) => field === name) ?? null
}

const candidateNameField = trimmed(
  2,
  CANDIDATE_NAME_MAX,
  'Ad en az 2 karakter olmalı.',
  `Ad en çok ${String(CANDIDATE_NAME_MAX)} karakter olabilir.`,
)
const emailField = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || z.email().safeParse(value).success,
    'Geçerli bir e-posta adresi girin.',
  )
const phoneField = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^0\d{10}$/.test(value.replace(/[\s()-]+/g, '')),
    'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
  )
const noteField = z
  .string()
  .trim()
  .max(
    JOB_APPLICATION_NOTE_MAX,
    `Not en çok ${String(JOB_APPLICATION_NOTE_MAX)} karakter olabilir.`,
  )
const contactRequired = {
  path: ['email'],
  message: 'E-posta ya da telefondan en az birini girin.',
}

export const jobApplicationFormSchema = z
  .object({
    jobPostingId: z.string().min(1, 'İlanı seçin.'),
    candidateName: candidateNameField,
    email: emailField,
    phone: phoneField,
    channel: z.enum(JOB_APPLICATION_CHANNELS, 'Başvuru kanalını seçin.'),
    receivedOn: daySchema,
    privacyNoticeVersion: trimmed(
      1,
      PRIVACY_NOTICE_VERSION_MAX,
      'Aydınlatma metni gösterilmeden başvuru kaydedilemez; gösterilen sürümü yazın.',
      `Sürüm en çok ${String(PRIVACY_NOTICE_VERSION_MAX)} karakter olabilir.`,
    ),
    privacyNoticeShownOn: daySchema,
    note: noteField,
  })
  .refine((value) => value.email !== '' || value.phone !== '', contactRequired)
export type JobApplicationFormValues = z.infer<typeof jobApplicationFormSchema>

/** Başvuru formu: bugün alındı ve gösterildi; sürüm kurum ayarından önerilir. */
export function jobApplicationDefaults(
  today: string,
  jobPostingId: string,
  noticeVersion: string | null,
): JobApplicationFormValues {
  return {
    jobPostingId,
    candidateName: '',
    email: '',
    phone: '',
    channel: 'email',
    receivedOn: today,
    privacyNoticeVersion: noticeVersion ?? '',
    privacyNoticeShownOn: today,
    note: '',
  }
}

const orNull = (value: string) => {
  const text = value.trim()
  return text === '' ? null : text
}

export function jobApplicationBody(
  values: JobApplicationFormValues,
  cvFileId: string | null,
): JobApplicationBody {
  return {
    jobPostingId: values.jobPostingId,
    candidateName: values.candidateName.trim(),
    email: orNull(values.email),
    phone: orNull(values.phone),
    channel: values.channel,
    receivedOn: values.receivedOn,
    cvFileId,
    privacyNoticeVersion: values.privacyNoticeVersion.trim(),
    privacyNoticeShownOn: values.privacyNoticeShownOn,
    note: orNull(values.note),
  }
}

const APPLICATION_FIELDS = [
  'jobPostingId',
  'candidateName',
  'email',
  'phone',
  'channel',
  'receivedOn',
  'privacyNoticeVersion',
  'privacyNoticeShownOn',
  'note',
] as const
export function jobApplicationFormField(name: string): keyof JobApplicationFormValues | null {
  return APPLICATION_FIELDS.find((field) => field === name) ?? null
}

export const jobApplicationEditSchema = z
  .object({
    candidateName: candidateNameField,
    email: emailField,
    phone: phoneField,
    note: noteField,
  })
  .refine((value) => value.email !== '' || value.phone !== '', contactRequired)
export type JobApplicationEditValues = z.infer<typeof jobApplicationEditSchema>

export const jobApplicationEditDefaults = (
  detail: Pick<JobApplicationDetail, 'candidateName' | 'email' | 'phone' | 'note'>,
): JobApplicationEditValues => ({
  candidateName: detail.candidateName,
  email: detail.email ?? '',
  phone: detail.phone ?? '',
  note: detail.note ?? '',
})

/** Düzeltme gövdesi: yalnız değişen alanlar; değişiklik yoksa `null`. */
export function jobApplicationEditBody(
  detail: Pick<JobApplicationDetail, 'candidateName' | 'email' | 'phone' | 'note'>,
  values: JobApplicationEditValues,
): JobApplicationUpdateBody | null {
  const next = {
    candidateName: values.candidateName.trim(),
    email: orNull(values.email)?.toLowerCase() ?? null,
    phone: orNull(values.phone)?.replace(/[\s()-]+/g, '') ?? null,
    note: orNull(values.note),
  }
  const body: JobApplicationUpdateBody = {}
  if (next.candidateName !== detail.candidateName) body.candidateName = next.candidateName
  if (next.email !== detail.email) body.email = next.email
  if (next.phone !== detail.phone) body.phone = next.phone
  if (next.note !== detail.note) body.note = next.note
  return Object.keys(body).length === 0 ? null : body
}
export function jobApplicationEditField(name: string): keyof JobApplicationEditValues | null {
  return name === 'candidateName' || name === 'email' || name === 'phone' || name === 'note'
    ? name
    : null
}

/** Süreç sırası (K-440): ileri aşamalar ve açıksa "reddedildi"; son aşamada boş. */
export function nextStages(stage: JobApplicationStage): JobApplicationStage[] {
  if (stage === 'hired' || stage === 'rejected') return []
  const order = JOB_APPLICATION_STAGES.indexOf(stage)
  // "Reddedildi" listenin sonundadır; ondan önceki ileri aşamalar ve kendisi seçilebilir.
  return JOB_APPLICATION_STAGES.filter(
    (candidate, index) => index > order || candidate === 'rejected',
  )
}

export const jobStageFormSchema = z.object({
  stage: z.enum(JOB_APPLICATION_STAGES, 'Aşamayı seçin.'),
  changedOn: daySchema,
})
export type JobStageFormValues = z.infer<typeof jobStageFormSchema>

export const jobSettingsFormSchema = z.object({
  retentionMonths: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, 'Süreyi tam ay olarak girin.')
    .refine(
      (value) =>
        Number(value) >= JOB_APPLICATION_RETENTION_MIN_MONTHS &&
        Number(value) <= JOB_APPLICATION_RETENTION_MAX_MONTHS,
      `Süre ${String(JOB_APPLICATION_RETENTION_MIN_MONTHS)}–${String(JOB_APPLICATION_RETENTION_MAX_MONTHS)} ay olmalı.`,
    ),
  privacyNoticeVersion: z
    .string()
    .trim()
    .max(
      PRIVACY_NOTICE_VERSION_MAX,
      `Sürüm en çok ${String(PRIVACY_NOTICE_VERSION_MAX)} karakter olabilir.`,
    ),
})
export type JobSettingsFormValues = z.infer<typeof jobSettingsFormSchema>

export const jobSettingsDefaults = (current: {
  retentionMonths: number
  privacyNoticeVersion: string | null
}): JobSettingsFormValues => ({
  retentionMonths: String(current.retentionMonths),
  privacyNoticeVersion: current.privacyNoticeVersion ?? '',
})

/** Ayar gövdesi: yalnız değişen alanlar; değişiklik yoksa `null`. */
export function jobSettingsBody(
  current: { retentionMonths: number; privacyNoticeVersion: string | null },
  values: JobSettingsFormValues,
): JobApplicationSettingsBody | null {
  const months = Number(values.retentionMonths)
  const notice = orNull(values.privacyNoticeVersion)
  const body: JobApplicationSettingsBody = {}
  if (months !== current.retentionMonths) body.retentionMonths = months
  if (notice !== current.privacyNoticeVersion) body.privacyNoticeVersion = notice
  return Object.keys(body).length === 0 ? null : body
}
export function jobSettingsFormField(name: string): keyof JobSettingsFormValues | null {
  return name === 'retentionMonths' || name === 'privacyNoticeVersion' ? name : null
}

export const employmentTypeText = (value: JobEmploymentType) => JOB_EMPLOYMENT_TYPE_LABELS[value]
export const postingStatusText = (value: JobPostingStatus) => JOB_POSTING_STATUS_LABELS[value]
export const channelText = (value: JobApplicationChannel) => JOB_APPLICATION_CHANNEL_LABELS[value]
export const stageText = (value: JobApplicationStage) => JOB_APPLICATION_STAGE_LABELS[value]

/** İlan durum rozeti: yayında ama son başvuru günü geçmişse uyarı. */
export function postingStatusBadge(row: Pick<JobPostingRow, 'status' | 'deadlinePassed'>): {
  text: string
  tone: 'green' | 'amber' | 'gray' | 'purple'
} {
  if (row.status === 'published' && row.deadlinePassed)
    return { text: 'Son başvuru geçti', tone: 'amber' }
  if (row.status === 'published') return { text: 'Yayında', tone: 'green' }
  if (row.status === 'draft') return { text: 'Taslak', tone: 'purple' }
  return { text: 'Kapandı', tone: 'gray' }
}

export function stageTone(stage: JobApplicationStage): 'green' | 'amber' | 'gray' | 'purple' {
  if (stage === 'hired') return 'green'
  if (stage === 'rejected') return 'gray'
  if (stage === 'new') return 'purple'
  return 'amber'
}

/** "3 başvuru · 2 süren"; başvuru yoksa "Başvuru yok". */
export function applicationCountText(
  row: Pick<JobPostingRow, 'applicationCount' | 'openApplicationCount'>,
): string {
  if (row.applicationCount === 0) return 'Başvuru yok'
  return `${String(row.applicationCount)} başvuru · ${String(row.openApplicationCount)} süren`
}

/** Saklama sonu metni; işe alınan ve süren başvuruda "—". */
export const retentionText = (day: string | null) => (day === null ? '—' : dayText(day))
