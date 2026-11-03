import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { dayKey } from '../lib/format.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { CEFR_LEVELS, enumKeys, type CefrLevel } from '../content/taxonomy.ts'
import { CORE_SKILLS } from './suggestion.ts'
import {
  effectiveProgressionDecision,
  type ProgressionActor,
  type ProgressionDecisionRecord,
} from './progression.ts'

/**
 * Kurum başarı belgesi (docs/domain/dil-okulu.md DOM-DIL-080, 081, 082; IST-081; OG-088).
 *
 * - Belgeye hak, kur kaydının **geçerli** kararıdır (core `effectiveProgressionDecision`:
 *   düzeltilmemiş en son onaylı karar) ve sonucu `passed` olmalıdır. Onay bekleyen, tekrar ya da
 *   devamsızlıktan tamamlamadı kararında belge düzenlenmez (422).
 * - Belge içeriği düzenleme anının kopyasıdır (`certificateContentSchema`): kurum ve kursiyer adı,
 *   kur adı, toplam ders saati, devam (karar dayanağının kopyası), kurum değerlendirmesine göre
 *   seviye ve beceri profili (kararın kur sonu ölçmesindeki beceri puanları). Kopya bir daha
 *   değişmez; hata varsa belge iptal edilir ve yeni numarayla yeniden düzenlenir (DOM-DIL-082).
 * - Belge "kurum başarı belgesi"dir; seviye ifadesi "kurum değerlendirmesine göre CEFR B1
 *   düzeyinde" biçimindedir. "CEFR sertifikası", "Avrupa Konseyi" gibi ifadeler belgede yer almaz
 *   (DOM-DIL-081); kur ya da kurum adı bu ifadeleri taşıyorsa belge düzenlenmez.
 * - Belge numarası kurum içinde tekildir ve yeniden kullanılmaz: sıra numarasını servis kurum
 *   sayacından alır (veritabanı), burada yalnız biçimlenir.
 * - Doğrulama kodu en az 128 bit rastgeledir; rastgele baytlar dışarıdan verilir (saf modül), kod
 *   belge numarasından türetilmez. Doğrulama yanıtı kişisel veri olarak yalnız ad-soyad baş
 *   harflerini, kur adını ve tarihi taşır (DOM-DIL-082, KVKK md. 4).
 *
 * Yalnız `language_school`'dadır; okulda uç bulunmaz gibi davranır.
 */

z.config(z.locales.tr())

type Instant = Date | string
function toMs(value: Instant): number {
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (!Number.isFinite(ms)) {
    throw new DomainError('invalid_now', 'Geçerli bir tarih ve saat girin.', { path: ['now'] })
  }
  return ms
}
const toIso = (value: Instant) => new Date(toMs(value)).toISOString()

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)

function assertLanguageSchool(institutionType: InstitutionType): void {
  if (institutionType !== 'language_school') {
    throw new DomainError(
      'module_unavailable_for_type',
      'Kurum başarı belgesi yalnız dil okulunda kullanılır.',
      { kind: 'not_found' },
    )
  }
}

// --- Adlandırma (DOM-DIL-081) -------------------------------------------------------------

/** Belgenin adı; platformun ürettiği belge yalnız böyle adlandırılır (DOM-DIL-081). */
export const CERTIFICATE_TITLE = 'Kurum başarı belgesi'

/**
 * Belgede yer alamayacak ifadeler (DOM-DIL-081): CEFR bir sertifika değildir, Avrupa Konseyi
 * kurum onaylamaz. Karşılaştırma Türkçe küçük harfle yapılır.
 */
export const FORBIDDEN_CERTIFICATE_PHRASES = [
  'cefr sertifikası',
  'cefr sertifika',
  'cefr certificate',
  'avrupa konseyi',
  'council of europe',
] as const

/** Metin yasak ifade içeriyor mu (büyük/küçük harf ve boşluk farkı gözetilmez). */
export function containsForbiddenPhrase(text: string): boolean {
  const normalized = text.toLocaleLowerCase('tr').replace(/\s+/g, ' ')
  return FORBIDDEN_CERTIFICATE_PHRASES.some((phrase) => normalized.includes(phrase))
}

/** Seviye ifadesi: "kurum değerlendirmesine göre CEFR B1 düzeyinde" (DOM-DIL-081). */
export function certificateLevelStatement(level: CefrLevel): string {
  return `kurum değerlendirmesine göre CEFR ${CEFR_LEVELS[level].label} düzeyinde`
}

// --- Durum, numara ve doğrulama kodu (DOM-DIL-082) ----------------------------------------

