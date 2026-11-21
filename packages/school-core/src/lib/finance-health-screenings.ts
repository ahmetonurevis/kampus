import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'
import { dayKey } from './format.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Okul sağlığı taramaları (docs/domain/finans.md DOM-FIN-153; ON-163; K-514…K-516; H-110).
 *
 * Tarama oturumu (K-514): tür (boy-kilo, görme; liste genişletilebilir), tarama günü, hedef sınıflar
 * (mevcut sınıf kayıtları), yapan (kurumun etkin personeli ya da dış sağlık personelinin adı) ve
 * kurumun bu tarama için tanımladığı eşikler (boy-kiloda beden kitle indeksi alt/üst sınırı,
 * görmede ondalık görme keskinliği alt sınırı). Persentil ya da yaşa göre referans hesabı yapılmaz
 * (protokol doğrulanmalı, H-110); yalnız kurumun eşiği ve taramayı yapanın işareti vardır.
 *
 * Sonuç (K-514): oturumda öğrenci başına tek sonuç; tarandı (ölçümle), katılmadı ya da reddetti.
 * Boy santimetre ve kilo kilogram tek ondalıkla girilir, milimetre ve 100 gram tamsayısı olarak
 * saklanır; beden kitle indeksi sunucuda hesaplanır (tek ondalık). Görme her göz için ondalık
 * keskinlik (0,05–2,00; iki ondalık, yüzdelik tamsayı saklanır) ve gözlük kullanımıdır. Eşik aşılırsa
 * "ileri değerlendirme önerilir" işareti kendiliğinden konur; taramayı yapan eşik dışında da
 * işaretleyebilir. Kısa not veliye görünür.
 *
 * Yayımlama (K-515): açık oturum yayımlanınca sonuçlar ve oturum değişmez; veli kendi çocuğunun
 * sonucunu görür, ileri değerlendirme önerilen her sonuç için "gönderilecek" bildirim kaydı açılır
 * (gerçek gönderim yok). Sınıf raporunda küçük gruplar gizlenir (K-516). Ölçüm ve not özel nitelikli
 * sağlık verisidir; şifreli saklanır, loga ve denetim değerine yazılmaz. Fonksiyonlar saftır; zaman
 * `now` ile gelir.
 */

/** Taramayı yürüten, sonucu yazan ve raporu okuyan roller (K-516; sağlık personeli rolü yok). */
export const FINANCE_HEALTH_SCREENING_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Kendi çocuğunun yayımlanmış sonucunu okuyan rol (K-515). */
export const FINANCE_HEALTH_SCREENING_GUARDIAN_ROLES = ['veli'] as const satisfies readonly Role[]

export const HEALTH_SCREENING_KINDS = ['growth', 'vision'] as const
export type HealthScreeningKind = (typeof HEALTH_SCREENING_KINDS)[number]
export const HEALTH_SCREENING_KIND_LABELS = {
  growth: 'Boy-kilo',
  vision: 'Görme',
} as const satisfies Record<HealthScreeningKind, string>

export const HEALTH_SCREENING_STATUSES = ['open', 'published'] as const
export type HealthScreeningStatus = (typeof HEALTH_SCREENING_STATUSES)[number]
export const HEALTH_SCREENING_STATUS_LABELS = {
  open: 'Açık',
  published: 'Yayımlandı',
} as const satisfies Record<HealthScreeningStatus, string>

export const HEALTH_SCREENING_OUTCOMES = ['screened', 'absent', 'refused'] as const
export type HealthScreeningOutcome = (typeof HEALTH_SCREENING_OUTCOMES)[number]
export const HEALTH_SCREENING_OUTCOME_LABELS = {
  screened: 'Tarandı',
  absent: 'Katılmadı',
  refused: 'Reddetti',
} as const satisfies Record<HealthScreeningOutcome, string>

export const HEALTH_SCREENING_PERFORMER_KINDS = ['staff', 'external'] as const
export type HealthScreeningPerformerKind = (typeof HEALTH_SCREENING_PERFORMER_KINDS)[number]

/** Veli bildirim kaydının durumu (K-515): yalnız kayıt; gönderim yapılmaz. */
export const HEALTH_SCREENING_NOTIFICATION_STATUSES = ['pending'] as const
export type HealthScreeningNotificationStatus =
  (typeof HEALTH_SCREENING_NOTIFICATION_STATUSES)[number]
export const HEALTH_SCREENING_NOTIFICATION_STATUS_LABELS = {
  pending: 'Gönderilecek',
} as const satisfies Record<HealthScreeningNotificationStatus, string>

