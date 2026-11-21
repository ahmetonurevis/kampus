import { z } from 'zod'

import type {
  HealthScreeningCreateBody,
  HealthScreeningResultItemBody,
  HealthScreeningRow,
  HealthScreeningStudentRow,
} from '@kampus/react-shared/use-finance-health-screenings.ts'
import {
  HEALTH_SCREENING_KIND_LABELS,
  HEALTH_SCREENING_NOTE_MAX,
  HEALTH_SCREENING_OUTCOME_LABELS,
  HEALTH_SCREENING_STATUS_LABELS,
  healthScreeningResultItemSchema,
  healthScreeningSessionInputSchema,
  acuityHundredthsOf,
  heightMmOf,
  thresholdExceeded,
  weightHgOf,
  type HealthScreeningKind,
  type HealthScreeningOutcome,
} from '@kampus/school-core/lib/finance-health-screenings.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'

/**
 * Sağlık taramaları sekmesinin saf mantığı (DOM-FIN-153; ON-163): oturum formu, hızlı giriş
 * satırının taslağı ve gövdesi, tablo metinleri. Ondalık değer virgülle de yazılır ("142,5").
 * Kural ayrıntısı sunucudadır; satır hatası core şemasının Türkçe iletisidir.
 */

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

const decimalText = (value: number) => String(value).replace('.', ',')

/** "142,5" ya da "142.5" → 142.5; boş ya da sayı değilse `null`. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (normalized === '' || !/^\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

export const sessionStatusBadge = (
  row: Pick<HealthScreeningRow, 'status'>,
): { text: string; tone: Tone } => ({
  text: HEALTH_SCREENING_STATUS_LABELS[row.status],
  tone: row.status === 'published' ? 'green' : 'amber',
})

export const classesText = (row: Pick<HealthScreeningRow, 'classes'>) =>
  row.classes.map((item) => item.name).join(', ')

export const screenedOnText = (day: string) => dateLabel(`${day}T09:00:00Z`)

/** Eşik metni: "BKİ < 14 ya da > 25", "Görme < 0,8", eşik yoksa "Eşik yok". */
export function thresholdText(thresholds: HealthScreeningRow['thresholds']) {
  if ('acuityBelow' in thresholds)
    return thresholds.acuityBelow === null
      ? 'Eşik yok'
      : `Görme < ${decimalText(thresholds.acuityBelow)}`
  const parts = [
    ...(thresholds.bmiBelow === null ? [] : [`< ${decimalText(thresholds.bmiBelow)}`]),
    ...(thresholds.bmiAbove === null ? [] : [`> ${decimalText(thresholds.bmiAbove)}`]),
  ]
  return parts.length === 0 ? 'Eşik yok' : `BKİ ${parts.join(' ya da ')}`
}

type Measurement = NonNullable<NonNullable<HealthScreeningStudentRow['result']>['measurement']>

/** Ölçüm metni: "150 cm · 30 kg · BKİ 13,3" ya da "Sağ 1 · Sol 0,7 · gözlüklü". */
export function measurementText(measurement: Measurement | null) {
  if (measurement === null) return '—'
  if (measurement.kind === 'growth')
    return `${decimalText(measurement.heightCm)} cm · ${decimalText(measurement.weightKg)} kg · BKİ ${decimalText(measurement.bmi)}`
  return `Sağ ${decimalText(measurement.rightAcuity)} · Sol ${decimalText(measurement.leftAcuity)}${measurement.wearsGlasses ? ' · gözlüklü' : ''}`
}

export const outcomeText = (outcome: HealthScreeningOutcome) =>
  HEALTH_SCREENING_OUTCOME_LABELS[outcome]

/** Rapor hücresi: gizli sayı "Gizli (küçük grup)". */
export const referralCellText = (count: number | null) =>
  count === null ? 'Gizli (küçük grup)' : String(count)

// --- Oturum formu --------------------------------------------------------------------------------