/** Belgenin durumu: düzenlenmiş belge geçerlidir; iptal bir kez yazılır ve geri alınmaz. */
export const CERTIFICATE_STATUSES = {
  valid: { label: 'Geçerli' },
  cancelled: { label: 'İptal edildi' },
} as const
export type CertificateStatus = keyof typeof CERTIFICATE_STATUSES

/** Belge numarası öneki: `KB-2026-000001` (kurum başarı belgesi). */
export const CERTIFICATE_NUMBER_PREFIX = 'KB'

/**
 * Belge numarası: önek, düzenleme yılı (Europe/Istanbul) ve kurum sayacının sıra numarası. Sıra
 * kurum içinde tekildir ve yıl başında sıfırlanmaz; yıl yalnız okunurluk içindir, tekillik sıra
 * numarasındadır.
 */
export function formatCertificateNumber(serial: number, issuedAt: Instant): string {
  if (!Number.isSafeInteger(serial) || serial < 1) {
    throw new DomainError('certificate_serial_invalid', 'Belge sıra numarası geçersiz.', {
      path: ['serial'],
    })
  }
  const year = dayKey(toMs(issuedAt)).slice(0, 4)
  return `${CERTIFICATE_NUMBER_PREFIX}-${year}-${String(serial).padStart(6, '0')}`
}

/**
 * Crockford base32 alfabesi: I, L, O, U yoktur; okunurken karışan harfler (`I`/`L` → `1`, `O` →
 * `0`) normalleştirmede çevrilir.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Kodun rastgele bayt sayısı: 18 bayt (144 bit), kodda 140 bit kullanılır (≥ 128). */
export const VERIFICATION_CODE_BYTES = 18
const CODE_LENGTH = 28
const GROUP_SIZE = 4
/** Kodun biçimi: yedi dörtlü grup, `ABCD-EFGH-…`. */
export const VERIFICATION_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/

/**
 * Rastgele baytlardan doğrulama kodu (DOM-DIL-082): 140 bit, Crockford base32, dörtlü gruplar.
 * Baytlar çağırandan gelir (API `node:crypto` `randomBytes`); kod belge numarasından türetilmez.
 */
export function formatVerificationCode(bytes: Uint8Array): string {
  if (bytes.length !== VERIFICATION_CODE_BYTES) {
    throw new DomainError('verification_code_entropy', 'Doğrulama kodu üretilemedi.', {
      path: ['bytes'],
    })
  }
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CROCKFORD[Number.parseInt(bits.slice(index * 5, index * 5 + 5), 2)]
  }
  return code.match(/.{4}/g)?.join('-') ?? code
}

/**
 * Kullanıcının yazdığı ya da QR'dan gelen kodu kanonik biçime getirir; biçim bozuksa `null`.
 * Büyük/küçük harf, boşluk ve tire gözetilmez; `I`/`L` → `1`, `O` → `0` (Crockford).
 */
export function normalizeVerificationCode(input: string): string | null {
  if (input.length > 64) return null
  const compact = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (compact.length !== CODE_LENGTH) return null
  for (const char of compact) if (!CROCKFORD.includes(char)) return null
  const grouped = compact.match(new RegExp(`.{${GROUP_SIZE}}`, 'g'))?.join('-') ?? null
  return grouped !== null && VERIFICATION_CODE_PATTERN.test(grouped) ? grouped : null
}

