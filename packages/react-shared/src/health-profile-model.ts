import { isApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'
import {
  ALLERGY_SEVERITIES,
  HEALTH_LEGAL_BASES,
  HEALTH_LEGAL_BASIS_KEYS,
  healthProfilePatchSchema,
  type AllergySeverity,
  type HealthLegalBasis,
  type HealthProfilePatchInput,
} from '@kampus/school-core/lib/health-profile.ts'

/**
 * Sağlık ve acil bilgi bölümünün saf modeli (OG-090; DOM-ILT-035): API düzeyine göre görünüm,
 * yazma yetkisinin gösterim kararı, form değeri ↔ kısmi PATCH gövdesi ve hata mesajları. Erişim
 * kararını sunucu verir (403/404); buradaki rol denetimi yalnız düzenleme düğmesini gösterir.
 * Bütün alanlar özel nitelikli veridir (kvkk: Ö): bu modül hiçbir şeyi kalıcı depoya yazmaz.
 */

export type HealthProfileData =
  operations['getStudentHealthProfile']['responses'][200]['content']['application/json']['data']
export type HealthFullData = Extract<HealthProfileData, { level: 'full' }>
export type HealthProfilePatchBody =
  operations['updateStudentHealthProfile']['requestBody']['content']['application/json']

export const HEALTH_SECTION_TITLE = 'Sağlık ve acil bilgi'
export const HEALTH_CLOSED_NOTE =
  'Sağlık bilgisi özel nitelikli kişisel veridir; yalnız gerektiğinde açın. Her görüntüleme kayıt altına alınır.'
export const HEALTH_NO_ACCESS = 'Bu bilgiyi görme yetkiniz yok.'
export const HEALTH_EMERGENCY_NOTE = 'Yalnız acil müdahale bilgisi'
export const HEALTH_PRIVACY_NOTE =
  'Bu bilgi özel nitelikli kişisel veridir; her görüntüleme ve değişiklik kayıt altına alınır.'

export const HEALTH_PROFILE_MESSAGES = {
  version_conflict: 'Sağlık bilgisi başka bir yerde değişti, güncel hâli yüklendi.',
  health_profile_write_forbidden: 'Sağlık ve acil bilgiyi değiştirme yetkiniz yok.',
  health_profile_forbidden: 'Sağlık ve acil bilgiye erişim yetkiniz yok.',
} as const

/** Düzenleme düğmesi: yönetici, veli ve öğrenci (18+ kararı sunucudadır; reşit öğrenci 403 alır). */
const WRITER_ROLES: readonly string[] = ['yonetici', 'veli', 'ogrenci']

export function canEditHealthProfile(role: string): boolean {
  return WRITER_ROLES.includes(role)
}

export type HealthSectionState = 'loading' | 'hidden' | 'error' | 'ready'

/**
 * Bölümün durumu. 403 (rol ya da düzey yetmiyor) ve 404 (kapsam dışı öğrenci) `hidden`:
 * kullanıcı "göster" dediği için kısa nötr metin (`HEALTH_NO_ACCESS`) çıkar, hata toast'u yoktur. Başka hata yeniden denemeyle gösterilir.
 */
export function healthSectionState(query: {
  data: unknown
  error: unknown
  isPending: boolean
}): HealthSectionState {
  if (query.error) {
    if (isApiError(query.error) && (query.error.status === 403 || query.error.status === 404))
      return 'hidden'
    return 'error'
  }
  if (query.isPending || !query.data) return 'loading'
  return 'ready'
}

export type HealthPanelMode = 'emergency' | 'readonly' | 'editable'

/** Acil düzey her zaman salt okunur kısa kart; tam düzey yalnız yazma yetkisinde düzenlenir. */
export function healthPanelMode(data: HealthProfileData, canWrite: boolean): HealthPanelMode {
  if (data.level === 'emergency') return 'emergency'
  return canWrite ? 'editable' : 'readonly'
}

export const SEVERITY_OPTIONS = (
  Object.entries(ALLERGY_SEVERITIES) as [AllergySeverity, { label: string }][]
).map(([value, { label }]) => ({ value, label }))

export const LEGAL_BASIS_OPTIONS = HEALTH_LEGAL_BASIS_KEYS.map((value) => ({
  value,
  label: HEALTH_LEGAL_BASES[value].label,
}))

export const severityLabel = (severity: AllergySeverity) => ALLERGY_SEVERITIES[severity].label
export const legalBasisLabel = (basis: HealthLegalBasis) => HEALTH_LEGAL_BASES[basis].label

export type HealthViewItem = { key: string; label: string; detail: string | null; urgent: boolean }
export type HealthViewSection = {
  key: string
  title: string
  items: HealthViewItem[]
  /** Liste boşken gösterilen metin. */
  empty: string
}

const NONE_RECORDED = 'Kayıtlı bilgi yok.'

function allergySection(allergies: HealthProfileData['profile']['allergies']): HealthViewSection {
  return {
    key: 'allergies',
    title: 'Alerjiler',
    empty: NONE_RECORDED,
    items: allergies.map((item, index) => ({
      key: `${index}-${item.name}`,
      label: item.name,
      detail: severityLabel(item.severity),
      urgent: item.severity === 'severe',
    })),
  }
}

function instructionSection(text: string): HealthViewSection {
  return {
    key: 'emergencyInstructions',
    title: 'Acil müdahale talimatı',
    empty: NONE_RECORDED,
    items: text ? [{ key: 'text', label: text, detail: null, urgent: false }] : [],
  }
}

function namedSection(
  key: string,
  title: string,
  rows: readonly { name: string }[],
): HealthViewSection {
  return {
    key,
    title,
    empty: NONE_RECORDED,
    items: rows.map((row, index) => ({
      key: `${index}-${row.name}`,
      label: row.name,
      detail: null,
      urgent: false,
    })),
  }
}

/**
 * Salt okunur görünümün bölümleri. Acil düzeyde yalnız alerjiler ve acil talimat vardır; kronik
 * durum, ilaç ve destek ihtiyacı yanıtta olmadığı gibi görünümde de yer almaz.
 */
export function healthViewSections(data: HealthProfileData): HealthViewSection[] {
  if (data.level === 'emergency')
    return [
      allergySection(data.profile.allergies),
      instructionSection(data.profile.emergencyInstructions),
    ]
  const { profile } = data
  return [
    allergySection(profile.allergies),
    namedSection('chronicConditions', 'Kronik durumlar', profile.chronicConditions),
    {
      key: 'medications',
      title: 'Düzenli ilaçlar',
      empty: NONE_RECORDED,
      items: profile.medications.map((item, index) => ({
        key: `${index}-${item.name}`,
        label: item.name,
        detail:
          [item.schedule, item.atSchool ? 'Okulda verilir' : null].filter(Boolean).join(' · ') ||
          null,
        urgent: false,
      })),
    },
    namedSection('supportNeeds', 'Destek ihtiyaçları', profile.supportNeeds),
    instructionSection(profile.emergencyInstructions),
  ]
}

/** Form değeri kısmi PATCH girdisiyle aynı biçimdedir (alan adları sunucu yollarıyla örtüşür). */
export type HealthProfileForm = HealthProfilePatchInput

/** Kayıtlı profilden form değeri; kopya alınır. Kayıt yoksa (`legalBasis: null`) dayanak seçilmemiştir. */
export function healthFormValues(data: HealthFullData): HealthProfileForm {
  const { profile } = data
  return {
    allergies: profile.allergies.map(({ name, severity }) => ({ name, severity })),
    chronicConditions: profile.chronicConditions.map(({ name }) => ({ name })),
    medications: profile.medications.map(({ name, schedule, atSchool }) => ({
      name,
      schedule: schedule ?? '',
      atSchool,
    })),
    supportNeeds: profile.supportNeeds.map(({ name }) => ({ name })),
    emergencyInstructions: profile.emergencyInstructions,
    ...(profile.legalBasis ? { legalBasis: profile.legalBasis } : {}),
    version: data.version,
  }
}

/** Boş kullanım düzeni "yok" demektir (çekirdek şema boş metni reddeder); boşluk kırpılır. */
export function normalizeHealthForm(values: HealthProfileForm): HealthProfileForm {
  if (!values.medications) return values
  return {
    ...values,
    medications: values.medications.map(({ schedule, ...rest }) => {
      const trimmed = schedule?.trim()
      return trimmed ? { ...rest, schedule: trimmed } : rest
    }),
  }
}

/**
 * Form şeması: çekirdek kısmi şema (`healthProfilePatchSchema`) + kayıt yokken hukuki dayanağın
 * zorunluluğu (sunucu da 400 verir; hata alanın altında hemen görünsün).
 */
export function healthProfileFormSchema(hasRecord: boolean) {
  return healthProfilePatchSchema.superRefine((value, ctx) => {
    if (!hasRecord && value.legalBasis === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['legalBasis'],
        message: 'İşlemenin hukuki dayanağını seçin.',
      })
  })
}

