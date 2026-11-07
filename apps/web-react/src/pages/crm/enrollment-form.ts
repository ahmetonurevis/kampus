import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { isCalendarDay } from '@kampus/school-core/lib/age.ts'
import {
  allowedGuardianModes,
  GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
  GUARDIAN_REQUIRED_FORM_MESSAGE,
  guardianRequired,
  isCourse,
  type EnrollmentFormValues,
  type GuardianMode,
} from '@kampus/school-core/lib/enrollment.ts'

// Kesin kayıt formunun (`EnrollmentPage`) saf yardımcıları: veli seçiminin doğum tarihine uyumu,
// aday değişiminde sıfırlanan alanlar ve sunucu hatasının forma bağlanması (DOM-KAY-010, -012,
// -013, class_campus_mismatch).

/**
 * Doğum tarihi ya da aday değişince veli seçimi: geçerli seçim kalır, değilse kurala uyan ilk
 * seçim (kursta 18 yaş ve üstünde "kendisi", diğerlerinde yeni veli) gelir (DOM-KAY-012).
 */
export function guardianModeFor(
  current: GuardianMode,
  institutionType: InstitutionType,
  birthDate: string,
  now: string | number | Date = new Date(),
): GuardianMode {
  const allowed = allowedGuardianModes(institutionType, birthDate, now)
  return allowed.includes(current) ? current : (allowed[0] ?? 'new')
}

/** Aday değişince sıfırlanan alanlar (`prospectChangeValues`). */
export type ProspectChangeValues = Pick<
  EnrollmentFormValues,
  | 'classId'
  | 'confirmOtherCampus'
  | 'identityKind'
  | 'identityNumber'
  | 'birthDate'
  | 'existingParentId'
  | 'referralRewardId'
  | 'guardianName'
  | 'guardianPhone'
  | 'relationship'
  | 'guardianMode'
  | 'studentPhone'
  | 'studentEmail'
>

/**
 * Aday değişince sıfırlanan alanlar: önceki adayın sınıfı, başka kampüs onayı, kimlik türü ve
 * numarası, doğum tarihi, veli seçimi, yakınlığı ve iletişimi, kursiyerin kendi iletişimi yeni
 * adaya taşınmaz (KVKK: başka kişinin kişisel verisi formda kalmaz, yanlış öğrenciye yazılmaz;
 * A'nın onayı B'ye `allowOtherCampus` olarak gitmez). Doğum tarihi boşaldığı için veli seçimi
 * veli zorunlu varsayılana döner (DOM-KAY-012).
 */
export function prospectChangeValues(
  institutionType: InstitutionType,
  now: string | number | Date = new Date(),
): ProspectChangeValues {
  return {
    classId: '',
    confirmOtherCampus: false,
    identityKind: 'tc',
    identityNumber: '',
    birthDate: '',
    existingParentId: '',
    referralRewardId: '',
    guardianName: '',
    guardianPhone: '',
    relationship: 'mother',
    guardianMode: guardianModeFor('new', institutionType, '', now),
    studentPhone: '',
    studentEmail: '',
  }
}

/** Kurs adayının yaş grubu 18 yaş altıyken doğum tarihi 18 yaş ve üstünü gösteriyor. */
export const BIRTH_DATE_ADULT_FOR_MINOR_MESSAGE =
  'Aday kaydında 18 yaş altı seçili, doğum tarihi ise 18 yaş ve üstünü gösteriyor. Doğum tarihini ya da aday kaydındaki yaş grubunu düzeltin.'
/** Kurs adayının yaş grubu 18 yaş ve üstüyken doğum tarihi 18 yaş altını gösteriyor. */
export const BIRTH_DATE_MINOR_FOR_ADULT_MESSAGE =
  'Aday kaydında 18 yaş ve üstü seçili, doğum tarihi ise 18 yaş altını gösteriyor. Doğum tarihini ya da aday kaydındaki yaş grubunu düzeltin.'

/**
 * Kurs adayının ön büroda seçilen yaş grubu (`minor`) girilen doğum tarihiyle uyuşmuyor mu
 * (DOM-KAY-003, DOM-KAY-012): sunucunun 422 `birth_date_minor_mismatch` kuralının form karşılığı;
 * uyuşmazlık son adımda reddedilmeden doğum tarihi alanında gösterilir. Okulda yaş grubu
 * sorulmaz, denetlenmez; yaş grubu seçilmemiş adayda ve doğum tarihi henüz geçerli bir gün
 * değilken uyarı yoktur. Uyuşmazlıkta Türkçe ileti, yoksa `null` döner.
 */
export function birthDateAgeGroupMismatch(
  institutionType: InstitutionType,
  minor: boolean | undefined,
  birthDate: string,
  now: string | number | Date = new Date(),
): string | null {
  if (!isCourse(institutionType) || minor === undefined || !isCalendarDay(birthDate)) return null
  const adult = !guardianRequired(institutionType, birthDate, now)
  if (minor && adult) return BIRTH_DATE_ADULT_FOR_MINOR_MESSAGE
  if (!minor && !adult) return BIRTH_DATE_MINOR_FOR_ADULT_MESSAGE
  return null
}

