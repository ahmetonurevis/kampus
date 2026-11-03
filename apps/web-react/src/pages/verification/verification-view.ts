// Kimliksiz belge doğrulama sayfasının saf görünüm modeli (OG-088; DOM-DIL-082). Sorgu durumunu
// sonuç bölgesinin tek bir durumuna indirger; gösterilen alanlar yalnız API yanıtındakilerdir
// (durum, baş harfler, kur, tarih, kurum). Belge numarası ve puan burada yoktur.
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  VERIFICATION_MESSAGES,
  verificationErrorMessage,
  type CertificateVerification,
} from '@kampus/react-shared/use-course-certificates.ts'
import {
  CERTIFICATE_STATUSES,
  normalizeVerificationCode,
} from '@kampus/school-core/cefr/certificates.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

export type VerificationTone = 'success' | 'warning' | 'danger'

export type VerificationView =
  | { kind: 'idle' }
  | { kind: 'loading'; code: string }
  | { kind: 'message'; tone: VerificationTone; title: string; message: string }
  | {
      kind: 'result'
      code: string
      tone: VerificationTone
      title: string
      message: string
      rows: readonly { label: string; value: string }[]
    }

type QueryState = {
  data: CertificateVerification | undefined
  error: ApiError | null
}

/** Düzenleme günü (`YYYY-MM-DD`, Europe/Istanbul gün anahtarı) → "3 Kasım 2026". */
export function verificationDateLabel(day: string): string {
  // Gün anahtarı UTC gece yarısı olarak okunur; İstanbul'da (+03:00) aynı gündür.
  return dateLabel(`${day}T00:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' })
}

const RESULT_MESSAGES = {
  valid: 'Bu belge kurum tarafından düzenlenmiştir ve geçerlidir.',
  cancelled: 'Bu belge kurum tarafından iptal edilmiştir; geçerli bir belge olarak kullanılamaz.',
} as const satisfies Record<keyof typeof CERTIFICATE_STATUSES, string>

/**
 * Adresteki ham kod ve sorgu durumundan sonuç bölgesi. Biçimi bozuk kod istek atılmadan
 * reddedilir; 404 "bulunamadı", 429 "çok fazla deneme" metniyle gösterilir (react-shared).
 */
export function verificationView(rawCode: string | undefined, query: QueryState): VerificationView {
  if (!rawCode) return { kind: 'idle' }
  const code = normalizeVerificationCode(rawCode)
  if (code === null)
    return {
      kind: 'message',
      tone: 'danger',
      title: 'Kod geçersiz',
      message: VERIFICATION_MESSAGES.invalidCode,
    }
  if (query.data) {
    const { status } = query.data
    return {
      kind: 'result',
      code,
      tone: status === 'valid' ? 'success' : 'warning',
      title: CERTIFICATE_STATUSES[status].label,
      message: RESULT_MESSAGES[status],
      rows: [
        { label: 'Kursiyer (baş harfler)', value: query.data.learnerInitials },
        { label: 'Kur', value: query.data.courseName },
        { label: 'Düzenleme tarihi', value: verificationDateLabel(query.data.issuedDate) },
        { label: 'Kurum', value: query.data.institutionName },
      ],
    }
  }
  if (query.error) {
    const { status } = query.error
    return {
      kind: 'message',
      tone: status === 404 ? 'danger' : 'warning',
      title:
        status === 404
          ? 'Belge bulunamadı'
          : status === 429
            ? 'Çok fazla deneme'
            : 'Doğrulama yapılamadı',
      message: verificationErrorMessage(query.error),
    }
  }
  return { kind: 'loading', code }
}
