import { z } from 'zod'
import {
  HEALTH_ACCESS_NOTE_MAX,
  HEALTH_ACCESS_NOTE_MIN,
  HEALTH_ACCESS_REASON_CODES,
  healthAccessReasonSchema,
  healthAccessReasonText,
  rememberedReasonValid,
  type HealthAccessReason,
  type RememberedHealthAccessReason,
} from '@kampus/school-core/lib/finance-health-access.ts'

/**
 * Sağlık verisi erişim gerekçesi, web tarafı (DOM-FIN-156; ON-164; K-523…K-525). Seçilen gerekçe
 * yalnız bellekte, kurum + kullanıcı + kapsam anahtarıyla 15 dakika tutulur (K-525); sayfa
 * yenilenince ya da oturum değişince yeniden sorulur. Gerekçe serbest metin taşıyabildiğinden
 * `localStorage`/`sessionStorage`'a yazılmaz. Sunucu her okumayı yine ayrıca kaydeder.
 */

const remembered = new Map<string, RememberedHealthAccessReason>()

/** Kapsam anahtarı: kayıt (`incident:<id>`) ya da görünüm (`infirmary-medications`). */
export function healthAccessScope(
  institutionId: string | null,
  userId: string | null,
  scope: string,
): string {
  return `${institutionId ?? '-'}:${userId ?? '-'}:${scope}`
}

export function recallHealthReason(key: string, now: number): HealthAccessReason | null {
  const entry = remembered.get(key)
  if (rememberedReasonValid(entry, now)) return entry.reason
  remembered.delete(key)
  return null
}

export function rememberHealthReason(key: string, reason: HealthAccessReason, now: number) {
  remembered.set(key, { reason, chosenAt: now })
}

/** Oturum kapanınca ya da testte bellekteki gerekçeler bırakılır. */
export function forgetHealthReasons() {
  remembered.clear()
}

/** Diyalog formu: kod boş başlar; açıklama yalnız "Diğer"de gönderilir. */
export const healthReasonFormSchema = z
  .object({
    code: z.union([z.enum(HEALTH_ACCESS_REASON_CODES), z.literal('')]),
    note: z.string(),
  })
  .transform((values, context) => {
    if (values.code === '') {
      context.addIssue({ code: 'custom', path: ['code'], message: 'Erişim gerekçesini seçin.' })
      return z.NEVER
    }
    const parsed = healthAccessReasonSchema.safeParse({
      code: values.code,
      note: values.code === 'other' ? values.note : null,
    })
    if (parsed.success) return parsed.data
    for (const issue of parsed.error.issues)
      context.addIssue({ code: 'custom', path: issue.path.map(String), message: issue.message })
    return z.NEVER
  })
export type HealthReasonFormValues = z.input<typeof healthReasonFormSchema>
export const healthReasonDefaults = (): HealthReasonFormValues => ({ code: '', note: '' })
export const HEALTH_NOTE_HINT = `Kısa açıklama (${HEALTH_ACCESS_NOTE_MIN}–${HEALTH_ACCESS_NOTE_MAX} karakter).`

// --- Erişim günlüğü ------------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/
const textOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)
const dayOf = (value: unknown) => {
  const text = textOf(value)
  return text !== undefined && DAY.test(text) ? text : undefined
}

/** Liste süzgeçlerinden günlük sorgusu: kişi, öğrenci, gerekçe ve okuma günü aralığı. */
export function healthLogQuery(
  page: number,
  pageSize: number,
  filters: Readonly<Record<string, unknown>>,
) {
  const range = filters.accessedAt
  const bounds =
    typeof range === 'object' && range !== null
      ? { from: dayOf(Reflect.get(range, 'min')), to: dayOf(Reflect.get(range, 'max')) }
      : { from: undefined, to: undefined }
  const reasonCode = HEALTH_ACCESS_REASON_CODES.find((code) => code === filters.reasonCode)
  const actorMembershipId = textOf(filters.actor)
  const studentId = textOf(filters.student)
  return {
    page,
    pageSize,
    ...(actorMembershipId === undefined ? {} : { actorMembershipId }),
    ...(studentId === undefined ? {} : { studentId }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(bounds.from === undefined ? {} : { from: bounds.from }),
    ...(bounds.to === undefined ? {} : { to: bounds.to }),
  }
}

/** Günlük satırının gerekçe metni ("Diğer: <açıklama>"). */
export function healthLogReasonText(row: {
  reasonCode: (typeof HEALTH_ACCESS_REASON_CODES)[number]
  reasonNote: string | null
}) {
  return healthAccessReasonText({ code: row.reasonCode, note: row.reasonNote })
}
