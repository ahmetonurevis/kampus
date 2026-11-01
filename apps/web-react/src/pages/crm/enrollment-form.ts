import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  allowedGuardianModes,
  GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
  GUARDIAN_REQUIRED_FORM_MESSAGE,
  type EnrollmentFormValues,
  type GuardianMode,
} from '@kampus/school-core/lib/enrollment.ts'

// Kesin kayıt formunun (`EnrollmentPage`) saf yardımcıları: veli seçiminin doğum tarihine uyumu,
// aday değişiminde sıfırlanan alanlar ve sunucu hatasının forma bağlanması (DOM-KAY-012, -013,
// class_campus_mismatch).

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

/**
 * Aday değişince sıfırlanan alanlar: önceki adayın veli seçimi ve bilgisi yeni adaya taşınmaz.
 * Veli seçimi girilmiş doğum tarihine göre varsayılana döner.
 */
export function prospectChangeValues(
  values: Pick<EnrollmentFormValues, 'birthDate'>,
  institutionType: InstitutionType,
  now: string | number | Date = new Date(),
): Pick<
  EnrollmentFormValues,
  | 'existingParentId'
  | 'guardianName'
  | 'guardianPhone'
  | 'guardianMode'
  | 'studentPhone'
  | 'studentEmail'
> {
  return {
    existingParentId: '',
    guardianName: '',
    guardianPhone: '',
    guardianMode: guardianModeFor('new', institutionType, values.birthDate, now),
    studentPhone: '',
    studentEmail: '',
  }
}

type FormField = keyof EnrollmentFormValues

/** Sunucu yolu → form alanı ve alanın adımı (`ENROLLMENT_STEP_FIELDS` sırası). */
const SERVER_FIELDS: Readonly<Record<string, { field: FormField; step: number }>> = {
  guardian: { field: 'guardianMode', step: 1 },
  'identity.birthDate': { field: 'birthDate', step: 1 },
  'identity.number': { field: 'identityNumber', step: 1 },
  'studentContact.phone': { field: 'studentPhone', step: 1 },
  'studentContact.email': { field: 'studentEmail', step: 1 },
}

/** Veli kuralı reddinde sunucu iletisi yerine formun yönlendiren iletisi (DOM-KAY-012). */
const SERVER_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  guardian_required: GUARDIAN_REQUIRED_FORM_MESSAGE,
  guardian_not_applicable: GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
}

export type EnrollmentServerError =
  | { field: FormField; step: number; type: string; message: string }
  | { field: 'root.server'; step: null; type: string; message: string }

/**
 * Sunucunun yollu hatası (`setError(name, …)`) formda nereye yazılır: veli (`guardian_required`,
 * `guardian_not_applicable`, `parent_not_guardian`), doğum tarihi ve kimlik hataları ilgili alana
 * ve o alanın adımına; diğerleri formun genel hatasına (`root.server`).
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
