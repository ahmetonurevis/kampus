import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { DomainError } from './errors.ts'
import { isCustodial, type GuardianLink } from './guardianship.ts'
import type { LearnerAgeFacts } from './notifications.ts'
import { permissionDecider } from './permission-forms.ts'

/**
 * Öğrencinin sağlık ve acil bilgisi (IST-020; docs/domain/iletisim-ve-veli.md DOM-ILT-035,
 * okuma denetimi docs/domain/yetki-ve-kapsam.md DOM-YTK-052). Saf kurallar: girdi şeması, erişim
 * düzeyi, yazma yetkisi ve acil görünüm projeksiyonu. Bütün alanlar özel nitelikli veridir
 * (KVKK m.6; sınıf Ö): API'de `records.data`'ya değil, ayrı tabloda kurum anahtarıyla şifreli
 * tutulur (guvenlik-kvkk.md §8). En az veri: kısa yapılandırılmış listeler, serbest uzun not yok.
 *
 * Erişim (Sabah kararı 98):
 * - Tam okuma: yönetici; öğrencinin sınıfının rehber öğretmeni; 18 yaş altı öğrencinin velayetli
 *   ve iletişim kısıtı olmayan velisi; 18 yaşını doldurmuş öğrencinin kendisi.
 * - Acil okuma (`emergencyView`): öğrencinin sınıfına derse giren öğretmen.
 * - Yazma: yönetici; 18 yaş altı öğrencinin velayetli ve kısıtsız velisi; 18+ öğrenci kendisi.
 * - Ön büro, diğer öğretmenler, reşit olmayan öğrencinin kendisi: erişim yok. Yetişkinlik
 *   izin formuyla aynı kuraldır (`permissionDecider`, DOM-ILT-037): velayet 18 yaşta biter,
 *   yetişkin öğrencinin verisi veliye açılmaz.
 *
 * TODO(IST-020-etkinlik): etkinlik ve servis sorumlusunun acil okuması (DOM-ILT-035); sorumlu
 * modeli olmadığından bugün kapalıdır.
 */

/** İşlemenin hukuki dayanağı (KVKK m.6/3); şifresiz kısa kod olarak saklanır. */
export const HEALTH_LEGAL_BASES = {
  explicit_consent: { label: 'Açık rıza' },
  vital_interest: { label: 'Hayat ve beden bütünlüğünün korunması' },
  legal_obligation: { label: 'Kanuni yükümlülük' },
} as const satisfies Record<string, { label: string }>
export type HealthLegalBasis = keyof typeof HEALTH_LEGAL_BASES
export const HEALTH_LEGAL_BASIS_KEYS = Object.keys(HEALTH_LEGAL_BASES) as [
  HealthLegalBasis,
  ...HealthLegalBasis[],
]

/** Alerji şiddeti; acil müdahale önceliği için. */
export const ALLERGY_SEVERITIES = {
  mild: { label: 'Hafif' },
  moderate: { label: 'Orta' },
  severe: { label: 'Ağır (anafilaksi riski)' },
} as const satisfies Record<string, { label: string }>
export type AllergySeverity = keyof typeof ALLERGY_SEVERITIES
const ALLERGY_SEVERITY_KEYS = Object.keys(ALLERGY_SEVERITIES) as [
  AllergySeverity,
  ...AllergySeverity[],
]

/** Liste başına en çok kalem; en az veri ilkesiyle kısa tutulur. */
export const HEALTH_LIST_MAX = 20
export const HEALTH_NAME_MAX = 80
export const HEALTH_EMERGENCY_MAX = 500

