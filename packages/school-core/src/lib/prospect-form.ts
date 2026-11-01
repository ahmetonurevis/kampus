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
}

/** Bugünden itibaren planlı görüşmeler, en yakını önce. Kapalı aday listelenmez. */
export function upcomingMeetings(
  prospects: readonly MeetingProspect[],
  today: string,
): (ProspectMeeting & { id: string; name: string })[] {
  return prospects
    .flatMap((prospect) =>
      prospect.meeting &&
      prospect.stage !== 'Vazgeçti' &&
      prospect.stage !== 'Kayıt oldu' &&
      dayKey(prospect.meeting.date) >= today
        ? [{ ...prospect.meeting, id: prospect.id, name: prospect.name }]
        : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}
