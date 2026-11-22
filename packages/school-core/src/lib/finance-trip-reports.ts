import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import type { TripPlanStatus } from './finance-trip-plans.ts'

/**
 * Gezi sonrası rapor, rızalı fotoğraf ve katılımcı değerlendirmesi (docs/domain/finans.md
 * DOM-FIN-158; ON-158; K-529…K-531; IST-017).
 *
 * - **Rapor (K-529):** gezi bitince (plan onaylı ya da tamamlanmış ve dönüş anı geçmiş) planın
 *   görevlisi (sorumlu ya da görevli öğretmen) ya da yönetici gerçekleşme özeti, olaylar (kaza
 *   tutanağına bağlantı, ayrıntı değil) ve kazanım/değerlendirme metnini yazar. Taslak → gönderildi →
 *   yönetici onayı ya da gerekçeli iade; iade edilen düzeltilip yeniden gönderilir. Onaylanan rapor
 *   değişmez. Katılan ve katılmayan sayısı gezi günü yoklamasından (DOM-FIN-154) hesaplanır,
 *   gönderimde dondurulur.
 * - **Fotoğraf (K-530):** rapora fotoğraf eklenir; görünen her öğrenci etiketlenir ya da "öğrenci
 *   görünmüyor" işaretlenir. Aileye yayım için etiketli her öğrencinin geçerli `photo_video_sharing`
 *   rızası şarttır (DOM-YTK-061); rıza okuma anında denetlenir, geri çekilen rıza yayımlanmış
 *   fotoğrafı yayından düşürür.
 * - **Değerlendirme (K-531):** katılan öğrenci ve velisi gezi başına bir kez 1–5 puan ve isteğe
 *   bağlı yorum verir; özet 5'ten az yanıtta gizlidir, yorumlar hiçbir zaman ad taşımaz.
 *
 * Fonksiyonlar saftır; an `now` ile gelir.
 */

// --- Roller --------------------------------------------------------------------------------------

/** Rapor uçlarına giren personel; öğretmen yalnız görevlisi olduğu planı görür (K-529). */
export const TRIP_REPORT_ROLES = [
  'yonetici',
  'onburo',
  'ogretmen',
] as const satisfies readonly Role[]
/** Raporu yazan roller: planın görevlisi öğretmen ve yönetici (K-529). */
export const TRIP_REPORT_AUTHOR_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]
/** Onay ve iade yalnız yöneticidedir (K-529). */
export const TRIP_REPORT_APPROVER_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Değerlendirme veren ve yayımlanmış fotoğrafları gören aile rolleri (K-530, K-531). */
export const TRIP_REPORT_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

// --- Sabitler ------------------------------------------------------------------------------------

export const TRIP_REPORT_STATUSES = ['draft', 'submitted', 'approved', 'returned'] as const
export type TripReportStatus = (typeof TRIP_REPORT_STATUSES)[number]
export const TRIP_REPORT_STATUS_LABELS = {
  draft: 'Taslak',
  submitted: 'Onay bekliyor',
  approved: 'Onaylandı',
  returned: 'İade edildi',
} as const satisfies Record<TripReportStatus, string>
/** Liste süzgeci: raporu henüz açılmamış biten gezi `missing`. */
export const TRIP_REPORT_LIST_STATUSES = ['missing', ...TRIP_REPORT_STATUSES] as const
export type TripReportListStatus = (typeof TRIP_REPORT_LIST_STATUSES)[number]
export const TRIP_REPORT_LIST_STATUS_LABELS = {
  missing: 'Rapor yazılmadı',
  ...TRIP_REPORT_STATUS_LABELS,
} as const satisfies Record<TripReportListStatus, string>

/** Düzeltilebilen durumlar: taslak ve iade edilmiş (K-529). */
export const TRIP_REPORT_EDITABLE_STATUSES = [
  'draft',
  'returned',
] as const satisfies readonly TripReportStatus[]
/** Raporu açılabilen plan durumları: onaylı ya da tamamlanmış (K-529). */
export const TRIP_REPORT_PLAN_STATUSES = [
  'approved',
  'completed',
] as const satisfies readonly TripPlanStatus[]

