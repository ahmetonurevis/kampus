import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { dayKey } from './format.ts'
import { PROSPECT_SOURCES, type CreateProspectInput, type ProspectMeeting } from './prospects.ts'

/**
 * Aday ekranlarının saf yardımcıları (web): yeni aday formu ve görüşme listesi. Sunucu kuralı
 * `lib/prospects.ts`'tedir; form yalnız girişi API gövdesine çevirir ve erken uyarı verir.
 */

/**
 * Gösterilen aydınlatma metninin sürümü (DOM-KAY-003). Metnin kendisi hukukçu onayı bekliyor;
 * onaylanınca bu sürüm artırılır, kayıtlar gösterilen sürümü saklar.
 */
export const PROSPECT_PRIVACY_NOTICE_VERSION = 'aydinlatma-2026-1'

export const REFERRAL_SOURCE = 'Veli referansı'

export const prospectFormSchema = z
  .object({
    name: z.string().trim().min(2, 'En az 2 karakter girin.').max(80),
    phone: z
      .string()
      .trim()
      .regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
    email: z.union([z.literal(''), z.email('Geçerli bir e-posta adresi girin.')]),
    branchId: z.string().min(1, 'Kampüs seçin.'),
    interest: z.string().trim().min(2, 'İlgilendiği programı yazın.').max(200),
    source: z.enum(PROSPECT_SOURCES, 'Aday kaynağını seçin.'),
    referrerStudentId: z.string(),
    minor: z.enum(['yes', 'no']),
    guardianName: z.string().trim().max(80),
    siblingOfId: z.string(),
    consentSms: z.boolean(),
    consentEmail: z.boolean(),
    consentCall: z.boolean(),
    privacyShown: z.boolean(),
  })
  .superRefine((value, context) => {
    if (!value.privacyShown)
      context.addIssue({
        code: 'custom',
        path: ['privacyShown'],
        message: 'Aydınlatma metni gösterilmeden aday kaydedilemez.',
      })
    if (value.minor === 'yes' && value.guardianName.length < 2)
      context.addIssue({
        code: 'custom',
        path: ['guardianName'],
        message: '18 yaş altı aday için veli adını girin.',
      })
    if (value.source === REFERRAL_SOURCE && value.referrerStudentId === '')
      context.addIssue({
        code: 'custom',
        path: ['referrerStudentId'],
        message: 'Referans veren öğrenciyi seçin.',
      })
  })
export type ProspectFormValues = z.output<typeof prospectFormSchema>

export function emptyProspectForm(): ProspectFormValues {
  return {
    name: '',
    phone: '',
    email: '',
    branchId: '',
    interest: '',
    source: 'Web sitesi',
    referrerStudentId: '',
    minor: 'yes',
    guardianName: '',
    siblingOfId: '',
    consentSms: false,
    consentEmail: false,
    consentCall: false,
    privacyShown: false,
  }
}

/** Boş metinleri düşürür; yaş seçimi yalnız dil okulunda gönderilir (DOM-KAY-009). */
export function prospectFormToBody(
  values: ProspectFormValues,
  institutionType: InstitutionType,
): CreateProspectInput {
  return {
    name: values.name,
    phone: values.phone,
    ...(values.email === '' ? {} : { email: values.email }),
    branchId: values.branchId,
    interest: values.interest,
    source: values.source,
    ...(values.source === REFERRAL_SOURCE ? { referrerStudentId: values.referrerStudentId } : {}),
    ...(institutionType === 'language_school' ? { minor: values.minor === 'yes' } : {}),
    ...(values.minor === 'yes' ? { guardianName: values.guardianName } : {}),
    ...(values.siblingOfId === '' ? {} : { siblingOfId: values.siblingOfId }),
    privacyNoticeVersion: PROSPECT_PRIVACY_NOTICE_VERSION,
    marketingConsent: {
      sms: values.consentSms,
      email: values.consentEmail,
      call: values.consentCall,
    },
  }
}

/** Europe/Istanbul gün ve saatini ISO anına çevirir; geçersiz girdide `null`. */
export function meetingInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const instant = new Date(`${date}T${time}:00+03:00`)
  return Number.isNaN(+instant) ? null : instant.toISOString()
}

