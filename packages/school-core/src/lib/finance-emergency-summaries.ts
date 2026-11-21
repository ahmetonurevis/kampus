import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import type { HealthAccessReason } from './finance-health-access.ts'
import {
  TRANSPORT_ROSTER_CONTACTS_MAX,
  transportRosterContacts,
  type RosterParentRecord,
} from './finance-transport-roster.ts'
import type { GuardianLink, GuardianRelationship } from './guardianship.ts'

/**
 * Acil durum özeti (docs/domain/finans.md DOM-FIN-155; ON-165; K-520…K-522; H-111). Sınıf
 * öğretmeninin ve acil durumda öğrencinin yanındaki personelin bir bakışta görmesi gereken en az
 * bilgi: öğrenci adı, sınıf, yöneticinin onayladığı **acil eylem** metni ("arı sokmasında adrenalin
 * kalem çantada; 112 ara"), uyarı türü işaretleri (alerji, kronik durum, ilaç; ad ve tanı yok),
 * bugün okulda verilecek onaylı ilaç olup olmadığı ve acil iletişim (en çok iki kişi, telefon
 * maskeli; tam telefon ayrı açılışla).
 *
 * - Metin (K-520): sağlık profilinin acil talimatı (DOM-ILT-035) veli ya da yönetici tarafından
 *   onaysız yazılır; özetteki metni yönetici yazar ve onaylar. Onaydan önce kimseye görünmez;
 *   yayındaki metnin değişikliği onaylanana kadar eski metin görünmeye devam eder (acil bilgi
 *   düzeltme sırasında kaybolmaz). Profil onaydan sonra değişirse özet "gözden geçirilmeli"
 *   işaretlenir; yönetici metni değiştirmeden de yeniden onaylayabilir.
 * - Görenler (K-521): kurumda nöbet modeli olmadığından yönetici ve ön büro bütün sınıfları, öğretmen
 *   sınıf öğretmeni olduğu ve derse girdiği sınıfları görür. Veli ve öğrenci görmez. Her açılış
 *   öğrenci başına denetime düşer (API).
 * - İşaret ve ilaç (K-522): uyarı işaretleri sağlık profilinden her okumada türetilir (kopya yok);
 *   bugünkü ilaç günü (Europe/Istanbul) kapsayan onaylı revir ilaç onayından (DOM-FIN-151) gelir.
 *   Acil iletişim servis listesiyle aynı kuraldır (K-501, `transportRosterContacts`).
 *
 * Fonksiyonlar saftır: kayıtları çağıran yükler.
 */

/** Özeti yazan, onaylayan ve arşivleyen roller (K-520). */
export const EMERGENCY_SUMMARY_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Yayındaki özeti okuyan roller (K-521); öğretmen yalnız kendi sınıflarını görür. */
export const EMERGENCY_SUMMARY_VIEW_ROLES = [
  'yonetici',
  'onburo',
  'ogretmen',
] as const satisfies readonly Role[]

export const EMERGENCY_ACTION_MIN = 10
export const EMERGENCY_ACTION_MAX = 500
/** Öğrenci başına en çok acil iletişim kişisi (K-501 ile aynı). */
export const EMERGENCY_CONTACTS_MAX = TRANSPORT_ROSTER_CONTACTS_MAX

export const EMERGENCY_SUMMARY_STATES = ['draft', 'published', 'pending_revision'] as const
export type EmergencySummaryState = (typeof EMERGENCY_SUMMARY_STATES)[number]
export const EMERGENCY_SUMMARY_STATE_LABELS = {
  draft: 'Onay bekliyor',
  published: 'Yayında',
  pending_revision: 'Değişiklik onay bekliyor',
} as const satisfies Record<EmergencySummaryState, string>

/** Kart okumasının amacı: ekranda görüntüleme ya da sınıf PDF'i; denetimde ayrı eylemdir. */
export const EMERGENCY_CARD_PURPOSES = ['view', 'print'] as const
export type EmergencyCardPurpose = (typeof EMERGENCY_CARD_PURPOSES)[number]