const shortName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} boş olamaz.`)
    .max(HEALTH_NAME_MAX, `${label} en çok ${HEALTH_NAME_MAX} karakter olabilir.`)

/** Listede aynı ad (büyük/küçük harf farkı gözetmeden) iki kez geçemez. */
function uniqueNames<T>(items: readonly T[], nameOf: (item: T) => string, ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const key = nameOf(item).toLocaleLowerCase('tr-TR')
    if (seen.has(key))
      ctx.addIssue({ code: 'custom', path: [index], message: 'Aynı kalem iki kez yazılamaz.' })
    seen.add(key)
  })
}

const list = <T extends z.ZodType>(item: T, nameOf: (value: z.output<T>) => string) =>
  z
    .array(item)
    .max(HEALTH_LIST_MAX, `En çok ${HEALTH_LIST_MAX} kalem yazılabilir.`)
    .default([])
    .superRefine((items, ctx) => uniqueNames(items, nameOf, ctx))

const allergySchema = z.strictObject({
  // kvkk: Ö — alerjen adı
  name: shortName('Alerji adı'),
  // kvkk: Ö
  severity: z.enum(ALLERGY_SEVERITY_KEYS, 'Alerjinin şiddetini seçin.'),
})

const medicationSchema = z.strictObject({
  // kvkk: Ö — ilaç adı
  name: shortName('İlaç adı'),
  // kvkk: Ö — kullanım düzeni (ör. "sabah 1 tablet")
  schedule: shortName('Kullanım düzeni').optional(),
  // kvkk: Ö — okulda verilmesi gerekiyor mu
  atSchool: z.boolean().default(false),
})

const namedItem = (label: string) => z.strictObject({ name: shortName(label) })

/**
 * Şifreli saklanan içerik. Hukuki dayanak ve sürüm içerikte değil, tablonun kendi kolonlarındadır
 * (`healthProfileInputSchema`).
 */
export const healthProfileContentSchema = z.strictObject({
  // kvkk: Ö
  allergies: list(allergySchema, (item) => item.name),
  // kvkk: Ö
  chronicConditions: list(namedItem('Kronik durum'), (item) => item.name),
  // kvkk: Ö
  medications: list(medicationSchema, (item) => item.name),
  // kvkk: Ö — destek veya engellilik ihtiyacı (ör. "işitme cihazı", "asansör")
  supportNeeds: list(namedItem('Destek ihtiyacı'), (item) => item.name),
  // kvkk: Ö — acil müdahale talimatı (ör. "adrenalin oto-enjektörü çantada")
  emergencyInstructions: z
    .string()
    .trim()
    .max(
      HEALTH_EMERGENCY_MAX,
      `Acil müdahale bilgisi en çok ${HEALTH_EMERGENCY_MAX} karakter olabilir.`,
    )
    .default(''),
})
export type HealthProfileContent = z.output<typeof healthProfileContentSchema>

/** Yazma girdisi: içerik, hukuki dayanak ve iyimser kilit için beklenen sürüm. */
export const healthProfileInputSchema = healthProfileContentSchema.extend({
  legalBasis: z.enum(HEALTH_LEGAL_BASIS_KEYS, 'İşlemenin hukuki dayanağını seçin.'),
  /** İlk yazımda 1 (kayıt yok); sonra okunan sürüm. */
  version: z.number().int().min(1),
})
export type HealthProfileInput = z.input<typeof healthProfileInputSchema>
export type HealthProfileWrite = z.output<typeof healthProfileInputSchema>

const contentFields = healthProfileContentSchema.shape
const CONTENT_FIELD_KEYS = Object.keys(contentFields) as (keyof HealthProfileContent)[]

/**
 * Kısmi güncelleme girdisi (API `PATCH`): içerik alanlarının varsayılansız hali; gönderilmeyen
 * alan "değişmez" demektir (boş liste göndermek listeyi boşaltır). `legalBasis` gönderilmezse
 * mevcut dayanak kalır; `version` zorunludur. En az bir içerik alanı ya da `legalBasis` gerekir:
 * kayıt varken yalnız dayanak değişikliği meşrudur (rıza geri çekme, dayanak değişimi; depo
 * içeriği yeni dayanağa bağlı olarak yeniden şifreler). Kayıt yokken içerik alanı olmadan boş
 * profil açılmaz (`applyHealthProfilePatch`). Birleşmiş sonuç `applyHealthProfilePatch` ile tam
 * şemada doğrulanır.
 */
export const healthProfilePatchSchema = z
  .strictObject({
    allergies: contentFields.allergies.removeDefault().optional(),
    chronicConditions: contentFields.chronicConditions.removeDefault().optional(),
    medications: contentFields.medications.removeDefault().optional(),
    supportNeeds: contentFields.supportNeeds.removeDefault().optional(),
    emergencyInstructions: contentFields.emergencyInstructions.removeDefault().optional(),
    legalBasis: healthProfileInputSchema.shape.legalBasis.optional(),
    version: healthProfileInputSchema.shape.version,
  })
  .refine(
    (patch) =>
      patch.legalBasis !== undefined || CONTENT_FIELD_KEYS.some((key) => patch[key] !== undefined),
    {
      message: 'En az bir sağlık bilgisi alanı ya da hukuki dayanak gönderin.',
      path: ['allergies'],
    },
  )
export type HealthProfilePatchInput = z.input<typeof healthProfilePatchSchema>
export type HealthProfilePatch = z.output<typeof healthProfilePatchSchema>

/**
 * Kısmi güncellemeyi mevcut profille birleştirir ve sonucu tam yazma şemasında doğrular (Zod
 * hatası 400): gönderilen alan değişir, gönderilmeyen aynen kalır. Kayıt yoksa (`current: null`)
 * gönderilmeyen alanlar boştur, `legalBasis` zorunludur ve en az bir içerik alanı gerekir (yalnız
 * dayanakla boş profil açılmaz).
 */
export function applyHealthProfilePatch(
  current: { content: HealthProfileContent; legalBasis: HealthLegalBasis } | null,
  patch: HealthProfilePatch,
): HealthProfileWrite {
  if (current === null && !CONTENT_FIELD_KEYS.some((key) => patch[key] !== undefined))
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['allergies'],
        message: 'Kayıt yokken en az bir sağlık bilgisi alanı gönderin.',
        input: patch,
      },
    ])
  const merged: Record<string, unknown> = {
    ...(current?.content ?? {}),
    legalBasis: patch.legalBasis ?? current?.legalBasis,
    version: patch.version,
  }
  for (const key of CONTENT_FIELD_KEYS) if (patch[key] !== undefined) merged[key] = patch[key]
  return healthProfileInputSchema.parse(merged)
}

/** Acil müdahale için gereken alanlar: alerji adı ve şiddeti, acil talimat (DOM-ILT-035). */
export type HealthEmergencyView = {
  allergies: { name: string; severity: AllergySeverity }[]
  emergencyInstructions: string
}

export function emergencyView(content: HealthProfileContent): HealthEmergencyView {
  return {
    allergies: content.allergies.map(({ name, severity }) => ({ name, severity })),
    emergencyInstructions: content.emergencyInstructions,
  }
}

export type HealthAccess = 'full' | 'emergency' | 'none'

/**
 * Aktörün bu öğrenciyle bağı; API kapsam kaynağından kurar. Öğretmende `homeroom` öğrencinin
 * güncel sınıfının rehberi (`classes.teacherId`), `teachesClass` o sınıfa ders ataması; ikisi de
 * yalnız etkin öğretmen kaydında doğrudur. Velide `bonds` bu hesabın bu öğrencideki etkin bağları
 * (`student_guardians`).
 */
export type HealthActor =
  | { role: 'yonetici' }
  | { role: 'onburo' }
  | { role: 'ogretmen'; homeroom: boolean; teachesClass: boolean }
  | { role: 'veli'; bonds: readonly Pick<GuardianLink, 'custody' | 'contactRestricted'>[] }
  | { role: 'ogrenci'; self: boolean }

export type HealthAccessInput = {
  actor: HealthActor
  /** Öğrencinin yaş bilgisi (kimlik satırının doğum tarihi, dil okulunda adayın seçimi). */
  learner: LearnerAgeFacts
  institutionType: InstitutionType
  now: string
}

type Decision = { access: HealthAccess; write: boolean; reason: 'unrelated' | 'forbidden' | null }

const allow = (access: 'full' | 'emergency', write: boolean): Decision => ({
  access,
  write,
  reason: null,
})
const deny = (reason: 'unrelated' | 'forbidden'): Decision => ({
  access: 'none',
  write: false,
  reason,
})

const isAdultLearner = (input: HealthAccessInput) =>
  permissionDecider(input.learner, { institutionType: input.institutionType, now: input.now }) ===
  'self'

function decide(input: HealthAccessInput): Decision {
  const { actor } = input
  switch (actor.role) {
    case 'yonetici':
      return allow('full', true)
    case 'onburo':
      return deny('forbidden')
    case 'ogretmen':
      if (actor.homeroom) return allow('full', false)
      if (actor.teachesClass) return allow('emergency', false)
      return deny('unrelated')
    case 'veli':
      // Kısıtlı ya da velayetsiz veli öğrenciyi kapsamında görmez (DOM-ILT-070): 404.
      if (!actor.bonds.some(isCustodial)) return deny('unrelated')
      return isAdultLearner(input) ? deny('forbidden') : allow('full', true)
    case 'ogrenci':
      if (!actor.self) return deny('unrelated')
      return isAdultLearner(input) ? allow('full', true) : deny('forbidden')
    default:
      actor satisfies never
      return deny('forbidden')
  }
}

/** Okuma düzeyi: tam, yalnız acil ya da yok (DOM-ILT-035). */
export const healthAccessFor = (input: HealthAccessInput): HealthAccess => decide(input).access

/** Yazma (oluşturma ve güncelleme) yetkisi (DOM-ILT-035). */
export const canWriteHealthProfile = (input: HealthAccessInput): boolean => decide(input).write

function denial(reason: 'unrelated' | 'forbidden', write: boolean): DomainError {
  if (reason === 'unrelated')
    return new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  return write
    ? new DomainError(
        'health_profile_write_forbidden',
        'Sağlık ve acil bilgiyi değiştirme yetkiniz yok.',
        { kind: 'forbidden' },
      )
    : new DomainError('health_profile_forbidden', 'Sağlık ve acil bilgiye erişim yetkiniz yok.', {
        kind: 'forbidden',
      })
}

/**
 * Okuma düzeyini döndürür, erişim yoksa fırlatır: kapsam dışı öğrenci (ilgisiz öğretmen, bağı
 * olmayan ya da kısıtlı veli, başka öğrenci) 404 `student_not_found`; rolü yetmeyen (ön büro,
 * reşit olmayan öğrencinin kendisi, yetişkin öğrencinin velisi) 403 `health_profile_forbidden`.
 * Her tam ve acil okuma denetim kaydına düzeyiyle yazılır (DOM-YTK-052; API).
 */
export function requireHealthRead(input: HealthAccessInput): 'full' | 'emergency' {
  const decision = decide(input)
  if (decision.access === 'none') throw denial(decision.reason ?? 'forbidden', false)
  return decision.access
}

/** Yazma yetkisi yoksa fırlatır: kapsam dışı 404, yetkisiz rol 403 `health_profile_write_forbidden`. */
export function requireHealthWrite(input: HealthAccessInput): void {
  const decision = decide(input)
  if (decision.write) return
  throw denial(decision.reason ?? 'forbidden', true)
}

/** Yazma girdisini doğrular (Zod hatası 400). */
export const parseHealthProfileInput = (input: unknown): HealthProfileWrite =>
  healthProfileInputSchema.parse(input)

/** İçeriğin denetim kaydına yazılacak alan adları: yalnız değişen alanların adı, değer yok. */
export function changedHealthFields(
  before: HealthProfileContent | null,
  after: HealthProfileContent,
): (keyof HealthProfileContent)[] {
  const keys = Object.keys(healthProfileContentSchema.shape) as (keyof HealthProfileContent)[]
  return keys.filter(
    (key) => before === null || JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  )
}