export type MeetingProspect = {
  id: string
  name: string
  stage?: string
  meeting?: ProspectMeeting
  /** Eski kayıtların görüşme anı; süre ve oda taşımaz (`createProspect` öncesi veri). */
  trialAt?: string | null
  /** Dil okulunda planlanmış deneme dersi (DOM-DIL-030). */
  trialLesson?: { lessonId: string; date: string; duration: number }
}

export type UpcomingMeeting = {
  /** Aynı adayın görüşmesi ve deneme dersi ayrı satırdır. */
  key: string
  kind: 'meeting' | 'trial'
  id: string
  name: string
  date: string
  duration: number | null
  room: string | null
}

/**
 * Bugünden itibaren planlı görüşme ve deneme dersleri, en yakını önce. Kapalı aday listelenmez;
 * iptal edilen derse bağlı deneme yapılmamış sayılır (DOM-DIL-030).
 */
export function upcomingMeetings(
  prospects: readonly MeetingProspect[],
  today: string,
  cancelledLessonIds: ReadonlySet<string> = new Set(),
): UpcomingMeeting[] {
  return prospects
    .flatMap((prospect): UpcomingMeeting[] => {
      if (prospect.stage === 'Vazgeçti' || prospect.stage === 'Kayıt oldu') return []
      const rows: UpcomingMeeting[] = []
      const date = prospect.meeting?.date ?? prospect.trialAt
      if (date && dayKey(date) >= today)
        rows.push({
          key: `${prospect.id}-meeting`,
          kind: 'meeting',
          id: prospect.id,
          name: prospect.name,
          date,
          duration: prospect.meeting?.duration ?? null,
          room: prospect.meeting?.room ?? null,
        })
      const trial = prospect.trialLesson
      if (trial && dayKey(trial.date) >= today && !cancelledLessonIds.has(trial.lessonId))
        rows.push({
          key: `${prospect.id}-trial`,
          kind: 'trial',
          id: prospect.id,
          name: prospect.name,
          date: trial.date,
          duration: trial.duration,
          room: null,
        })
      return rows
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

type TrialScheduleLesson = {
  id: string
  classId: string
  date: string
  cancelledAt?: string | null
}
type TrialClass = { id: string; name: string; branchId: string; isActive: boolean }

/** Seçim listesi uzamasın: en yakın dersler yeterlidir. */
const TRIAL_OPTION_LIMIT = 40

/** Adayın kampüsündeki açık grupların iptal edilmemiş gelecek dersleri, en yakını önce. */
export function trialLessonOptions(
  lessons: readonly TrialScheduleLesson[],
  classes: readonly TrialClass[],
  branchId: string,
  now: string,
): { id: string; date: string; className: string }[] {
  const open = new Map(
    classes
      .filter((item) => item.isActive && item.branchId === branchId)
      .map((item) => [item.id, item.name]),
  )
  return lessons
    .flatMap((lesson) => {
      const className = open.get(lesson.classId)
      if (className === undefined || lesson.cancelledAt) return []
      if (Date.parse(lesson.date) <= Date.parse(now)) return []
      return [{ id: lesson.id, date: lesson.date, className }]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, TRIAL_OPTION_LIMIT)
}

/** Geçmiş ve iptal edilmemiş derse bağlı deneme kullanılmıştır, yeniden planlanmaz. */
export function trialLessonUsed(
  trial: { lessonId: string } | undefined,
  lessons: readonly TrialScheduleLesson[],
  now: string,
): boolean {
  if (trial === undefined) return false
  const lesson = lessons.find((item) => item.id === trial.lessonId)
  return lesson !== undefined && !lesson.cancelledAt && Date.parse(lesson.date) <= Date.parse(now)
}

/** Süre ve oda metni; eski kayıtta yoktur. */
export function meetingSummary(meeting: {
  duration: number | null
  room: string | null
}): string | null {
  if (meeting.duration === null && meeting.room === null) return null
  return [meeting.duration === null ? null : `${String(meeting.duration)} dk`, meeting.room]
    .filter(Boolean)
    .join(' · ')
}