const optionalDecimalText = z
  .string()
  .refine((value) => value.trim() === '' || parseDecimal(value) !== null, 'Sayı girin.')

const screeningFormBase = z.object({
  kind: z.enum(['growth', 'vision']),
  screenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarama gününü seçin.'),
  classIds: z.array(z.string()).min(1, 'En az bir sınıf seçin.'),
  performerKind: z.enum(['staff', 'external']),
  performerMembershipId: z.string(),
  performerName: z.string(),
  bmiBelow: optionalDecimalText,
  bmiAbove: optionalDecimalText,
  acuityBelow: optionalDecimalText,
})
export type ScreeningFormValues = z.infer<typeof screeningFormBase>

/** Form şeması: alan biçimi burada, kural core oturum şemasında (aynı iletiler). */
export const screeningFormSchema = screeningFormBase.superRefine((values, ctx) => {
  const parsed = healthScreeningSessionInputSchema.safeParse(screeningCreateBody(values))
  if (parsed.success) return
  for (const issue of parsed.error.issues) {
    const path = screeningFormField(issue.path.map(String).join('.'))
    ctx.addIssue({ code: 'custom', message: issue.message, path: [path ?? 'classIds'] })
  }
})

export const screeningDefaults = (now = new Date()): ScreeningFormValues => ({
  kind: 'growth',
  screenedOn: dayKey(now),
  classIds: [],
  performerKind: 'external',
  performerMembershipId: '',
  performerName: '',
  bmiBelow: '',
  bmiAbove: '',
  acuityBelow: '',
})

const optionalNumber = (text: string) => (text.trim() === '' ? null : parseDecimal(text))

export function screeningCreateBody(values: ScreeningFormValues): HealthScreeningCreateBody {
  const base = {
    screenedOn: values.screenedOn,
    classIds: values.classIds,
    performer:
      values.performerKind === 'staff'
        ? { kind: 'staff' as const, membershipId: values.performerMembershipId }
        : { kind: 'external' as const, name: values.performerName.trim() },
  }
  return values.kind === 'growth'
    ? {
        kind: 'growth',
        ...base,
        thresholds: {
          bmiBelow: optionalNumber(values.bmiBelow),
          bmiAbove: optionalNumber(values.bmiAbove),
        },
      }
    : { kind: 'vision', ...base, thresholds: { acuityBelow: optionalNumber(values.acuityBelow) } }
}

const SCREENING_FIELDS: Readonly<Record<string, keyof ScreeningFormValues>> = {
  kind: 'kind',
  screenedOn: 'screenedOn',
  classIds: 'classIds',
  'performer.membershipId': 'performerMembershipId',
  'performer.name': 'performerName',
  performer: 'performerName',
  'thresholds.bmiBelow': 'bmiBelow',
  'thresholds.bmiAbove': 'bmiAbove',
  'thresholds.acuityBelow': 'acuityBelow',
  thresholds: 'bmiBelow',
}
/** Sunucu ya da core alan yolunu forma eşler; eşlenmeyen yol genel hatadır. */
export function screeningFormField(name: string): keyof ScreeningFormValues | null {
  const [head, second] = name.split('.')
  const key = second === undefined || /^\d+$/.test(second) ? (head ?? '') : `${head}.${second}`
  return SCREENING_FIELDS[key] ?? SCREENING_FIELDS[head ?? ''] ?? null
}

// --- Hızlı giriş ---------------------------------------------------------------------------------

/** Tablo satırının düzenlenen değeri; ölçüm metin olarak tutulur (virgül serbest). */
export interface EntryDraft {
  outcome: HealthScreeningOutcome | ''
  /** Boy (cm) ya da sağ göz. */
  first: string
  /** Kilo (kg) ya da sol göz. */
  second: string
  wearsGlasses: boolean
  referral: boolean
  note: string
}