const CONTENT_KEYS = [
  'allergies',
  'chronicConditions',
  'medications',
  'supportNeeds',
  'emergencyInstructions',
] as const

type MedicationLike = { name: string; schedule?: string | undefined; atSchool?: boolean }

const canonicalMedications = (medications: readonly MedicationLike[]) =>
  medications.map((item) => ({
    name: item.name,
    ...(item.schedule ? { schedule: item.schedule } : {}),
    atSchool: item.atSchool ?? false,
  }))

/**
 * Kayıt gövdesi: yalnız değişen içerik alanları, değişen hukuki dayanak ve okunan `version`.
 * Değişiklik yoksa `null` (istek atılmaz). Kayıt yokken yalnız dayanak seçmek de `null` döner:
 * sunucu içerik alanı olmadan boş profil açmaz.
 */
export function toHealthPatch(
  values: HealthProfileForm,
  saved: HealthFullData,
): HealthProfilePatchBody | null {
  const form = normalizeHealthForm(values)
  const before = saved.profile
  const patch: HealthProfilePatchBody = { version: saved.version }
  let contentChanged = false
  for (const key of CONTENT_KEYS) {
    const next = form[key]
    if (next === undefined) continue
    const same =
      key === 'medications'
        ? JSON.stringify(canonicalMedications(before.medications)) ===
          JSON.stringify(canonicalMedications(form.medications ?? []))
        : JSON.stringify(next) === JSON.stringify(before[key])
    if (same) continue
    Object.assign(patch, { [key]: next })
    contentChanged = true
  }
  const basisChanged = form.legalBasis !== undefined && form.legalBasis !== before.legalBasis
  if (basisChanged) patch.legalBasis = form.legalBasis
  if (before.legalBasis === null && !contentChanged) return null
  return contentChanged || basisChanged ? patch : null
}