/** Ad-soyad baş harfleri: "Deniz Yılmaz" → "D. Y." (Türkçe büyük harf). */
export function nameInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/[\s-]+/)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toLocaleUpperCase('tr')}.`)
    .join(' ')
}

// --- Belge içeriği ------------------------------------------------------------------------

const score100 = z.number().min(0).max(100)
const nonEmpty = z.string().trim().min(1).max(200)

/**
 * Düzenleme anının kopyası (DOM-DIL-081). Belge sonradan değişmez; kur adı, kurum adı, puanlar ya
 * da devam sonradan değişse de belge kendi kopyasını gösterir. Devam oranı binde tamsayıdır
 * (aşağı yuvarlanır) ve belgede görünen değer olduğu için kopyaya yazılır.
 */
export const certificateContentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.literal(CERTIFICATE_TITLE),
  institutionName: nonEmpty,
  // kvkk: K (kursiyerin ad-soyadı; belgede görünür)
  learnerName: nonEmpty,
  courseId: identifier,
  courseName: nonEmpty,
  level: z.enum(enumKeys(CEFR_LEVELS)),
  levelStatement: z.string().min(1),
  totalHours: z.number().int().min(1),
  // kvkk: Ç (kursiyerin devam ve beceri puanları)
  attendance: z.object({
    attendedHours: z.number().int().min(0),
    totalHours: z.number().int().min(1),
    permille: z.number().int().min(0).max(1000),
  }),
  finalScore: score100,
  skills: z.array(z.object({ skill: z.enum(CORE_SKILLS), score: score100 })),
  decisionId: identifier,
  approvedAt: z.iso.datetime(),
})
export type CertificateContent = z.output<typeof certificateContentSchema>

/** Saklanan belge satırı (API `course_certificates`). */
export type CertificateRecord = {
  id: string
  enrollmentId: string
  learnerId: string
  courseId: string
  decisionId: string
  serial: number
  number: string
  verificationCode: string
  status: CertificateStatus
  content: CertificateContent
  replacesCertificateId: string | null
  // kvkk: K
  issuedByUserId: string
  issuedAt: string
  // kvkk: K
  cancelledByUserId: string | null
  cancelledAt: string | null
  // kvkk: K
  cancellationReason: string | null
}

/** Düzenleme planı: numara ve kod servis tarafından eklenir. */
export type CertificateDraft = Omit<
  CertificateRecord,
  'id' | 'serial' | 'number' | 'verificationCode'
>

// --- Yetki --------------------------------------------------------------------------------

/**
 * Belgeyi düzenleyen ve iptal eden: kurum yöneticisi ya da kurun seviyesinin akademik
 * koordinatörü (`ProgressionActor.coordinator`, servis kurun seviyesine göre çözer). Belge akademik
 * yargı değildir, onaylı kararın kurum adına belgelenmesidir; bu yüzden kararı onaylamayan
 * yönetici de düzenler (kararın kendisini yalnız koordinatör onaylar, DOM-DIL-070).
 */
export function canIssueCertificate(actor: ProgressionActor): boolean {
  return actor.role === 'yonetici' || (actor.role === 'ogretmen' && actor.coordinator === true)
}

function assertIssuer(actor: ProgressionActor, what: string) {
  if (!canIssueCertificate(actor)) {
    throw new DomainError(
      'permission_denied',
      `${what} kurum yöneticisi ya da kurun akademik koordinatörü yapar.`,
      { kind: 'forbidden' },
    )
  }
}

// --- Belgeye hak (DOM-DIL-080, 081) -------------------------------------------------------

/**
 * Kaydın belgeye hakkı: geçerli karar onaylı `passed` olmalıdır. Hak yoksa nedenini taşıyan
 * Türkçe 422 `DomainError`, varsa geçerli karar döner.
 */
export function certificateEligibleDecision<T extends ProgressionDecisionRecord>(
  decisions: readonly T[],
): T {
  const effective = effectiveProgressionDecision(decisions)
  if (effective === null) {
    if (decisions.some((d) => d.status === 'pending')) {
      throw new DomainError(
        'certificate_decision_pending',
        'Kur sonu kararı onay bekliyor; belge onaylı geçti kararıyla düzenlenir.',
        { path: ['decisionId'] },
      )
    }
    throw new DomainError(
      'certificate_no_decision',
      'Onaylı kur sonu kararı yok; belge düzenlenemez.',
      { path: ['decisionId'] },
    )
  }
  switch (effective.outcome) {
    case 'passed':
      return effective
    case 'repeat':
      throw new DomainError(
        'certificate_not_eligible',
        'Kursiyer kuru tekrar edecek; kurum başarı belgesi düzenlenmez.',
        { path: ['decisionId'] },
      )
    case 'incomplete_attendance':
      throw new DomainError(
        'certificate_not_eligible',
        'Devam şartı sağlanmadı; kurum başarı belgesi düzenlenmez.',
        { path: ['decisionId'] },
      )
    default:
      return effective.outcome satisfies never
  }
}

/** Düzenleme gövdesi: belgenin dayandığı karar; yeniden düzenlemede iptal edilen belge. */
export const certificateIssueInputSchema = z.object({
  decisionId: identifier,
  replacesCertificateId: identifier.nullable().default(null),
})
export type CertificateIssueInput = z.input<typeof certificateIssueInputSchema>

/** Belge içeriğinin girdileri: kurum, kursiyer ve kur (servis yükler). */
export type CertificateSubject = {
  institutionName: string
  // kvkk: K
  learnerName: string
  course: { id: string; name: string; level: CefrLevel; totalHours: number }
}

function contentOf(subject: CertificateSubject, decision: ProgressionDecisionRecord) {
  const final = decision.basis.assessments.find((row) => row.point === 'final')
  if (final === undefined) {
    // Onaylı `passed` kararı kur sonu ölçmesi olmadan verilemez (core `evaluateProgression`).
    throw new DomainError(
      'certificate_basis_incomplete',
      'Karar dayanağında kur sonu değerlendirmesi yok; belge düzenlenemez.',
      { path: ['decisionId'] },
    )
  }
  const { attendance } = decision.basis
  const learnerName = subject.learnerName.trim()
  if (learnerName === '') {
    throw new DomainError(
      'certificate_learner_name_missing',
      'Kursiyerin adı kayıtlı değil; belge düzenlenemez.',
      { path: ['learnerName'] },
    )
  }
  for (const [field, text] of [
    ['institutionName', subject.institutionName],
    ['courseName', subject.course.name],
  ] as const) {
    if (containsForbiddenPhrase(text)) {
      throw new DomainError(
        'certificate_wording_forbidden',
        'Belgede “CEFR sertifikası” ya da “Avrupa Konseyi” gibi ifadeler yer alamaz; kur veya kurum adını düzeltin.',
        { path: [field] },
      )
    }
  }
  return certificateContentSchema.parse({
    schemaVersion: 1,
    title: CERTIFICATE_TITLE,
    institutionName: subject.institutionName,
    learnerName,
    courseId: subject.course.id,
    courseName: subject.course.name,
    level: subject.course.level,
    levelStatement: certificateLevelStatement(subject.course.level),
    totalHours: subject.course.totalHours,
    attendance: {
      attendedHours: attendance.attendedHours,
      totalHours: attendance.totalHours,
      permille: Math.floor((attendance.attendedHours * 1000) / attendance.totalHours),
    },
    finalScore: final.score,
    skills: CORE_SKILLS.flatMap((skill) =>
      final.skills.filter((s) => s.skill === skill).map((s) => ({ skill, score: s.score })),
    ),
    decisionId: decision.id,
    approvedAt: decision.reviewedAt ?? decision.decidedAt,
  })
}

/**
 * Belgeyi düzenler (DOM-DIL-080, 081, 082). Hiçbir şeyi değiştirmez; yazılacak satırı döndürür,
 * numarayı ve doğrulama kodunu servis ekler.
 *
 * - `decisionId` kaydın geçerli kararı olmalı ve onaylı `passed` olmalıdır (422).
 * - Aynı karar için geçerli belge varsa 409 `certificate_already_issued` (veritabanında da kısmi
 *   tekil indeks).
 * - `replacesCertificateId` verilirse aynı kaydın iptal edilmiş ve henüz yerine belge
 *   düzenlenmemiş belgesi olmalıdır; aksi halde 422/409.
 */
export function planCertificateIssue(input: {
  institutionType: InstitutionType
  enrollment: { id: string; learnerId: string; courseId: string }
  /** Kaydın bütün kur sonu kararları. */
  decisions: readonly ProgressionDecisionRecord[]
  /** Kaydın bütün belgeleri (geçerli ve iptal). */
  certificates: readonly Pick<
    CertificateRecord,
    'id' | 'enrollmentId' | 'decisionId' | 'status' | 'replacesCertificateId'
  >[]
  subject: CertificateSubject
  actor: ProgressionActor
  input: unknown
  now: Instant
}): CertificateDraft {
  assertLanguageSchool(input.institutionType)
  assertIssuer(input.actor, 'Kurum başarı belgesini')
  const data = certificateIssueInputSchema.parse(input.input)
  const own = input.decisions.filter((d) => d.enrollmentId === input.enrollment.id)
  if (!own.some((d) => d.id === data.decisionId)) {
    throw new DomainError('progression_not_found', 'Kur sonu kararı bulunamadı.', {
      kind: 'not_found',
      path: ['decisionId'],
    })
  }
  const effective = certificateEligibleDecision(own)
  if (effective.id !== data.decisionId) {
    throw new DomainError(
      'certificate_decision_superseded',
      'Bu karar düzeltildi; belge kaydın geçerli kararıyla düzenlenir.',
      { path: ['decisionId'] },
    )
  }
  if (effective.courseId !== input.subject.course.id) {
    throw new DomainError('progression_course_mismatch', 'Karar bu kura ait değil.', {
      path: ['decisionId'],
    })
  }
  const certificates = input.certificates.filter((c) => c.enrollmentId === input.enrollment.id)
  if (certificates.some((c) => c.decisionId === effective.id && c.status === 'valid')) {
    throw new DomainError(
      'certificate_already_issued',
      'Bu karar için geçerli bir belge var; hata varsa belge iptal edilip yeniden düzenlenir.',
      { kind: 'conflict', path: ['decisionId'] },
    )
  }
  if (data.replacesCertificateId !== null) {
    const replaced = certificates.find((c) => c.id === data.replacesCertificateId)
    if (replaced === undefined) {
      throw new DomainError('certificate_not_found', 'Yerine düzenlenecek belge bulunamadı.', {
        kind: 'not_found',
        path: ['replacesCertificateId'],
      })
    }
    if (replaced.status !== 'cancelled') {
      throw new DomainError(
        'certificate_replace_not_cancelled',
        'Yalnız iptal edilmiş belgenin yerine yeni belge düzenlenir.',
        { path: ['replacesCertificateId'] },
      )
    }
    if (certificates.some((c) => c.replacesCertificateId === replaced.id)) {
      throw new DomainError(
        'certificate_already_replaced',
        'Bu belgenin yerine yeni belge zaten düzenlendi.',
        { kind: 'conflict', path: ['replacesCertificateId'] },
      )
    }
  }
  return {
    enrollmentId: input.enrollment.id,
    learnerId: input.enrollment.learnerId,
    courseId: effective.courseId,
    decisionId: effective.id,
    status: 'valid',
    content: contentOf(input.subject, effective),
    replacesCertificateId: data.replacesCertificateId,
    issuedByUserId: input.actor.userId,
    issuedAt: toIso(input.now),
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
  }
}

// --- İptal (DOM-DIL-082) ------------------------------------------------------------------

/** İptal gerekçesinin üst sınırı (denetim kaydı `reason` sınırıyla aynı). */
export const CANCELLATION_REASON_MAX = 500

/** İptal gövdesi: gerekçe zorunlu. */
export const certificateCancelInputSchema = z.object({
  // kvkk: K
  reason: z
    .string()
    .trim()
    .min(1, 'İptal gerekçesini yazın.')
    .max(CANCELLATION_REASON_MAX, 'En fazla 500 karakter girebilirsiniz.'),
})
export type CertificateCancelInput = z.input<typeof certificateCancelInputSchema>

export type CertificateCancellation = Pick<
  CertificateRecord,
  'status' | 'cancelledByUserId' | 'cancelledAt' | 'cancellationReason'
>

/**
 * Belgeyi iptal eder (DOM-DIL-082): yalnız geçerli belge, gerekçeyle ve bir kez. İçerik, numara ve
 * kod değişmez; doğrulama sorgusu bundan sonra "iptal edildi" döner. Hiçbir şeyi değiştirmez,
 * yazılacak iptal alanlarını döndürür.
 */
export function planCertificateCancellation(input: {
  institutionType: InstitutionType
  certificate: Pick<CertificateRecord, 'status' | 'issuedAt'>
  actor: ProgressionActor
  input: unknown
  now: Instant
}): CertificateCancellation {
  assertLanguageSchool(input.institutionType)
  assertIssuer(input.actor, 'Kurum başarı belgesinin iptalini')
  const data = certificateCancelInputSchema.parse(input.input)
  if (input.certificate.status !== 'valid') {
    throw new DomainError('certificate_already_cancelled', 'Bu belge zaten iptal edildi.', {
      kind: 'conflict',
    })
  }
  const cancelledAt = toIso(input.now)
  if (cancelledAt < input.certificate.issuedAt) {
    throw new DomainError('invalid_now', 'İptal anı düzenleme anından önce olamaz.', {
      path: ['now'],
    })
  }
  return {
    status: 'cancelled',
    cancelledByUserId: input.actor.userId,
    cancelledAt,
    cancellationReason: data.reason,
  }
}

// --- Doğrulama (DOM-DIL-082) --------------------------------------------------------------

/**
 * Kimliksiz doğrulama yanıtı: kişisel veri olarak yalnız ad-soyad baş harfleri; kur adı, düzenleme
 * günü (Europe/Istanbul), durum ve kurum adı. Belge numarası, öğrenci kimliği, doğum tarihi, e-posta
 * ve puanlar yer almaz.
 */
export type CertificateVerification = {
  status: CertificateStatus
  // kvkk: K (yalnız baş harfler)
  learnerInitials: string
  courseName: string
  issuedDate: string
  institutionName: string
}

export function certificateVerificationView(
  certificate: Pick<CertificateRecord, 'status' | 'content' | 'issuedAt'>,
): CertificateVerification {
  return {
    status: certificate.status,
    learnerInitials: nameInitials(certificate.content.learnerName),
    courseName: certificate.content.courseName,
    issuedDate: dayKey(toMs(certificate.issuedAt)),
    institutionName: certificate.content.institutionName,
  }
}