export function draftOf(row: HealthScreeningStudentRow): EntryDraft {
  const result = row.result
  if (result === null)
    return { outcome: '', first: '', second: '', wearsGlasses: false, referral: false, note: '' }
  const measurement = result.measurement
  return {
    outcome: result.outcome,
    first:
      measurement === null
        ? ''
        : decimalText(
            measurement.kind === 'growth' ? measurement.heightCm : measurement.rightAcuity,
          ),
    second:
      measurement === null
        ? ''
        : decimalText(
            measurement.kind === 'growth' ? measurement.weightKg : measurement.leftAcuity,
          ),
    wearsGlasses: measurement?.kind === 'vision' ? measurement.wearsGlasses : false,
    // Eşikten gelen işaret sunucuda yeniden konur; taslakta yalnız elle konan işaret tutulur.
    referral: result.referralRecommended && !result.thresholdExceeded,
    note: result.note ?? '',
  }
}

const sameDraft = (a: EntryDraft, b: EntryDraft) =>
  a.outcome === b.outcome &&
  a.first.trim() === b.first.trim() &&
  a.second.trim() === b.second.trim() &&
  a.wearsGlasses === b.wearsGlasses &&
  a.referral === b.referral &&
  a.note.trim() === b.note.trim()

export type EntryPlan =
  | { status: 'unchanged' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; item: HealthScreeningResultItemBody }

/**
 * Satırın gövdesi: değişmemiş ya da hiç doldurulmamış satır gönderilmez; geçersiz satır core
 * şemasının iletisini döndürür. Var olan sonuç sürümüyle gider.
 */
export function entryPlan(
  kind: HealthScreeningKind,
  row: HealthScreeningStudentRow,
  draft: EntryDraft,
): EntryPlan {
  if (sameDraft(draft, draftOf(row))) return { status: 'unchanged' }
  if (draft.outcome === '') return { status: 'invalid', message: 'Durumu seçin.' }
  const screened = draft.outcome === 'screened'
  const first = parseDecimal(draft.first)
  const second = parseDecimal(draft.second)
  if (screened && (first === null || second === null))
    return {
      status: 'invalid',
      message: kind === 'growth' ? 'Boy ve kiloyu girin.' : 'İki gözün değerini girin.',
    }
  const measurement =
    !screened || first === null || second === null
      ? null
      : kind === 'growth'
        ? { heightCm: first, weightKg: second }
        : { rightAcuity: first, leftAcuity: second, wearsGlasses: draft.wearsGlasses }
  const item = {
    studentId: row.studentId,
    expectedVersion: row.result?.version ?? null,
    outcome: draft.outcome,
    measurement,
    referralRecommended: screened && draft.referral,
    note: draft.note.trim() === '' ? null : draft.note.trim(),
  }
  const parsed = healthScreeningResultItemSchema.safeParse(item)
  if (!parsed.success)
    return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Satırı düzeltin.' }
  return { status: 'ready', item }
}

/**
 * Taslaktaki ölçüm kurumun eşiğini aşıyor mu (sunucudaki `thresholdExceeded` ile aynı kural):
 * aşıyorsa öneri kutusu işaretli ve kilitli gösterilir.
 */
export function draftThreshold(
  kind: HealthScreeningKind,
  thresholds: HealthScreeningRow['thresholds'],
  draft: EntryDraft,
): boolean {
  if (draft.outcome !== 'screened') return false
  const first = parseDecimal(draft.first)
  const second = parseDecimal(draft.second)
  if (first === null || second === null) return false
  return thresholdExceeded(
    thresholds,
    kind === 'growth'
      ? { kind: 'growth', heightMm: heightMmOf(first), weightHg: weightHgOf(second) }
      : {
          kind: 'vision',
          rightHundredths: acuityHundredthsOf(first),
          leftHundredths: acuityHundredthsOf(second),
          wearsGlasses: draft.wearsGlasses,
        },
  )
}

export const NOTE_MAX = HEALTH_SCREENING_NOTE_MAX
export const kindLabel = (kind: HealthScreeningKind) => HEALTH_SCREENING_KIND_LABELS[kind]