export const EMERGENCY_ALERTS = ['allergy', 'chronic', 'medication'] as const
export type EmergencyAlert = (typeof EMERGENCY_ALERTS)[number]
export const EMERGENCY_ALERT_LABELS = {
  allergy: 'Alerji',
  chronic: 'Kronik durum',
  medication: 'Düzenli ilaç',
} as const satisfies Record<EmergencyAlert, string>

/**
 * Kart okumasının varsayılan erişim gerekçesi (K-521; DOM-FIN-156): kart, sınıf PDF'i ve tam
 * telefon yalnız acil müdahale içindir; amaç ekranın kendisinden bellidir. Öğretmenin akışı
 * ağırlaşmasın diye gerekçe sorulmaz, okuma `emergency` koduyla kaydedilir; istemci başka bir kod
 * gönderirse o yazılır. Taslak ve profil talimatı taşıyan yönetim ayrıntısında gerekçe zorunludur.
 */
export const EMERGENCY_CARD_DEFAULT_REASON = {
  code: 'emergency',
  note: null,
} as const satisfies HealthAccessReason

// --- Şemalar -------------------------------------------------------------------------------------

// kvkk: Ö — sağlık bilgisi içerir; şifreli saklanır, loga ve denetim değerine yazılmaz.
export const emergencyActionTextSchema = z
  .string('Acil eylem metnini yazın.')
  .trim()
  .min(EMERGENCY_ACTION_MIN, `Acil eylem en az ${String(EMERGENCY_ACTION_MIN)} karakter olmalı.`)
  .max(EMERGENCY_ACTION_MAX, `Acil eylem en çok ${String(EMERGENCY_ACTION_MAX)} karakter olabilir.`)
  .describe('Acil durumda yapılacaklar (ör. "Arı sokmasında adrenalin kalem çantada; 112 ara.")')

export const emergencySummaryCreateSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(128)
    .describe('Öğrenci kaydı'),
  actionText: emergencyActionTextSchema,
})
export type EmergencySummaryCreateInput = z.output<typeof emergencySummaryCreateSchema>

export const emergencySummaryUpdateSchema = z.strictObject({
  actionText: emergencyActionTextSchema,
})
export type EmergencySummaryUpdateInput = z.output<typeof emergencySummaryUpdateSchema>

export const emergencyCardPurposeSchema = z
  .enum(EMERGENCY_CARD_PURPOSES, 'Amaç `view` ya da `print` olmalıdır.')
  .default('view')
  .describe('`view` ekranda görüntüleme (varsayılan), `print` sınıf PDF’i')

export const emergencyContactPositionSchema = z.coerce
  .number('Kişi sırasını verin.')
  .int('Kişi sırası tam sayı olmalı.')
  .min(1, 'Kişi sırası 1 ya da 2 olmalı.')
  .max(EMERGENCY_CONTACTS_MAX, 'Kişi sırası 1 ya da 2 olmalı.')
  .describe('Acil iletişim kişisinin sırası (1 ya da 2)')

// --- Durum ve gözden geçirme ---------------------------------------------------------------------

/** Özetin metin durumu; hangisinin olduğu satırdaki şifreli kolonların varlığından gelir. */
export interface EmergencySummaryTexts {
  // kvkk: Ö
  draft: string | null
  // kvkk: Ö
  published: string | null
}

/**
 * Sağlık profilinin damgası: sürüm (kayıt yoksa 1) ve son güncelleme anı (kayıt yoksa `null`).
 * Sürüm tek başına yetmez: arşivlenip yeniden açılan profil aynı sürümle başlar.
 */
export interface HealthProfileStamp {
  version: number
  updatedAt: string | null
}

export function emergencySummaryState(texts: {
  hasDraft: boolean
  hasPublished: boolean
}): EmergencySummaryState {
  if (!texts.hasPublished) return 'draft'
  return texts.hasDraft ? 'pending_revision' : 'published'
}

const sameStamp = (a: HealthProfileStamp, b: HealthProfileStamp) =>
  a.version === b.version && a.updatedAt === b.updatedAt