export const HEALTH_SCREENING_CLASSES_MAX = 40
export const HEALTH_SCREENING_RESULTS_MAX = 100
export const HEALTH_SCREENING_PERFORMER_NAME_MIN = 2
export const HEALTH_SCREENING_PERFORMER_NAME_MAX = 120
export const HEALTH_SCREENING_NOTE_MAX = 500
/** Kâğıttan geç girilen tarama en çok bu kadar gün geriye açılır (K-514). */
export const HEALTH_SCREENING_BACKDATE_DAYS = 180
/** Planlanan tarama en çok bu kadar gün sonrasına açılır (K-514). */
export const HEALTH_SCREENING_AHEAD_DAYS = 90
/** Sınıf raporunda bundan küçük sayılar gizlenir (K-516). */
export const HEALTH_SCREENING_MIN_GROUP = 5

export const HEIGHT_CM_MIN = 40
export const HEIGHT_CM_MAX = 230
export const WEIGHT_KG_MIN = 5
export const WEIGHT_KG_MAX = 250
export const BMI_THRESHOLD_MIN = 10
export const BMI_THRESHOLD_MAX = 50
export const ACUITY_MIN = 0.05
export const ACUITY_MAX = 2
export const ACUITY_THRESHOLD_MIN = 0.1
export const ACUITY_THRESHOLD_MAX = 1

// --- Birimler ------------------------------------------------------------------------------------

const EPSILON = 1e-6
const hasDecimals = (value: number, places: number) => {
  const scaled = value * 10 ** places
  return Math.abs(Math.round(scaled) - scaled) < EPSILON
}
/** Santimetre (tek ondalık) → milimetre tamsayısı. */
export const heightMmOf = (heightCm: number) => Math.round(heightCm * 10)
/** Kilogram (tek ondalık) → 100 gram tamsayısı. */
export const weightHgOf = (weightKg: number) => Math.round(weightKg * 10)
/** Ondalık keskinlik (iki ondalık) → yüzdelik tamsayı. */
export const acuityHundredthsOf = (acuity: number) => Math.round(acuity * 100)

/**
 * Beden kitle indeksi (kg/m², tek ondalık): `kilo / boy²`. Tamsayı birimlerden hesaplanır
 * (`100 g × 10⁶ / mm²` = kg/m² × 10), yuvarlama yalnız sonda yapılır.
 */
export function bmiOf(heightMm: number, weightHg: number): number {
  return Math.round((weightHg * 1_000_000) / (heightMm * heightMm)) / 10
}

// --- Şemalar -------------------------------------------------------------------------------------

const memberId = (message: string) => z.string(message).trim().min(1, message)

const decimal = (label: string, min: number, max: number, places: number, unit: string) =>
  z
    .number(`${label} sayı olmalı.`)
    .min(min, `${label} en az ${String(min).replace('.', ',')}${unit} olmalı.`)
    .max(max, `${label} en çok ${String(max).replace('.', ',')}${unit} olabilir.`)
    .refine(
      (value) => hasDecimals(value, places),
      `${label} en çok ${String(places)} ondalık basamak alır.`,
    )

const performerSchema = z
  .discriminatedUnion(
    'kind',
    [
      z.strictObject({
        kind: z.literal('staff'),
        membershipId: memberId('Taramayı yapan personeli seçin.').describe(
          'Kurumun etkin personel üyeliği',
        ),
      }),
      z.strictObject({
        kind: z.literal('external'),
        // kvkk: K — dış sağlık personelinin adı
        name: z
          .string('Taramayı yapanın adını yazın.')
          .trim()
          .min(
            HEALTH_SCREENING_PERFORMER_NAME_MIN,
            `Ad en az ${String(HEALTH_SCREENING_PERFORMER_NAME_MIN)} karakter olmalı.`,
          )
          .max(
            HEALTH_SCREENING_PERFORMER_NAME_MAX,
            `Ad en çok ${String(HEALTH_SCREENING_PERFORMER_NAME_MAX)} karakter olabilir.`,
          )
          .describe('Dış sağlık personelinin adı ve kurumu (2–120; ör. ASM hemşiresi)'),
      }),
    ],
    { error: 'Taramayı yapanı seçin.' },
  )
  .describe('Taramayı yapan: `staff` kurum personeli ya da `external` dış sağlık personeli')
export type HealthScreeningPerformer = z.output<typeof performerSchema>

