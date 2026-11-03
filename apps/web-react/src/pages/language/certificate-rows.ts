// Kurum başarı belgeleri ekranının saf hesapları (OG-088; IST-081; DOM-DIL-080, 081, 082):
// belge satırları, belgeye hak kazanan kursiyer satırları, süzgeç seçenekleri ve düğme
// görünürlüğü. Kural ve yetki sunucudadır; burada yalnız görünüm vardır.
import { CERTIFICATE_STATUSES } from '@kampus/school-core/cefr/certificates.ts'
import { CEFR_LEVELS } from '@kampus/school-core/content/taxonomy.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  awaitingReplacement,
  enrollmentCertificateState,
  isStaffCertificate,
  type CourseCertificate,
  type GroupMebbisList,
} from '@kampus/react-shared/use-course-certificates.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { ListColumn } from '@/lib/list-view.ts'

type StaffCertificate = Extract<CourseCertificate, { rowVersion: number }>

export const certificateDate = (value: string | null | undefined) =>
  dateLabel(value, { year: 'numeric' })

/** Belge satırı (personel ve kursiyer listesi). Arama ve süzgeç alanları düz metindir. */
export type CertificateRow = {
  id: string
  number: string
  learner: string
  course: string
  courseId: string
  /** CEFR seviye anahtarı (koordinatör görevi kapsamı); `level` gösterim etiketidir. */
  levelKey: string
  level: string
  status: string
  statusKey: 'valid' | 'cancelled'
  tone: BadgeTone
  issuedAt: string
  issued: string
  cancelled: string
  reason: string
  /** Personel belgesi: iptal ve yeniden düzenleme için tam kayıt; kursiyerde `null`. */
  staff: StaffCertificate | null
  /** İptal edilmiş ve yerine belge düzenlenmemiş (yeniden düzenlenebilir). */
  replaceable: boolean
  /** Yerine düzenlenen belgenin numarası (yeniden düzenlemede). */
  replaces: string
}

const STATUS_TONES = { valid: 'green', cancelled: 'red' } as const satisfies Record<
  CertificateRow['statusKey'],
  BadgeTone
>

export function certificateRows(certificates: readonly CourseCertificate[]): CertificateRow[] {
  const numbers = new Map(certificates.map((certificate) => [certificate.id, certificate.number]))
  return certificates.map((certificate) => {
    const staff = isStaffCertificate(certificate) ? certificate : null
    return {
      id: certificate.id,
      number: certificate.number,
      learner: certificate.content.learnerName,
      course: certificate.content.courseName,
      courseId: certificate.courseId,
      levelKey: certificate.content.level,
      level: CEFR_LEVELS[certificate.content.level].label,
      status: CERTIFICATE_STATUSES[certificate.status].label,
      statusKey: certificate.status,
      tone: STATUS_TONES[certificate.status],
      issuedAt: certificate.issuedAt,
      issued: certificateDate(certificate.issuedAt),
      cancelled: staff?.cancelledAt ? certificateDate(staff.cancelledAt) : '',
      reason: staff?.cancellationReason ?? '',
      staff,
      replaceable: staff !== null && awaitingReplacement(staff, certificates),
      replaces: staff?.replacesCertificateId
        ? (numbers.get(staff.replacesCertificateId) ?? '')
        : '',
    }
  })
}

/**
 * Süzgeç alanları: durum ve listedeki kurlar (ada göre). İstemci tablosu satırdaki gösterim
 * metniyle karşılaştırdığından seçenek değerleri etikettir.
 */
export function certificateFilters(rows: readonly CertificateRow[]): FilterField[] {
  const courses = [...new Set(rows.map((row) => row.course))].sort((a, b) =>
    a.localeCompare(b, 'tr'),
  )
  return [
    {
      key: 'status',
      label: 'Durum',
      options: Object.values(CERTIFICATE_STATUSES).map(({ label }) => ({ value: label, label })),
    },
    { key: 'course', label: 'Kur', options: courses.map((label) => ({ value: label, label })) },
  ]
}