/**
 * Gözden geçirilmeli mi (K-520): yayındaki özet, onaylandığı andaki profil damgasından farklı bir
 * profille okunuyorsa. Yayında olmayan özet için `false` (zaten onay bekler).
 */
export function emergencySummaryNeedsReview(
  reviewed: HealthProfileStamp | null,
  current: HealthProfileStamp,
): boolean {
  return reviewed !== null && !sameStamp(reviewed, current)
}

const unchanged = () =>
  new DomainError('emergency_summary_unchanged', 'Acil eylem metni değişmedi.', {
    path: ['actionText'],
  })

/** Yeni özet (K-520): taslak olarak açılır, onaya kadar görünmez. */
export function planEmergencySummaryCreate(
  input: EmergencySummaryCreateInput,
  checks: { student: { active: boolean } | null; summaryExists: boolean },
): { studentId: string; draft: string } {
  if (checks.student === null)
    throw new DomainError('emergency_summary_student_not_found', 'Öğrenci bulunamadı.', {
      path: ['studentId'],
    })
  if (!checks.student.active)
    throw new DomainError(
      'emergency_summary_student_inactive',
      'Ayrılmış ya da mezun öğrenci için acil durum özeti yazılmaz.',
      { path: ['studentId'] },
    )
  if (checks.summaryExists)
    throw new DomainError(
      'emergency_summary_exists',
      'Bu öğrencinin acil durum özeti zaten var; mevcut özeti düzenleyin.',
      { kind: 'conflict', path: ['studentId'] },
    )
  return { studentId: input.studentId, draft: input.actionText }
}

/**
 * Metin düzeltmesi (K-520): yeni metin taslak olur, yayındaki metin onaya kadar görünmeye devam
 * eder. Yayındaki metne geri dönen düzeltme taslağı kaldırır. Aynı metin 422.
 */
export function planEmergencySummaryUpdate(
  current: EmergencySummaryTexts,
  input: EmergencySummaryUpdateInput,
): { draft: string | null } {
  const next = input.actionText
  if (current.draft !== null) {
    if (next === current.draft) throw unchanged()
    return { draft: next === current.published ? null : next }
  }
  if (next === current.published) throw unchanged()
  return { draft: next }
}

/**
 * Onay (K-520): taslak varsa yayına alınır; taslak yoksa yayındaki metin profil değiştiyse yeniden
 * onaylanır (gözden geçirildi). İkisi de yoksa 422. Onay anındaki profil damgası saklanır.
 */
export function planEmergencySummaryApproval(
  current: EmergencySummaryTexts & { reviewed: HealthProfileStamp | null },
  profile: HealthProfileStamp,
): { published: string; reviewed: HealthProfileStamp } {
  if (current.draft !== null) return { published: current.draft, reviewed: profile }
  if (current.published !== null && emergencySummaryNeedsReview(current.reviewed, profile))
    return { published: current.published, reviewed: profile }
  throw new DomainError(
    'emergency_summary_nothing_to_approve',
    'Onaylanacak değişiklik yok: özet yayında ve sağlık bilgisi değişmedi.',
  )
}

// --- Uyarı işaretleri ----------------------------------------------------------------------------

/** Profil içeriğinin yalnız liste uzunlukları; ad ve tanı bu modüle girmez. */
export interface HealthProfileLists {
  allergies: readonly unknown[]
  chronicConditions: readonly unknown[]
  medications: readonly unknown[]
}

export type EmergencyAlertFlags = Record<EmergencyAlert, boolean>

/** Uyarı türü işaretleri (K-522): alerji, kronik durum ve düzenli ilaç var mı; profil yoksa hiçbiri. */
export function emergencyAlertFlags(profile: HealthProfileLists | null): EmergencyAlertFlags {
  return {
    allergy: (profile?.allergies.length ?? 0) > 0,
    chronic: (profile?.chronicConditions.length ?? 0) > 0,
    medication: (profile?.medications.length ?? 0) > 0,
  }
}