const bmiThreshold = (label: string) =>
  decimal(label, BMI_THRESHOLD_MIN, BMI_THRESHOLD_MAX, 1, '')
    .nullable()
    .default(null)
    .describe(`${label} (kg/m², 10–50, tek ondalık); boşsa eşik yok`)

export const growthThresholdsSchema = z
  .strictObject({
    bmiBelow: bmiThreshold('BKİ alt eşiği'),
    bmiAbove: bmiThreshold('BKİ üst eşiği'),
  })
  .refine(
    (value) =>
      value.bmiBelow === null || value.bmiAbove === null || value.bmiBelow < value.bmiAbove,
    { message: 'BKİ alt eşiği üst eşikten küçük olmalı.', path: ['bmiBelow'] },
  )
  .describe('Boy-kilo eşikleri: BKİ alt eşiğin altında ya da üst eşiğin üstündeyse işaret')

export const visionThresholdsSchema = z
  .strictObject({
    acuityBelow: decimal('Görme eşiği', ACUITY_THRESHOLD_MIN, ACUITY_THRESHOLD_MAX, 2, '')
      .nullable()
      .default(null)
      .describe('Görme eşiği (ondalık keskinlik 0,1–1,0); bir göz altındaysa işaret'),
  })
  .describe('Görme eşiği')

export type GrowthThresholds = z.output<typeof growthThresholdsSchema>
export type VisionThresholds = z.output<typeof visionThresholdsSchema>
export type HealthScreeningThresholds = GrowthThresholds | VisionThresholds

const screenedOnSchema = daySchema.describe(
  'Tarama günü (YYYY-MM-DD, Europe/Istanbul); 180 gün geriye, 90 gün ileriye',
)
const classIdsSchema = z
  .array(z.string('Sınıfı seçin.').trim().min(1, 'Sınıfı seçin.').max(100), 'Sınıfları seçin.')
  .min(1, 'En az bir sınıf seçin.')
  .max(
    HEALTH_SCREENING_CLASSES_MAX,
    `En çok ${String(HEALTH_SCREENING_CLASSES_MAX)} sınıf seçilir.`,
  )
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı sınıf iki kez seçilmiş.')
  .describe('Hedef sınıflar (1–40; kurumun sınıf kayıtları)')

const sessionBase = {
  screenedOn: screenedOnSchema,
  classIds: classIdsSchema,
  performer: performerSchema,
}

export const healthScreeningSessionInputSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('growth').describe('Boy-kilo taraması'),
      ...sessionBase,
      thresholds: growthThresholdsSchema.default({ bmiBelow: null, bmiAbove: null }),
    }),
    z.strictObject({
      kind: z.literal('vision').describe('Görme taraması'),
      ...sessionBase,
      thresholds: visionThresholdsSchema.default({ acuityBelow: null }),
    }),
  ],
  { error: 'Tarama türünü seçin.' },
)
export type HealthScreeningSessionInput = z.input<typeof healthScreeningSessionInputSchema>
export type HealthScreeningSessionFields = z.output<typeof healthScreeningSessionInputSchema>