export const CERTIFICATE_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'number', label: 'Belge no' },
  { key: 'learner', label: 'Kursiyer' },
  { key: 'course', label: 'Kur' },
  { key: 'level', label: 'Seviye' },
  { key: 'status', label: 'Durum' },
  { key: 'issued', label: 'Düzenlenme tarihi' },
  { key: 'cancelled', label: 'İptal tarihi' },
  { key: 'replaces', label: 'Yerine düzenlendiği belge' },
]

/**
 * Belgeyi iptal etme ve yeniden düzenleme düğmesi kimde görünür: kurum yöneticisi ya da kurun
 * seviyesinin akademik koordinatörü öğretmen (DOM-DIL-081; Sabah kararı 85). Sunucu da aynı
 * kuralı uygular; düğme yalnız görünürlüktür.
 */
export function canManageCertificate(
  role: string | undefined,
  coordinatorLevels: ReadonlySet<string>,
  level: string,
): boolean {
  return role === 'yonetici' || (role === 'ogretmen' && coordinatorLevels.has(level))
}

/** Belgeye hak kazanan kursiyer satırı (MEBBİS listesi + kurum başarı belgesi durumu). */
export type EligibleRow = {
  id: string
  enrollmentId: string
  studentId: string
  decisionId: string
  learner: string
  certificate: string
  certificateState: 'valid' | 'replace' | 'none'
  /** Yeniden düzenlemede iptal edilen belge. */
  replacesCertificateId: string | null
  mebbis: string
  mebbisRecorded: boolean
}

export function eligibleRows(
  list: GroupMebbisList,
  certificates: readonly CourseCertificate[],
  names: ReadonlyMap<string, string>,
): EligibleRow[] {
  return list.learners.map((learner) => {
    const state = enrollmentCertificateState(learner.enrollmentId, certificates)
    const own = certificates.find(
      (certificate) =>
        isStaffCertificate(certificate) && certificate.enrollmentId === learner.enrollmentId,
    )
    return {
      id: learner.enrollmentId,
      enrollmentId: learner.enrollmentId,
      studentId: learner.studentId,
      decisionId: learner.decisionId,
      learner: names.get(learner.studentId) ?? own?.content.learnerName ?? 'Kursiyer',
      certificate:
        state.kind === 'valid'
          ? state.certificate.number
          : state.kind === 'replace'
            ? `${state.certificate.number} iptal edildi`
            : 'Düzenlenmedi',
      certificateState: state.kind,
      replacesCertificateId: state.kind === 'replace' ? state.certificate.id : null,
      mebbis: learner.record
        ? `${learner.record.certificateNumber} · ${certificateDate(learner.record.issuedDate)}`
        : 'İşaretlenmedi',
      mebbisRecorded: learner.record !== null,
    }
  })
}

/**
 * Belge satırının işlemleri: geçerli belgeyi iptal et; iptal edilmiş ve yerine belge düzenlenmemiş
 * belgede "Yeniden düzenle" (hak kazananlar listesinde, kaydın güncel kararıyla). Yalnız yönetici
 * ve seviyenin koordinatörü (DOM-DIL-082).
 */
export function certificateActions(
  row: Pick<CertificateRow, 'staff' | 'statusKey' | 'replaceable' | 'levelKey'>,
  role: string | undefined,
  coordinatorLevels: ReadonlySet<string>,
) {
  const manage = row.staff !== null && canManageCertificate(role, coordinatorLevels, row.levelKey)
  return {
    cancel: manage && row.statusKey === 'valid',
    reissue: manage && row.replaceable,
  }
}

/**
 * Hak kazanan satırının işlemleri (`canRecord` sunucudan: yönetici ya da koordinatör). Belge yoksa
 * "Belge düzenle", yerine belge bekleyen iptal varsa "Yeniden düzenle"; MEBBİS izi bir kez.
 */
export function eligibleActions(
  row: Pick<EligibleRow, 'certificateState' | 'mebbisRecorded'>,
  canRecord: boolean,
) {
  return {
    issue: canRecord && row.certificateState === 'none',
    reissue: canRecord && row.certificateState === 'replace',
    mebbis: canRecord && !row.mebbisRecorded,
  }
}