type FormField = keyof EnrollmentFormValues

/** Sunucu yolu → form alanı ve alanın adımı (`ENROLLMENT_STEP_FIELDS` sırası). */
const SERVER_FIELDS: Readonly<Record<string, { field: FormField; step: number }>> = {
  classId: { field: 'classId', step: 0 },
  guardian: { field: 'guardianMode', step: 1 },
  'identity.birthDate': { field: 'birthDate', step: 1 },
  'identity.number': { field: 'identityNumber', step: 1 },
  'studentContact.phone': { field: 'studentPhone', step: 1 },
  'studentContact.email': { field: 'studentEmail', step: 1 },
  scholarshipProgramId: { field: 'scholarshipProgramId', step: 2 },
  referralRewardId: { field: 'referralRewardId', step: 2 },
}

/** Veli kuralı reddinde sunucu iletisi yerine formun yönlendiren iletisi (DOM-KAY-012). */
const SERVER_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  guardian_required: GUARDIAN_REQUIRED_FORM_MESSAGE,
  guardian_not_applicable: GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
}

/**
 * Yolsuz iş kuralı hatası, formun alanına koduyla bağlanır (`useApiCommand` `fieldFor`): form
 * açıkken sınıf dolarsa (`class_capacity_full`) ileti toast yerine sınıf alanında görünür.
 */
const CODE_FIELDS: Readonly<Partial<Record<string, string>>> = {
  class_capacity_full: 'classId',
}

export function enrollmentFieldForCode(code: string): string | undefined {
  return CODE_FIELDS[code]
}

export type EnrollmentServerError =
  | { field: FormField; step: number; type: string; message: string }
  | { field: 'root.server'; step: null; type: string; message: string }

/**
 * Sunucunun yollu hatası (`setError(name, …)`) formda nereye yazılır: sınıf (`class_campus_mismatch`,
 * `class_capacity_full`), veli (`guardian_required`, `guardian_not_applicable`,
 * `parent_not_guardian`), doğum tarihi ve kimlik hataları ilgili alana ve o alanın adımına;
 * diğerleri formun genel hatasına (`root.server`).
 */
export function enrollmentServerError(
  name: string,
  error: { type: string; message: string },
): EnrollmentServerError {
  const message = SERVER_MESSAGES[error.type] ?? error.message
  const target = SERVER_FIELDS[name]
  return target
    ? { ...target, type: error.type, message }
    : { field: 'root.server', step: null, type: error.type, message }
}

/**
 * Kesin kayıttan sonra "Ödeme planını görüntüle" bağlantısı: rolün taksit listesi (ön büro Tahsilat
 * Takibi, yönetici Finans & Tahsilat). Kesin kaydı yalnız bu iki rol yapar (DOM-KAY-035); başka
 * rolde bağlantı yoktur.
 */
export function paymentPlanHref(role: string | undefined): string | null {
  if (role === 'onburo') return '/onburo/tahsilat-takip'
  if (role === 'yonetici') return '/yonetici/finans'
  return null
}

/**
 * Adayın ilgi metninden hedef düzey (DOM-KAY-014, ON-120): aday formu düzeyi serbest metinle
 * alır ("7. Sınıf · Ortaokul", "9. sınıf"). Okul düzeyleri 1–12 dışındaki sayı ya da düzeysiz
 * metin `null`dur; öneri yalnız bilgi verir, seçimi kısıtlamaz.
 */
export function interestGrade(interest: string | undefined): number | null {
  const match = /(\d{1,2})\s*\.?\s*s[ıi]n[ıi]f/iu.exec(interest ?? '')
  const grade = match ? Number(match[1]) : NaN
  return Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : null
}

/**
 * Sınıf listesinin sırası: hedef düzeydeki sınıflar önce, kalanlar özgün sırasıyla (kararlı).
 * Düzey bilinmiyorsa liste değişmez.
 */
export function suggestedClassOrder<T extends { record: { grade?: number } }>(
  rows: readonly T[],
  grade: number | null,
): T[] {
  if (grade === null) return [...rows]
  return [
    ...rows.filter((row) => row.record.grade === grade),
    ...rows.filter((row) => row.record.grade !== grade),
  ]
}

/**
 * Sınıfın dolu yeri: aktif öğrenciler ve aynı sınıfa planlanmış yenilemeler (DOM-KAY-010,
 * ON-116; sunucunun kesin kayıt sayımıyla aynı). Sınıfta zaten olan öğrencinin planı bir kez
 * sayılmaz; sayımlar ayrı okunduğu için yenilemenin öğrencisi aktif sayımda varsa düşülür.
 */
export function seatsTaken(
  classId: string,
  activeCount: number,
  plannedRenewals: readonly { targetClassId: string; fromClassId: string }[],
): number {
  return (
    activeCount +
    plannedRenewals.filter(
      (renewal) => renewal.targetClassId === classId && renewal.fromClassId !== classId,
    ).length
  )
}