/** Oturum düzeltmesi: verilmeyen alan değişmez; tür değişmez (yanlışsa yeni oturum). */
export const healthScreeningSessionUpdateSchema = z
  .strictObject({
    screenedOn: screenedOnSchema.optional(),
    classIds: classIdsSchema.optional(),
    performer: performerSchema.optional(),
    thresholds: z
      .union([growthThresholdsSchema, visionThresholdsSchema], 'Eşikleri girin.')
      .optional()
      .describe('Türün eşikleri (boy-kiloda `bmiBelow`/`bmiAbove`, görmede `acuityBelow`)'),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'En az bir alanı değiştirin.',
  )
export type HealthScreeningSessionPatch = z.output<typeof healthScreeningSessionUpdateSchema>

// kvkk: Ö — ölçüm; şifreli saklanır, denetime ve loga yazılmaz.
export const growthMeasurementSchema = z
  .strictObject({
    heightCm: decimal('Boy', HEIGHT_CM_MIN, HEIGHT_CM_MAX, 1, ' cm').describe(
      'Boy (cm, 40–230, tek ondalık)',
    ),
    weightKg: decimal('Kilo', WEIGHT_KG_MIN, WEIGHT_KG_MAX, 1, ' kg').describe(
      'Kilo (kg, 5–250, tek ondalık)',
    ),
  })
  .describe('Boy-kilo ölçümü')

const acuity = (label: string) =>
  decimal(label, ACUITY_MIN, ACUITY_MAX, 2, '').describe(
    `${label} (ondalık keskinlik 0,05–2,00; ör. 1,0 = 10/10)`,
  )

// kvkk: Ö — ölçüm; şifreli saklanır.
export const visionMeasurementSchema = z
  .strictObject({
    rightAcuity: acuity('Sağ göz'),
    leftAcuity: acuity('Sol göz'),
    wearsGlasses: z.boolean('Gözlük kullanımını seçin.').describe('Gözlük ya da lensle mi ölçüldü'),
  })
  .describe('Görme ölçümü')

export const healthScreeningResultItemSchema = z.strictObject({
  studentId: memberId('Öğrenciyi seçin.').max(100).describe('Öğrenci kaydı'),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .nullable()
    .default(null)
    .describe('Var olan sonucun sürümü (düzeltmede zorunlu); yeni sonuçta boş'),
  outcome: z
    .enum(HEALTH_SCREENING_OUTCOMES, 'Tarama durumunu seçin.')
    .describe('`screened` tarandı, `absent` katılmadı, `refused` reddetti'),
  measurement: z
    .union([growthMeasurementSchema, visionMeasurementSchema], 'Ölçümü girin.')
    .nullable()
    .default(null)
    .describe('Taranan öğrencide türün ölçümü; katılmayanda boş'),
  referralRecommended: z
    .boolean('İleri değerlendirme işaretini seçin.')
    .default(false)
    .describe('Taramayı yapanın "ileri değerlendirme önerilir" işareti; eşik aşılırsa zaten konur'),
  // kvkk: Ö — kısa not; şifreli saklanır, veliye görünür.
  note: z
    .string('Not metin olmalı.')
    .trim()
    .max(
      HEALTH_SCREENING_NOTE_MAX,
      `Not en çok ${String(HEALTH_SCREENING_NOTE_MAX)} karakter olabilir.`,
    )
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
    .describe('Kısa not (≤ 500; şifreli; veliye görünür)'),
})
export type HealthScreeningResultItem = z.output<typeof healthScreeningResultItemSchema>

export const healthScreeningResultsInputSchema = z.strictObject({
  results: z
    .array(healthScreeningResultItemSchema, 'Sonuçları girin.')
    .min(1, 'En az bir sonuç girin.')
    .max(
      HEALTH_SCREENING_RESULTS_MAX,
      `Bir kayıtta en çok ${String(HEALTH_SCREENING_RESULTS_MAX)} sonuç gönderilir.`,
    )
    .refine(
      (items) => new Set(items.map((item) => item.studentId)).size === items.length,
      'Aynı öğrenci iki kez girilmiş.',
    )
    .describe('Öğrenci başına sonuç (1–100)'),
})
export type HealthScreeningResultsFields = z.output<typeof healthScreeningResultsInputSchema>

// --- Saklanan değer ------------------------------------------------------------------------------

/** Şifreli ölçüm (tamsayı birimler). */
export type StoredMeasurement =
  | { kind: 'growth'; heightMm: number; weightHg: number }
  | { kind: 'vision'; rightHundredths: number; leftHundredths: number; wearsGlasses: boolean }

/** Şifreli sağlık grubu: ölçüm (yalnız taranan öğrencide) ve kısa not. */
export interface HealthScreeningHealth {
  measurement: StoredMeasurement | null
  note: string | null
}

export const healthScreeningHealthSchema = z.strictObject({
  measurement: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('growth'),
        heightMm: z.number().int(),
        weightHg: z.number().int(),
      }),
      z.strictObject({
        kind: z.literal('vision'),
        rightHundredths: z.number().int(),
        leftHundredths: z.number().int(),
        wearsGlasses: z.boolean(),
      }),
    ])
    .nullable(),
  note: z.string().max(HEALTH_SCREENING_NOTE_MAX).nullable(),
}) satisfies z.ZodType<HealthScreeningHealth>

/** API ölçüm görünümü: boy-kiloda BKİ sunucuda hesaplanır. */
export type MeasurementView =
  | { kind: 'growth'; heightCm: number; weightKg: number; bmi: number }
  | { kind: 'vision'; rightAcuity: number; leftAcuity: number; wearsGlasses: boolean }