export const TRIP_REPORT_SUMMARY_MAX = 4000
export const TRIP_REPORT_SUMMARY_MIN = 20
export const TRIP_REPORT_INCIDENT_NOTE_MAX = 2000
export const TRIP_REPORT_OUTCOME_MAX = 4000
export const TRIP_REPORT_OUTCOME_MIN = 20
export const TRIP_REPORT_INCIDENTS_MAX = 10
export const TRIP_REPORT_REASON_MIN = 5
export const TRIP_REPORT_REASON_MAX = 500
export const TRIP_REPORT_PHOTOS_MAX = 20
export const TRIP_REPORT_PHOTO_TAGS_MAX = 60
export const TRIP_REPORT_CAPTION_MAX = 200
export const TRIP_EVALUATION_COMMENT_MAX = 500
export const TRIP_EVALUATION_SCORE_MIN = 1
export const TRIP_EVALUATION_SCORE_MAX = 5
/** Değerlendirme dönüşten sonra bu kadar gün açıktır (K-531). */
export const TRIP_EVALUATION_WINDOW_DAYS = 30
/** Özetin (ortalama, dağılım, yorumlar) gösterildiği en az yanıt (K-531; küçük grup gizleme). */
export const TRIP_EVALUATION_MIN_GROUP = 5

const DAY_MS = 86_400_000

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, maxMessage(max))
    .transform((value) => (value === '' ? null : value))
    .nullable()
const studentId = z
  .string('Öğrenciyi seçin.')
  .trim()
  .min(1, 'Öğrenciyi seçin.')
  .max(100, 'Öğrenci geçersiz.')