/** İşaretli uyarıların etiketleri (`Alerji, Düzenli ilaç`); hiçbiri yoksa boş dizi. */
export const emergencyAlertLabels = (flags: EmergencyAlertFlags): string[] =>
  EMERGENCY_ALERTS.filter((alert) => flags[alert]).map((alert) => EMERGENCY_ALERT_LABELS[alert])

// --- Görenler ------------------------------------------------------------------------------------

/**
 * Okuyanın sınıflarla bağı; API kapsam kaynağından kurar. Öğretmende sınıf öğretmeni olduğu
 * (`classes.teacherId`) ve ders ataması olan sınıflar; yalnız etkin öğretmen kaydında dolu.
 */
export type EmergencyViewer =
  | { role: 'yonetici' | 'onburo' }
  | {
      role: 'ogretmen'
      homeroomClassIds: readonly string[]
      teachingClassIds: readonly string[]
    }
  | { role: 'veli' | 'ogrenci' }

/** Görülebilen sınıflar (K-521): `all` bütün kurum; öğretmende kendi sınıfları; diğerleri boş. */
export function emergencyViewerClasses(viewer: EmergencyViewer): 'all' | ReadonlySet<string> {
  switch (viewer.role) {
    case 'yonetici':
    case 'onburo':
      return 'all'
    case 'ogretmen':
      return new Set([...viewer.homeroomClassIds, ...viewer.teachingClassIds])
    case 'veli':
    case 'ogrenci':
      return new Set()
    default:
      return viewer satisfies never
  }
}

export const canViewEmergencyClass = (viewer: EmergencyViewer, classId: string | null): boolean => {
  const classes = emergencyViewerClasses(viewer)
  if (classes === 'all') return true
  return classId !== null && classes.has(classId)
}

/** Kapsam dışı sınıf ya da öğrenci var olmayan gibi 404'tür (varlığı sızmaz). */
export function assertEmergencyClassVisible(viewer: EmergencyViewer, classId: string | null) {
  if (!canViewEmergencyClass(viewer, classId))
    throw new DomainError('emergency_summary_not_found', 'Acil durum özeti bulunamadı.', {
      kind: 'not_found',
    })
}

// --- Acil iletişim -------------------------------------------------------------------------------

export type EmergencyContactSource = {
  links: readonly Pick<
    GuardianLink,
    'parentId' | 'membershipId' | 'relationship' | 'custody' | 'contactRestricted'
  >[]
  memberNames: ReadonlyMap<string, string>
  parents: ReadonlyMap<string, RosterParentRecord>
  studentParentId: string | null
}

export interface EmergencyContact {
  position: number
  // kvkk: K
  name: string | null
  relationship: GuardianRelationship | null
  // kvkk: K — maskeli (`0532 *** ** 12`)
  phoneMasked: string | null
  hasPhone: boolean
}

/** Kartta gösterilen acil iletişim (K-501): en çok iki kişi, telefon maskeli. */
export function emergencyContacts(source: EmergencyContactSource): EmergencyContact[] {
  return transportRosterContacts({ ...source, purpose: 'office' }).map((contact, index) => ({
    position: index + 1,
    name: contact.name,
    relationship: contact.relationship,
    phoneMasked: contact.phone,
    hasPhone: contact.phone !== null,
  }))
}

/**
 * Tam telefon (K-521): yalnız karttaki sıradaki kişinin; kişi yoksa 404, telefonu yoksa 422. Her
 * açılış API'de denetime düşer (değer yazılmaz).
 */
export function emergencyContactPhone(
  source: EmergencyContactSource,
  position: number,
): {
  position: number
  name: string | null
  relationship: GuardianRelationship | null
  phone: string
} {
  const contact = transportRosterContacts({ ...source, purpose: 'driver' })[position - 1]
  if (contact === undefined)
    throw new DomainError('emergency_contact_not_found', 'Acil iletişim kişisi bulunamadı.', {
      kind: 'not_found',
    })
  if (contact.phone === null)
    throw new DomainError('emergency_contact_phone_missing', 'Bu kişinin kayıtlı telefonu yok.')
  return {
    position,
    name: contact.name,
    relationship: contact.relationship,
    phone: contact.phone,
  }
}