export function measurementView(measurement: StoredMeasurement): MeasurementView {
  if (measurement.kind === 'growth')
    return {
      kind: 'growth',
      heightCm: measurement.heightMm / 10,
      weightKg: measurement.weightHg / 10,
      bmi: bmiOf(measurement.heightMm, measurement.weightHg),
    }
  return {
    kind: 'vision',
    rightAcuity: measurement.rightHundredths / 100,
    leftAcuity: measurement.leftHundredths / 100,
    wearsGlasses: measurement.wearsGlasses,
  }
}

/** Ölçüm kurumun eşiğini aşıyor mu (K-514); eşik yoksa `false`. Persentil hesabı yoktur. */
export function thresholdExceeded(
  thresholds: HealthScreeningThresholds,
  measurement: StoredMeasurement | null,
): boolean {
  if (measurement === null) return false
  if (measurement.kind === 'growth') {
    if (!('bmiBelow' in thresholds)) return false
    const bmi = bmiOf(measurement.heightMm, measurement.weightHg)
    return (
      (thresholds.bmiBelow !== null && bmi < thresholds.bmiBelow) ||
      (thresholds.bmiAbove !== null && bmi > thresholds.bmiAbove)
    )
  }
  if (!('acuityBelow' in thresholds) || thresholds.acuityBelow === null) return false
  const limit = acuityHundredthsOf(thresholds.acuityBelow)
  return measurement.rightHundredths < limit || measurement.leftHundredths < limit
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflictError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

export type HealthScreeningStaffMember = { role: string; active: boolean } | null

function assertPerformer(
  performer: HealthScreeningPerformer,
  member: HealthScreeningStaffMember | undefined,
) {
  if (performer.kind !== 'staff') return
  const path = ['performer', 'membershipId']
  if (member === null || member === undefined)
    throw ruleError('health_screening_performer_not_found', 'Taramayı yapan bulunamadı.', path)
  if (!(STAFF_ROLES as readonly string[]).includes(member.role))
    throw ruleError(
      'health_screening_performer_not_staff',
      'Taramayı yapan kurum personeli olmalı.',
      path,
    )
  if (!member.active)
    throw ruleError('health_screening_performer_inactive', 'Taramayı yapanın hesabı pasif.', path)
}

function assertScreenedOn(screenedOn: string, now: Date) {
  const today = dayKey(now)
  if (screenedOn < addDays(today, -HEALTH_SCREENING_BACKDATE_DAYS))
    throw ruleError(
      'health_screening_date_too_old',
      `Tarama en çok ${String(HEALTH_SCREENING_BACKDATE_DAYS)} gün geriye açılır.`,
      ['screenedOn'],
    )
  if (screenedOn > addDays(today, HEALTH_SCREENING_AHEAD_DAYS))
    throw ruleError(
      'health_screening_date_too_far',
      `Tarama en çok ${String(HEALTH_SCREENING_AHEAD_DAYS)} gün sonrasına planlanır.`,
      ['screenedOn'],
    )
}

function assertClasses(classIds: readonly string[], existing: ReadonlySet<string>) {
  for (const [index, id] of classIds.entries())
    if (!existing.has(id))
      throw ruleError('health_screening_class_not_found', 'Sınıf bulunamadı.', [
        'classIds',
        String(index),
      ])
}

const thresholdsMatch = (kind: HealthScreeningKind, thresholds: HealthScreeningThresholds) =>
  kind === 'growth' ? 'bmiBelow' in thresholds : 'acuityBelow' in thresholds

export interface HealthScreeningSessionValues {
  kind: HealthScreeningKind
  screenedOn: string
  classIds: string[]
  performer: HealthScreeningPerformer
  thresholds: HealthScreeningThresholds
}

export interface HealthScreeningSessionChecks {
  now: Date
  /** Kurumun arşivlenmemiş sınıf kimlikleri (istenenler arasından). */
  classIds: ReadonlySet<string>
  /** Personelse taramayı yapanın üyeliği (yoksa `null`). */
  performer?: HealthScreeningStaffMember | undefined
}

/**
 * Oturum açma kuralı (K-514): gün 180 gün geriden 90 gün ileriye; sınıflar kurumda; personel
 * yapan kurumun etkin personeli.
 */
export function planHealthScreeningSession(
  input: HealthScreeningSessionFields,
  checks: HealthScreeningSessionChecks,
): HealthScreeningSessionValues {
  assertScreenedOn(input.screenedOn, checks.now)
  assertClasses(input.classIds, checks.classIds)
  assertPerformer(input.performer, checks.performer)
  return {
    kind: input.kind,
    screenedOn: input.screenedOn,
    classIds: input.classIds,
    performer: input.performer,
    thresholds: input.thresholds,
  }
}

/** Yayımlanmış oturum ve sonuçları değişmez (409; veritabanında tetikleyici de korur). */
export function assertHealthScreeningOpen(status: HealthScreeningStatus) {
  if (status === 'published')
    throw conflictError(
      'health_screening_published',
      'Yayımlanmış tarama değiştirilemez; düzeltme için yeni tarama açın.',
    )
}

/**
 * Oturum düzeltmesi (K-514): verilen alanlar birleşir. Sonuç girilmişse eşik değişmez, sonucu olan
 * sınıf çıkarılmaz ve gün bugünden sonraya alınmaz. Değişiklik yoksa 422. Değişen alan adları döner.
 */
export function planHealthScreeningSessionUpdate(
  current: HealthScreeningSessionValues & { status: HealthScreeningStatus },
  patch: HealthScreeningSessionPatch,
  checks: HealthScreeningSessionChecks & {
    resultCount: number
    /** Sonucu olan sınıflar (sonuç girildiği andaki sınıf). */
    classesWithResults: ReadonlySet<string>
  },
): { values: HealthScreeningSessionValues; changed: string[] } {
  assertHealthScreeningOpen(current.status)
  if (patch.thresholds !== undefined && !thresholdsMatch(current.kind, patch.thresholds))
    throw ruleError('health_screening_thresholds_kind', 'Eşikler tarama türüne uymuyor.', [
      'thresholds',
    ])
  const values: HealthScreeningSessionValues = {
    kind: current.kind,
    screenedOn: patch.screenedOn ?? current.screenedOn,
    classIds: patch.classIds ?? current.classIds,
    performer: patch.performer ?? current.performer,
    thresholds: patch.thresholds ?? current.thresholds,
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const changed = [
    ...(values.screenedOn === current.screenedOn ? [] : ['screenedOn']),
    ...(same(values.classIds, current.classIds) ? [] : ['classIds']),
    ...(same(values.performer, current.performer) ? [] : ['performer']),
    ...(same(values.thresholds, current.thresholds) ? [] : ['thresholds']),
  ]
  if (changed.length === 0)
    throw ruleError('health_screening_unchanged', 'Taramada değişiklik yok.', [])
  if (changed.includes('screenedOn')) {
    assertScreenedOn(values.screenedOn, checks.now)
    if (checks.resultCount > 0 && values.screenedOn > dayKey(checks.now))
      throw ruleError(
        'health_screening_date_locked',
        'Sonuç girilmiş tarama bugünden sonraya alınamaz.',
        ['screenedOn'],
      )
  }
  if (changed.includes('thresholds') && checks.resultCount > 0)
    throw ruleError(
      'health_screening_thresholds_locked',
      'Sonuç girildikten sonra eşik değişmez.',
      ['thresholds'],
    )
  if (changed.includes('classIds')) {
    assertClasses(
      values.classIds.filter((id) => !current.classIds.includes(id)),
      checks.classIds,
    )
    const kept = new Set(values.classIds)
    for (const id of checks.classesWithResults)
      if (!kept.has(id))
        throw ruleError(
          'health_screening_class_has_results',
          'Sonuç girilmiş sınıf taramadan çıkarılamaz.',
          ['classIds'],
        )
  }
  if (changed.includes('performer')) assertPerformer(values.performer, checks.performer)
  return { values, changed }
}

/** Var olan sonuç (şifre çözülmüş). */
export interface ExistingHealthScreeningResult {
  id: string
  version: number
  outcome: HealthScreeningOutcome
  referralRecommended: boolean
  health: HealthScreeningHealth
}

export interface HealthScreeningStudent {
  /** Öğrencinin güncel sınıfı. */
  classId: string | null
  active: boolean
}

export type HealthScreeningResultWrite =
  | {
      kind: 'create'
      studentId: string
      classId: string
      outcome: HealthScreeningOutcome
      referralRecommended: boolean
      health: HealthScreeningHealth
    }
  | {
      kind: 'update'
      id: string
      studentId: string
      expectedVersion: number
      outcome: HealthScreeningOutcome
      referralRecommended: boolean
      health: HealthScreeningHealth
    }

function storedMeasurement(
  kind: HealthScreeningKind,
  item: HealthScreeningResultItem,
  path: string[],
): StoredMeasurement | null {
  if (item.outcome !== 'screened') {
    if (item.measurement !== null)
      throw ruleError(
        'health_screening_measurement_not_allowed',
        'Taranmayan öğrenciye ölçüm girilmez.',
        [...path, 'measurement'],
      )
    if (item.referralRecommended)
      throw ruleError(
        'health_screening_referral_not_screened',
        'Taranmayan öğrenciye ileri değerlendirme önerilmez.',
        [...path, 'referralRecommended'],
      )
    return null
  }
  if (item.measurement === null)
    throw ruleError('health_screening_measurement_required', 'Ölçümü girin.', [
      ...path,
      'measurement',
    ])
  if (kind === 'growth' && 'heightCm' in item.measurement)
    return {
      kind: 'growth',
      heightMm: heightMmOf(item.measurement.heightCm),
      weightHg: weightHgOf(item.measurement.weightKg),
    }
  if (kind === 'vision' && 'rightAcuity' in item.measurement)
    return {
      kind: 'vision',
      rightHundredths: acuityHundredthsOf(item.measurement.rightAcuity),
      leftHundredths: acuityHundredthsOf(item.measurement.leftAcuity),
      wearsGlasses: item.measurement.wearsGlasses,
    }
  throw ruleError(
    'health_screening_measurement_kind',
    `Ölçüm ${HEALTH_SCREENING_KIND_LABELS[kind].toLocaleLowerCase('tr')} taramasına uymuyor.`,
    [...path, 'measurement'],
  )
}

/**
 * Sonuç girişi (K-514): oturum açık ve tarama günü gelmiş olmalı. Yeni sonuç yalnız hedef sınıfta
 * okuyan etkin öğrenciye yazılır; öğrencinin sonucu varsa düzeltme sürümüyle gelir (yoksa 409
 * `health_screening_result_exists`; oturumda öğrenci başına tek sonuç). Eşik aşılırsa ileri
 * değerlendirme işareti kendiliğinden konur. Değişmeyen satır yazılmaz.
 */
export function planHealthScreeningResults(
  session: {
    status: HealthScreeningStatus
    kind: HealthScreeningKind
    screenedOn: string
    classIds: readonly string[]
    thresholds: HealthScreeningThresholds
  },
  input: HealthScreeningResultsFields,
  checks: {
    now: Date
    students: ReadonlyMap<string, HealthScreeningStudent>
    existing: ReadonlyMap<string, ExistingHealthScreeningResult>
  },
): { writes: HealthScreeningResultWrite[]; unchanged: number } {
  assertHealthScreeningOpen(session.status)
  if (session.screenedOn > dayKey(checks.now))
    throw ruleError('health_screening_not_started', 'Tarama günü gelmeden sonuç girilmez.', [])
  const targets = new Set(session.classIds)
  const writes: HealthScreeningResultWrite[] = []
  let unchanged = 0
  for (const [index, item] of input.results.entries()) {
    const path = ['results', String(index)]
    const current = checks.existing.get(item.studentId)
    const measurement = storedMeasurement(session.kind, item, path)
    const health: HealthScreeningHealth = { measurement, note: item.note }
    const referralRecommended =
      item.referralRecommended || thresholdExceeded(session.thresholds, measurement)
    if (current === undefined) {
      if (item.expectedVersion !== null)
        throw conflictError('health_screening_result_missing', 'Düzeltilecek sonuç bulunamadı.', [
          ...path,
          'expectedVersion',
        ])
      const student = checks.students.get(item.studentId)
      if (student === undefined || !student.active)
        throw ruleError('health_screening_student_not_found', 'Öğrenci bulunamadı.', [
          ...path,
          'studentId',
        ])
      if (student.classId === null || !targets.has(student.classId))
        throw ruleError(
          'health_screening_student_not_in_classes',
          'Öğrenci taramanın sınıflarında değil.',
          [...path, 'studentId'],
        )
      writes.push({
        kind: 'create',
        studentId: item.studentId,
        classId: student.classId,
        outcome: item.outcome,
        referralRecommended,
        health,
      })
      continue
    }
    if (item.expectedVersion === null)
      throw conflictError(
        'health_screening_result_exists',
        'Öğrencinin bu taramada sonucu var; düzeltmek için güncel sonucu açın.',
        [...path, 'studentId'],
      )
    if (item.expectedVersion !== current.version)
      throw conflictError(
        'version_conflict',
        'Sonuç başka biri tarafından değiştirildi. Listeyi yenileyin.',
        [...path, 'expectedVersion'],
      )
    if (
      current.outcome === item.outcome &&
      current.referralRecommended === referralRecommended &&
      JSON.stringify(current.health) === JSON.stringify(health)
    ) {
      unchanged += 1
      continue
    }
    writes.push({
      kind: 'update',
      id: current.id,
      studentId: item.studentId,
      expectedVersion: current.version,
      outcome: item.outcome,
      referralRecommended,
      health,
    })
  }
  return { writes, unchanged }
}

/** Yayımlama (K-515): açık oturum, tarama günü gelmiş ve en az bir sonuç girilmiş olmalı. */
export function assertHealthScreeningPublish(input: {
  status: HealthScreeningStatus
  screenedOn: string
  resultCount: number
  now: Date
}) {
  assertHealthScreeningOpen(input.status)
  if (input.screenedOn > dayKey(input.now))
    throw ruleError('health_screening_not_started', 'Tarama günü gelmeden yayımlanmaz.', [])
  if (input.resultCount === 0)
    throw ruleError('health_screening_no_results', 'Sonuç girilmeden tarama yayımlanmaz.', [])
}

// --- Sınıf raporu --------------------------------------------------------------------------------

/** Bir grubun sayıları; `referral` küçük grupta gizlidir (`null`, K-516). */
export interface HealthScreeningGroupCounts {
  roster: number
  screened: number
  absent: number
  refused: number
  missing: number
  referral: number | null
  referralSuppressed: boolean
}

const small = (count: number) => count > 0 && count < HEALTH_SCREENING_MIN_GROUP

/**
 * İleri değerlendirme sayısı gösterilebilir mi (K-516): taranan en az 5 ve ne öneri sayısı ne de
 * önerilmeyen sayısı 1–4 aralığında (tek öğrenci ya da "hepsi önerildi" çıkarımı olmaz).
 */
export const referralVisible = (screened: number, referral: number) =>
  screened >= HEALTH_SCREENING_MIN_GROUP && !small(referral) && !small(screened - referral)

export interface HealthScreeningReportInput {
  classId: string
  /** Sınıfın bugünkü etkin öğrencileri. */
  rosterStudentIds: readonly string[]
  /** Bu sınıfta girilmiş sonuçlar (sonuç girildiği andaki sınıf). */
  results: readonly {
    studentId: string
    outcome: HealthScreeningOutcome
    referralRecommended: boolean
  }[]
}

function groupCounts(
  rosterIds: readonly string[],
  results: HealthScreeningReportInput['results'],
): Omit<HealthScreeningGroupCounts, 'referral' | 'referralSuppressed'> & { rawReferral: number } {
  const resulted = new Set(results.map((item) => item.studentId))
  const count = (outcome: HealthScreeningOutcome) =>
    results.filter((item) => item.outcome === outcome).length
  return {
    roster: rosterIds.length,
    screened: count('screened'),
    absent: count('absent'),
    refused: count('refused'),
    missing: rosterIds.filter((id) => !resulted.has(id)).length,
    rawReferral: results.filter((item) => item.referralRecommended).length,
  }
}

/**
 * Sınıf bazında katılım ve öneri sayısı (K-516). Katılım sayıları açıktır; öneri sayısı küçük
 * grupta gizlenir. Toplamda öneri yalnız gizli sınıf yoksa ya da en az iki sınıf gizliyse ve toplam
 * kendi başına gösterilebiliyorsa döner (tek gizli sınıf toplamdan çıkarılamaz).
 */
export function healthScreeningReport(classes: readonly HealthScreeningReportInput[]) {
  const rows = classes.map((item) => {
    const { rawReferral, ...counts } = groupCounts(item.rosterStudentIds, item.results)
    const visible = referralVisible(counts.screened, rawReferral)
    return {
      classId: item.classId,
      ...counts,
      rawReferral,
      referral: visible ? rawReferral : null,
      referralSuppressed: !visible,
    }
  })
  const hidden = rows.filter((row) => row.referralSuppressed).length
  const sum = (key: 'roster' | 'screened' | 'absent' | 'refused' | 'missing' | 'rawReferral') =>
    rows.reduce((total, row) => total + row[key], 0)
  const screened = sum('screened')
  const referral = sum('rawReferral')
  const totalVisible = referralVisible(screened, referral) && (hidden === 0 || hidden >= 2)
  const total: HealthScreeningGroupCounts = {
    roster: sum('roster'),
    screened,
    absent: sum('absent'),
    refused: sum('refused'),
    missing: sum('missing'),
    referral: totalVisible ? referral : null,
    referralSuppressed: !totalVisible,
  }
  return {
    classes: rows.map(({ rawReferral: _raw, ...row }) => row),
    total,
  }
}
