import { z } from 'zod'

import { INSTITUTION_TYPES, type InstitutionType } from '../modules/collection-modules.ts'
import {
  ENROLLMENT_STATUS_LABELS,
  enrollmentStatus,
  type EnrollmentRenewal,
  type EnrollmentStudent,
} from './enrollment-status.ts'
import { DomainError } from './errors.ts'

/**
 * Öğrenci belgesi (docs/domain/kayit-ve-crm.md DOM-KAY-027; ON-049): kaydın düzenleme anındaki
 * durumunu gösteren kurum belgesi; okulda "öğrenci belgesi", dil okulu ve kursta "kursiyer belgesi".
 * Resmî belge değildir, e-Okul ve e-Özel belgesinin yerine geçmez (DOM-AKD-050 ilkesi). İçerik izin
 * listesidir: kimlik numarası, doğum tarihi, veli, sağlık, ücret, borç ve disiplin bilgisi bu şemada
 * yoktur. Borç belgeyi engellemez (DOM-KAY-025). Saftır; kimlik üretimi ve denetim kaydı servistedir.
 */

/** Herhangi bir öğrenciye belge düzenleyen personel rolleri. */
export const ENROLLMENT_CERTIFICATE_ROLES = ['yonetici', 'onburo'] as const

/** Yalnız kapsamındaki öğrencinin belgesini indiren aile rolleri (K-32, ON-304). */
export const ENROLLMENT_CERTIFICATE_FAMILY_ROLES = ['veli', 'ogrenci'] as const

export const enrollmentCertificateSchema = z.strictObject({
  documentId: z.uuid().describe('Belge kimliği; aynı düzenlemenin denetim satırının kimliğidir'),
  issuedAt: z.iso.datetime().describe('Düzenleme anı (UTC); belgede Europe/Istanbul günü yazılır'),
  institutionName: z.string().describe('Kurum adı (IST-013 unvanı gelene kadar kayıtlı ad)'),
  institutionType: z.enum(INSTITUTION_TYPES).describe('Terimi belirler: öğrenci ya da kursiyer'),
  learnerName: z.string().describe('Öğrencinin ya da kursiyerin adı'),
  schoolNumber: z.string().nullable().describe('Okul numarası; kayıtta yoksa `null`'),
  className: z.string().nullable().describe('Sınıf adı; okunamıyorsa `null`'),
  courseNames: z
    .array(z.string())
    .describe('Dil okulunda sürmekte olan kurlar, ada göre sıralı; okulda hep boş'),
  academicYear: z
    .number()
    .int()
    .nullable()
    .describe('Etkin eğitim yılının başlangıcı: 2026 → 2026–2027; kurum ayarı yoksa `null`'),
})
export type EnrollmentCertificate = z.infer<typeof enrollmentCertificateSchema>

export type EnrollmentCertificateStudent = EnrollmentStudent & {
  name: string
  number?: string | null | undefined
}

export interface EnrollmentCertificateInput {
  documentId: string
  issuedAt: Date
  institution: { name: string; type: InstitutionType }
  student: EnrollmentCertificateStudent
  className: string | null
  courseNames: readonly string[]
  academicYear: number | null
  /** Mezun ile ayrılanı ayırır (`enrollmentStatus`); aktif öğrencide okunmaz. */
  renewals: readonly EnrollmentRenewal[]
}

/** 2026 → "2026–2027"; ayar yoksa `null`. */
export function academicYearLabel(startYear: number | null): string | null {
  return startYear === null ? null : `${String(startYear)}–${String(startYear + 1)}`
}

/**
 * Belgenin içeriği. Belge "kayıtlıdır" der; bu yüzden yalnız aktif kayda düzenlenir. Ayrılan ve
 * mezun için 422 `enrollment_certificate_inactive` (DOM-KAY-024, DOM-KAY-022, DOM-KAY-026).
 */
export function buildEnrollmentCertificate(
  input: EnrollmentCertificateInput,
): EnrollmentCertificate {
  const status = enrollmentStatus(input.student, { renewals: input.renewals })
  if (status !== 'active')
    throw new DomainError(
      'enrollment_certificate_inactive',
      `Bu belge yalnız kaydı aktif olan kişiye düzenlenir; kayıt durumu: ${ENROLLMENT_STATUS_LABELS[status]}.`,
    )
  const number = input.student.number?.trim()
  return {
    documentId: input.documentId,
    issuedAt: input.issuedAt.toISOString(),
    institutionName: input.institution.name,
    institutionType: input.institution.type,
    learnerName: input.student.name,
    schoolNumber: number ? number : null,
    className: input.className,
    courseNames: [...new Set(input.courseNames)].sort((a, b) => a.localeCompare(b, 'tr')),
    academicYear: input.academicYear,
  }
}