const reportFields = {
  // kvkk: K (serbest metin; öğrenci adı geçebilir)
  summary: optionalText(TRIP_REPORT_SUMMARY_MAX).describe(
    'Gerçekleşme özeti: gezi planlandığı gibi mi gerçekleşti, değişiklikler (göndermede en az 20 karakter)',
  ),
  // kvkk: K (serbest metin; olayın kısa anlatımı, sağlık ayrıntısı yazılmaz)
  incidentNote: optionalText(TRIP_REPORT_INCIDENT_NOTE_MAX).describe(
    'Olaylar: kısa not; kaza ve yaralanma ayrıntısı kaza tutanağındadır (`incidentIds`)',
  ),
  incidentIds: z
    .array(z.uuid('Kaza tutanağı geçersiz.'), 'Kaza tutanaklarını seçin.')
    .max(
      TRIP_REPORT_INCIDENTS_MAX,
      `En fazla ${String(TRIP_REPORT_INCIDENTS_MAX)} tutanak bağlanır.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı tutanak iki kez seçilemez.')
    .describe('Gezide yazılmış kaza tutanakları (DOM-FIN-146); olay anı gezi süresi içinde olmalı'),
  // kvkk: K (serbest metin)
  outcomeNote: optionalText(TRIP_REPORT_OUTCOME_MAX).describe(
    'Kazanımlar ve değerlendirme: amaca ulaşıldı mı, öneriler (göndermede en az 20 karakter)',
  ),
}

/** Rapor taslağı (K-529): metinler taslakta boş kalabilir, gönderimde zorunludur. */
export const tripReportCreateSchema = z.strictObject({
  summary: reportFields.summary.default(null),
  incidentNote: reportFields.incidentNote.default(null),
  incidentIds: reportFields.incidentIds.default([]),
  outcomeNote: reportFields.outcomeNote.default(null),
})
export type TripReportCreateInput = z.input<typeof tripReportCreateSchema>
export type TripReportFields = z.output<typeof tripReportCreateSchema>

/** Rapor düzeltme: verilen alanlar değişir, en az biri gerekir. */
export const tripReportUpdateSchema = z
  .strictObject({
    summary: reportFields.summary.optional(),
    incidentNote: reportFields.incidentNote.optional(),
    incidentIds: reportFields.incidentIds.optional(),
    outcomeNote: reportFields.outcomeNote.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
    path: ['summary'],
  })
export type TripReportChanges = z.output<typeof tripReportUpdateSchema>

/** Gönderme ve onay gövdesi boştur; sürüm `If-Match` ile gelir. */
export const tripReportTransitionSchema = z.strictObject({})

/** İade (K-529): gerekçe zorunlu. */
export const tripReportReturnSchema = z.strictObject({
  // kvkk: K (serbest metin)
  reason: z
    .string('İade gerekçesini yazın.')
    .trim()
    .min(TRIP_REPORT_REASON_MIN, `Gerekçe en az ${String(TRIP_REPORT_REASON_MIN)} karakter olmalı.`)
    .max(TRIP_REPORT_REASON_MAX, maxMessage(TRIP_REPORT_REASON_MAX))
    .describe('Raporda düzeltilmesi istenenler'),
})

const photoTags = z
  .array(studentId, 'Etiketlenen öğrencileri seçin.')
  .max(
    TRIP_REPORT_PHOTO_TAGS_MAX,
    `Bir fotoğrafa en fazla ${String(TRIP_REPORT_PHOTO_TAGS_MAX)} öğrenci etiketlenir.`,
  )
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı öğrenci iki kez etiketlenemez.')
  .describe('Fotoğrafta görünen gezi katılımcıları (records kimliği)')
const noStudentsVisible = z
  .boolean()
  .describe('Fotoğrafta tanınabilir öğrenci yok (manzara, eser); etiket boş kalır')
const shareWithFamilies = z
  .boolean()
  .describe(
    'Aileye yayım isteği; yalnız rapor onaylı ve etiketli herkesin geçerli fotoğraf rızası varken yayımlanır',
  )
// kvkk: K (serbest metin)
const caption = optionalText(TRIP_REPORT_CAPTION_MAX).describe('Kısa açıklama (ör. "Müze girişi")')

const TAGS_REQUIRED =
  'Fotoğrafta görünen öğrencileri etiketleyin ya da "Öğrenci görünmüyor"u işaretleyin.'
const TAGS_CONFLICT = 'Öğrenci etiketlenen fotoğraf "öğrenci görünmüyor" olarak işaretlenemez.'

/** Fotoğraf ekleme (K-530): yüklenmiş dosya, etiketler ve yayım isteği. */
export const tripReportPhotoSchema = z
  .strictObject({
    fileId: z
      .uuid('Fotoğraf dosyası geçersiz.')
      .describe('`question_image` amacıyla yüklenen dosya'),
    caption: caption.default(null),
    studentIds: photoTags.default([]),
    noStudentsVisible: noStudentsVisible.default(false),
    shareWithFamilies: shareWithFamilies.default(true),
  })
  .superRefine((value, ctx) => {
    const issue = photoTagIssue(value.studentIds, value.noStudentsVisible)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: ['studentIds'], message: issue })
  })
export type TripReportPhotoInput = z.input<typeof tripReportPhotoSchema>
export type TripReportPhotoFields = z.output<typeof tripReportPhotoSchema>

/** Fotoğraf düzeltme: verilen alanlar değişir; etiket kuralı birleşik değerde denetlenir. */
export const tripReportPhotoUpdateSchema = z
  .strictObject({
    caption: caption.optional(),
    studentIds: photoTags.optional(),
    noStudentsVisible: noStudentsVisible.optional(),
    shareWithFamilies: shareWithFamilies.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
    path: ['caption'],
  })
export type TripReportPhotoChanges = z.output<typeof tripReportPhotoUpdateSchema>

/** Katılımcı değerlendirmesi (K-531): gezi, öğrenci (veli için çocuğu), puan, isteğe bağlı yorum. */
export const tripEvaluationSchema = z.strictObject({
  planId: z.uuid('Gezi geçersiz.'),
  studentId: studentId.describe('Geziye katılan öğrenci (veli için çocuğu, öğrenci için kendisi)'),
  score: z
    .number('Puanı seçin.')
    .int('Puan tam sayı olmalı.')
    .min(TRIP_EVALUATION_SCORE_MIN, 'Puan 1 ile 5 arasında olmalı.')
    .max(TRIP_EVALUATION_SCORE_MAX, 'Puan 1 ile 5 arasında olmalı.')
    .describe('1 (hiç memnun değilim) – 5 (çok memnunum)'),
  // kvkk: K (serbest metin; personele ad olmadan döner)
  comment: optionalText(TRIP_EVALUATION_COMMENT_MAX)
    .default(null)
    .describe('İsteğe bağlı yorum; personele ad ve rol olmadan, en az 5 yanıtta gösterilir'),
})
export type TripEvaluationInput = z.input<typeof tripEvaluationSchema>
export type TripEvaluationFields = z.output<typeof tripEvaluationSchema>

// --- Erişim --------------------------------------------------------------------------------------

export interface TripReportActor {
  role: Role
  membershipId: string
}

export interface TripReportAccess {
  /** Raporu ve fotoğrafları okur. */
  read: boolean
  /** Rapor açar, düzeltir, fotoğraf ekler ve gönderir. */
  write: boolean
  /** Onaylar ya da iade eder. */
  decide: boolean
}

/**
 * Rapor yetkisi (K-529): yönetici her raporu okur, yazar ve karara bağlar; ön büro okur; öğretmen
 * yalnız görevlisi olduğu planın raporunu okur ve yazar (başkası 404). Aile ve diğer roller yok.
 */
export function tripReportAccess(
  actor: TripReportActor,
  staffMembershipIds: readonly string[],
): TripReportAccess {
  const staff = staffMembershipIds.includes(actor.membershipId)
  if (actor.role === 'yonetici') return { read: true, write: true, decide: true }
  if (actor.role === 'onburo') return { read: true, write: false, decide: false }
  if (actor.role === 'ogretmen') return { read: staff, write: staff, decide: false }
  return { read: false, write: false, decide: false }
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

export interface TripReportPlanFacts {
  status: TripPlanStatus
  returnAt: string
}

/** Gezi bitti mi: plan onaylı ya da tamamlanmış ve dönüş anı geçmiş (tamamlanmış plan bitmiştir). */
export function isTripFinished(plan: TripReportPlanFacts, now: Date): boolean {
  if (plan.status === 'completed') return true
  return plan.status === 'approved' && new Date(plan.returnAt).getTime() <= now.getTime()
}

/**
 * Raporun açılabilmesi (K-529): plan onaylı ya da tamamlanmış olmalı (422
 * `trip_report_plan_not_eligible`) ve gezi bitmiş olmalı (422 `trip_report_trip_not_finished`).
 */
export function assertTripReportPlan(plan: TripReportPlanFacts, now: Date): void {
  if (!(TRIP_REPORT_PLAN_STATUSES as readonly string[]).includes(plan.status))
    throw ruleError(
      'trip_report_plan_not_eligible',
      'Rapor yalnız onaylanmış ya da tamamlanmış gezi için yazılır.',
    )
  if (!isTripFinished(plan, now))
    throw ruleError('trip_report_trip_not_finished', 'Gezi bitmeden rapor yazılamaz.')
}

function assertWriter(access: TripReportAccess): void {
  if (!access.write)
    throw new DomainError(
      'trip_report_write_forbidden',
      'Raporu planın görevlisi öğretmen ya da yönetici yazar.',
      { kind: 'forbidden' },
    )
}

function assertEditable(status: TripReportStatus): void {
  if (!(TRIP_REPORT_EDITABLE_STATUSES as readonly string[]).includes(status))
    throw ruleError(
      'trip_report_locked',
      status === 'approved'
        ? 'Onaylanan rapor değiştirilemez.'
        : 'Onay bekleyen rapor değiştirilemez; yönetici iade ederse düzeltilir.',
    )
}

/** Kaza tutanağı bağı için tutanağın gerekli bilgisi. */
export interface TripReportIncidentFacts {
  id: string
  occurredAt: string
}

/**
 * Kaza tutanağı bağları (K-529): kurumun tutanağı (422 `trip_report_incident_not_found`) ve olay anı
 * gezinin çıkış–dönüş aralığında (422 `trip_report_incident_outside_trip`). Tutanağın ayrıntısı
 * rapora kopyalanmaz; yalnız bağ tutulur.
 */
export function assertTripReportIncidents(
  incidentIds: readonly string[],
  found: ReadonlyMap<string, TripReportIncidentFacts>,
  plan: { departureAt: string; returnAt: string },
): void {
  const from = new Date(plan.departureAt).getTime()
  const to = new Date(plan.returnAt).getTime()
  incidentIds.forEach((id, index) => {
    const incident = found.get(id)
    if (incident === undefined)
      throw ruleError('trip_report_incident_not_found', 'Kaza tutanağı bulunamadı.', [
        'incidentIds',
        String(index),
      ])
    const at = new Date(incident.occurredAt).getTime()
    if (at < from || at > to)
      throw ruleError(
        'trip_report_incident_outside_trip',
        'Kaza tutanağının olay anı gezinin çıkış ve dönüşü arasında olmalı.',
        ['incidentIds', String(index)],
      )
  })
}

/**
 * Rapor açma (K-529): yazma yetkisi, gezi bitmiş, planın raporu yok (409 `trip_report_exists`;
 * tekil indeks son güvence).
 */
export function planTripReportCreate(checks: {
  access: TripReportAccess
  plan: TripReportPlanFacts
  exists: boolean
  now: Date
}): void {
  assertWriter(checks.access)
  assertTripReportPlan(checks.plan, checks.now)
  if (checks.exists)
    throw new DomainError('trip_report_exists', 'Bu gezinin raporu zaten açılmış.', {
      kind: 'conflict',
    })
}

type ReportText = Pick<TripReportFields, 'summary' | 'incidentNote' | 'outcomeNote'> & {
  incidentIds: readonly string[]
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

/**
 * Rapor düzeltme (K-529): yazma yetkisi; yalnız taslak ve iade edilmiş rapor (422
 * `trip_report_locked`); değişen alanlar döner, değişiklik yoksa 422 `trip_report_unchanged`.
 */
export function planTripReportUpdate(
  changes: TripReportChanges,
  current: ReportText & { status: TripReportStatus },
  access: TripReportAccess,
): (keyof TripReportChanges)[] {
  assertWriter(access)
  assertEditable(current.status)
  const changed: (keyof TripReportChanges)[] = []
  if (changes.summary !== undefined && changes.summary !== current.summary) changed.push('summary')
  if (changes.incidentNote !== undefined && changes.incidentNote !== current.incidentNote)
    changed.push('incidentNote')
  if (changes.outcomeNote !== undefined && changes.outcomeNote !== current.outcomeNote)
    changed.push('outcomeNote')
  if (changes.incidentIds !== undefined && !sameIds(changes.incidentIds, current.incidentIds))
    changed.push('incidentIds')
  if (changed.length === 0) throw ruleError('trip_report_unchanged', 'Raporda değişiklik yok.')
  return changed
}

/**
 * Gönderme (K-529): yazma yetkisi; taslak ya da iade edilmiş; gerçekleşme özeti ve kazanım metni en
 * az 20 karakter (422 `trip_report_incomplete`, alan yolu ile).
 */
export function assertTripReportSubmit(
  report: ReportText & { status: TripReportStatus },
  access: TripReportAccess,
): void {
  assertWriter(access)
  assertEditable(report.status)
  if ((report.summary ?? '').length < TRIP_REPORT_SUMMARY_MIN)
    throw ruleError(
      'trip_report_incomplete',
      `Göndermeden önce gerçekleşme özetini en az ${String(TRIP_REPORT_SUMMARY_MIN)} karakterle yazın.`,
      ['summary'],
    )
  if ((report.outcomeNote ?? '').length < TRIP_REPORT_OUTCOME_MIN)
    throw ruleError(
      'trip_report_incomplete',
      `Göndermeden önce kazanım ve değerlendirmeyi en az ${String(TRIP_REPORT_OUTCOME_MIN)} karakterle yazın.`,
      ['outcomeNote'],
    )
}

/**
 * Onay ve iade (K-529): yalnız yönetici (403 `trip_report_decide_forbidden`) ve yalnız gönderilmiş
 * rapor (422 `trip_report_not_submitted`).
 */
export function assertTripReportDecision(access: TripReportAccess, status: TripReportStatus): void {
  if (!access.decide)
    throw new DomainError(
      'trip_report_decide_forbidden',
      'Raporu yalnız yönetici onaylar ya da iade eder.',
      { kind: 'forbidden' },
    )
  if (status !== 'submitted')
    throw ruleError('trip_report_not_submitted', 'Yalnız onaya gönderilmiş rapor karara bağlanır.')
}

// --- Fotoğraf ------------------------------------------------------------------------------------

/** Etiket kuralı (K-530): etiket ya da "öğrenci görünmüyor"dan tam biri; uygunsa `null`. */
export function photoTagIssue(
  studentIds: readonly string[],
  noStudentsVisible: boolean,
): string | null {
  if (studentIds.length === 0 && !noStudentsVisible) return TAGS_REQUIRED
  if (studentIds.length > 0 && noStudentsVisible) return TAGS_CONFLICT
  return null
}

export interface TripReportPhotoState {
  caption: string | null
  studentIds: readonly string[]
  noStudentsVisible: boolean
  shareWithFamilies: boolean
}

/**
 * Fotoğraf ekleme ve düzeltme (K-530): yazma yetkisi; rapor düzeltilebilir; raporda en çok 20
 * fotoğraf (422 `trip_report_photos_full`); etiketli öğrenci gezinin katılımcısı (422
 * `trip_report_photo_student_not_participant`); etiket ya da "öğrenci görünmüyor" (422
 * `trip_report_photo_tags_required`). Düzeltmede birleşik değer döner, değişiklik yoksa 422
 * `trip_report_photo_unchanged`.
 */
export function planTripReportPhoto(
  next: TripReportPhotoState,
  checks: {
    access: TripReportAccess
    status: TripReportStatus
    participants: ReadonlySet<string>
    photoCount: number
    mode: 'create' | 'update'
    current?: TripReportPhotoState
  },
): (keyof TripReportPhotoState)[] {
  assertWriter(checks.access)
  assertEditable(checks.status)
  if (checks.mode === 'create' && checks.photoCount >= TRIP_REPORT_PHOTOS_MAX)
    throw ruleError(
      'trip_report_photos_full',
      `Bir rapora en fazla ${String(TRIP_REPORT_PHOTOS_MAX)} fotoğraf eklenir.`,
    )
  const issue = photoTagIssue(next.studentIds, next.noStudentsVisible)
  if (issue !== null) throw ruleError('trip_report_photo_tags_required', issue, ['studentIds'])
  next.studentIds.forEach((id, index) => {
    if (!checks.participants.has(id))
      throw ruleError(
        'trip_report_photo_student_not_participant',
        'Etiketlenen öğrenci bu gezinin katılımcısı değil.',
        ['studentIds', String(index)],
      )
  })
  const current = checks.current
  if (current === undefined) return []
  const changed: (keyof TripReportPhotoState)[] = []
  if (next.caption !== current.caption) changed.push('caption')
  if (!sameIds(next.studentIds, current.studentIds)) changed.push('studentIds')
  if (next.noStudentsVisible !== current.noStudentsVisible) changed.push('noStudentsVisible')
  if (next.shareWithFamilies !== current.shareWithFamilies) changed.push('shareWithFamilies')
  if (changed.length === 0)
    throw ruleError('trip_report_photo_unchanged', 'Fotoğrafta değişiklik yok.')
  return changed
}

/** Fotoğraf kaldırma: yazma yetkisi ve düzeltilebilir rapor (K-530). */
export function assertTripReportPhotoRemove(
  access: TripReportAccess,
  status: TripReportStatus,
): void {
  assertWriter(access)
  assertEditable(status)
}

export const TRIP_REPORT_PHOTO_VISIBILITIES = [
  'internal',
  'consent_missing',
  'awaiting_approval',
  'published',
] as const
export type TripReportPhotoVisibility = (typeof TRIP_REPORT_PHOTO_VISIBILITIES)[number]
export const TRIP_REPORT_PHOTO_VISIBILITY_LABELS = {
  internal: 'Yalnız iç arşiv',
  consent_missing: 'Rıza eksik: iç arşivde',
  awaiting_approval: 'Onaydan sonra yayımlanır',
  published: 'Ailelere yayımlandı',
} as const satisfies Record<TripReportPhotoVisibility, string>

/**
 * Fotoğrafın yayımı (K-530; IST-017, DOM-YTK-061), okuma anında hesaplanır ve saklanmaz: yayım
 * istenmediyse iç arşiv; etiketli öğrencilerden birinin geçerli `photo_video_sharing` rızası yoksa
 * (hiç verilmemiş, süresi dolmuş, geri çekilmiş ya da öğrenci itiraz etmiş) iç arşiv; rapor onaylı
 * değilse onay bekler; aksi hâlde ailelere yayımlanmış. Geri çekilen rıza böylece yayımlanmış
 * fotoğrafı bir sonraki okumada düşürür.
 */
export function tripReportPhotoVisibility(input: {
  reportStatus: TripReportStatus
  shareWithFamilies: boolean
  tags: readonly { consent: boolean }[]
}): TripReportPhotoVisibility {
  if (!input.shareWithFamilies) return 'internal'
  if (input.tags.some((tag) => !tag.consent)) return 'consent_missing'
  if (input.reportStatus !== 'approved') return 'awaiting_approval'
  return 'published'
}

// --- Katılım -------------------------------------------------------------------------------------

export interface TripAttendanceMark {
  studentId: string
  status: 'present' | 'absent'
}

export interface TripAttendance {
  /** `trip_day`: kapanmış yoklama turu var; `none`: gezi günü yoklaması yapılmadı. */
  source: 'trip_day' | 'none'
  /** Gruplara dağıtılan ya da yoklamada işaretlenen öğrenci sayısı. */
  rosterCount: number
  /** Kapanan turlardan en az birinde "var" işaretlenen öğrenci sayısı. */
  attendedCount: number
  /** Listede olup hiçbir kapanan turda "var" işaretlenmeyen öğrenci sayısı. */
  absentCount: number
}

/** Kapanan turlarda en az bir kez "var" işaretlenen öğrenciler: geziye katılanlar (K-529, K-531). */
export function tripAttendedStudents(marks: readonly TripAttendanceMark[]): Set<string> {
  return new Set(marks.filter((mark) => mark.status === 'present').map((mark) => mark.studentId))
}

/**
 * Katılım sayısı (K-529): liste gruplara dağıtılan öğrencilerle kapanan turlarda işaretlenenlerin
 * birleşimidir; katılan en az bir kapanan turda "var" işaretlenendir. Kapanan tur yoksa yoklama
 * yapılmamıştır (`none`), sayılar sıfırdır.
 */
export function tripAttendance(input: {
  members: readonly string[]
  closedMarks: readonly TripAttendanceMark[]
}): TripAttendance {
  if (input.closedMarks.length === 0)
    return { source: 'none', rosterCount: 0, attendedCount: 0, absentCount: 0 }
  const roster = new Set([...input.members, ...input.closedMarks.map((mark) => mark.studentId)])
  const attended = tripAttendedStudents(input.closedMarks)
  const attendedCount = [...roster].filter((id) => attended.has(id)).length
  return {
    source: 'trip_day',
    rosterCount: roster.size,
    attendedCount,
    absentCount: roster.size - attendedCount,
  }
}

// --- Değerlendirme -------------------------------------------------------------------------------

/** Değerlendirmenin kapandığı an: dönüşten 30 gün sonra (K-531). */
export function tripEvaluationClosesAt(returnAt: string): string {
  return new Date(new Date(returnAt).getTime() + TRIP_EVALUATION_WINDOW_DAYS * DAY_MS).toISOString()
}

/** Değerlendirme açık mı: gezi bitti ve dönüşten 30 gün geçmedi (K-531). */
export function isTripEvaluationOpen(
  plan: TripReportPlanFacts & { returnAt: string },
  now: Date,
): boolean {
  return (
    isTripFinished(plan, now) &&
    now.getTime() < new Date(tripEvaluationClosesAt(plan.returnAt)).getTime()
  )
}

/**
 * Değerlendirme (K-531): veli ya da öğrenci; öğrenci kapsamda (veli için bağlı çocuğu, öğrenci için
 * kendisi; değilse 404 `trip_evaluation_student_not_found`) ve geziye katılmış (kapanan turda "var";
 * 422 `trip_evaluation_not_attended`); gezi bitmiş (422 `trip_evaluation_not_open`) ve dönüşten 30
 * gün geçmemiş (422 `trip_evaluation_closed`); kişi başına gezide bir kez (409
 * `trip_evaluation_exists`; tekil indeks son güvence).
 */
export function planTripEvaluation(checks: {
  role: Role
  inScope: boolean
  plan: (TripReportPlanFacts & { returnAt: string }) | null
  attended: boolean
  exists: boolean
  now: Date
}): void {
  if (!(TRIP_REPORT_FAMILY_ROLES as readonly string[]).includes(checks.role))
    throw new DomainError(
      'trip_evaluation_forbidden',
      'Değerlendirmeyi geziye katılan öğrenci ya da velisi verir.',
      { kind: 'forbidden' },
    )
  if (!checks.inScope || checks.plan === null)
    throw new DomainError('trip_evaluation_student_not_found', 'Öğrenci ya da gezi bulunamadı.', {
      kind: 'not_found',
      path: ['studentId'],
    })
  if (!(TRIP_REPORT_PLAN_STATUSES as readonly string[]).includes(checks.plan.status))
    throw ruleError('trip_evaluation_not_open', 'Bu gezi için değerlendirme açık değil.')
  if (!isTripFinished(checks.plan, checks.now))
    throw ruleError('trip_evaluation_not_open', 'Değerlendirme gezi bitince açılır.')
  if (!isTripEvaluationOpen(checks.plan, checks.now))
    throw ruleError(
      'trip_evaluation_closed',
      `Değerlendirme dönüşten sonra ${String(TRIP_EVALUATION_WINDOW_DAYS)} gün açıktır; süre doldu.`,
    )
  if (!checks.attended)
    throw ruleError('trip_evaluation_not_attended', 'Değerlendirmeyi geziye katılanlar verir.', [
      'studentId',
    ])
  if (checks.exists)
    throw new DomainError('trip_evaluation_exists', 'Bu gezi için değerlendirmeniz var.', {
      kind: 'conflict',
    })
}

export interface TripEvaluationSummary {
  responses: number
  /** Küçük grupta (5'ten az yanıt) özet gizlidir (K-531). */
  hidden: boolean
  /** Tek ondalıklı ortalama; gizliyse `null`. */
  average: number | null
  /** 1–5 puanların sayısı (dizin 0 → 1 puan); gizliyse `null`. */
  distribution: number[] | null
  /** Yorumlar, ad ve rol olmadan, alfabe sırasıyla (yazılış sırası yanıtlayanı ele vermez); gizliyse `null`. */
  comments: string[] | null
}

/**
 * Değerlendirme özeti (K-531): yanıt sayısı her zaman; ortalama, dağılım ve yorumlar en az 5 yanıtta.
 * Yorumlar hiçbir zaman yanıtlayanın adını ya da rolünü taşımaz (az yanıtta yazan tanınabilir).
 */
export function tripEvaluationSummary(
  rows: readonly { score: number; comment: string | null }[],
): TripEvaluationSummary {
  const responses = rows.length
  if (responses < TRIP_EVALUATION_MIN_GROUP)
    return { responses, hidden: responses > 0, average: null, distribution: null, comments: null }
  const distribution = [0, 0, 0, 0, 0]
  let total = 0
  for (const row of rows) {
    total += row.score
    const index = row.score - TRIP_EVALUATION_SCORE_MIN
    distribution[index] = (distribution[index] ?? 0) + 1
  }
  return {
    responses,
    hidden: false,
    average: Math.round((total / responses) * 10) / 10,
    distribution,
    comments: rows
      .flatMap((row) => (row.comment === null ? [] : [row.comment]))
      .sort((a, b) => a.localeCompare(b, 'tr')),
  }
}
