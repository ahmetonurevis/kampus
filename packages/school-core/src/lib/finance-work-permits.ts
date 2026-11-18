import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'

/**
 * Öğretmen çalışma onayı takibi (docs/domain/finans.md DOM-FIN-114; ON-174). Özel okul ve kursta
 * (dil okulu dahil) öğretmenin çalışma onayı il/ilçe millî eğitim müdürlüğünce MEBBİS üzerinden
 * verilir; Kampüs başvuruyu göndermez (IST-143), yalnız kurum içi takibi tutar: onay türü (ilk,
 * yenileme, branş değişikliği), branş, başvuru, onay ya da ret günü, onay sayısı ve geçerlilik
 * bitişi, onay belgesinin taranmış dosyası.
 *
 * Kayıt öğretmenin kurum üyeliğine bağlanır (personel tablosu yoktur). Saklanan durum hazırlanıyor,
 * başvuruldu, onaylandı ya da reddedildi; "süresi doldu" saklanmaz, geçerlilik bitişi bugünden
 * önceki onayda hesaplanır (K-376). Öğretmen başına aynı anda tek açık (hazırlanan ya da başvurulan)
 * kayıt bulunur (K-375). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Çalışma onayı kaydı yalnız yöneticide (K-377); kişisel veridir. */
export const FINANCE_WORK_PERMIT_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Takip edilen üyelik rolü (K-375): öğretmen. */
export const WORK_PERMIT_TEACHER_ROLE = 'ogretmen'

export const WORK_PERMIT_TYPES = ['initial', 'renewal', 'branch_change'] as const
export type WorkPermitType = (typeof WORK_PERMIT_TYPES)[number]
export const WORK_PERMIT_TYPE_LABELS = {
  initial: 'İlk onay',
  renewal: 'Yenileme',
  branch_change: 'Branş değişikliği',
} as const satisfies Record<WorkPermitType, string>

/** Saklanan durum. */
export const WORK_PERMIT_STATUSES = ['preparing', 'applied', 'approved', 'rejected'] as const
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number]

/** Gösterilen durum: saklanan durum ya da hesaplanan "süresi doldu" (K-376). */
export const WORK_PERMIT_STATES = [...WORK_PERMIT_STATUSES, 'expired'] as const
export type WorkPermitState = (typeof WORK_PERMIT_STATES)[number]
export const WORK_PERMIT_STATE_LABELS = {
  preparing: 'Hazırlanıyor',
  applied: 'Başvuruldu',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
} as const satisfies Record<WorkPermitState, string>

/** Öğretmenin onay durumu (takip listesi; K-376). */
export const TEACHER_PERMIT_STATUSES = ['valid', 'expiring', 'expired', 'missing'] as const
export type TeacherPermitStatus = (typeof TEACHER_PERMIT_STATUSES)[number]
export const TEACHER_PERMIT_STATUS_LABELS = {
  valid: 'Geçerli',
  expiring: 'Süresi dolmak üzere',
  expired: 'Süresi doldu',
  missing: 'Onay yok',
} as const satisfies Record<TeacherPermitStatus, string>

/** Geçerlilik bitişine bu kadar gün (bugün dahil) kalınca "dolmak üzere" (K-376). */
export const WORK_PERMIT_EXPIRY_WARNING_DAYS = 30
/** "Ders programında görevli": bugünden itibaren bu kadar günde dersi ya da grubu olan (K-376). */
export const WORK_PERMIT_TEACHING_WINDOW_DAYS = 30
/** Onay eğitim yılı bitişine bundan az gün kala verildiyse varsayılan bitiş sonraki yılındır. */
export const WORK_PERMIT_NEXT_YEAR_THRESHOLD_DAYS = 60

export const WORK_PERMIT_BRANCH_MIN = 2
export const WORK_PERMIT_BRANCH_MAX = 80
export const WORK_PERMIT_NUMBER_MAX = 60
export const WORK_PERMIT_NOTE_MAX = 500
export const WORK_PERMIT_REASON_MIN = 5
export const WORK_PERMIT_REASON_MAX = 500

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Öğretmen seçin.')
  .trim()
  .min(1, 'Öğretmen seçin.')
  .max(100, 'Öğretmen geçersiz.')
const typeSchema = z
  .enum(WORK_PERMIT_TYPES, 'Onay türünü seçin.')
  .describe('`initial` ilk onay, `renewal` yenileme, `branch_change` branş değişikliği')
const branchSchema = z
  .string('Branşı yazın.')
  .trim()
  .min(WORK_PERMIT_BRANCH_MIN, 'Branşı en az 2 karakterle yazın.')
  .max(
    WORK_PERMIT_BRANCH_MAX,
    `Branş en fazla ${String(WORK_PERMIT_BRANCH_MAX)} karakter olabilir.`,
  )
const noteSchema = z
  .string()
  .trim()
  .max(WORK_PERMIT_NOTE_MAX, `En fazla ${String(WORK_PERMIT_NOTE_MAX)} karakter girebilirsiniz.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
const reasonSchema = (empty: string) =>
  z
    .string(empty)
    .trim()
    .min(WORK_PERMIT_REASON_MIN, `${empty.replace(/\.$/, '')} (en az 5 karakter).`)
    .max(
      WORK_PERMIT_REASON_MAX,
      `En fazla ${String(WORK_PERMIT_REASON_MAX)} karakter girebilirsiniz.`,
    )
const fileSchema = z.uuid('Dosya geçersiz.')

/** Yeni kayıt (DOM-FIN-114): başvuru günü verilirse "başvuruldu", verilmezse "hazırlanıyor". */
export const workPermitInputSchema = z.strictObject({
  // kvkk: K (öğretmen üyeliği)
  membershipId: membershipSchema.describe('Öğretmenin kurum üyeliği'),
  permitType: typeSchema,
  branch: branchSchema.describe('Onayın istendiği branş (ör. İngilizce, Matematik), 2–80 karakter'),
  applicationDate: daySchema
    .nullable()
    .default(null)
    .describe('MEBBİS başvuru günü; boşsa kayıt hazırlanıyor durumundadır'),
  note: noteSchema.default(null).describe('İsteğe bağlı not, en çok 500 karakter'),
})
export type WorkPermitInput = z.input<typeof workPermitInputSchema>
export type WorkPermitFields = z.output<typeof workPermitInputSchema>

/** Düzeltme: verilen alanlar değişir; en az bir alan. */
export const workPermitUpdateSchema = z
  .strictObject({
    permitType: typeSchema.optional(),
    branch: branchSchema.optional(),
    applicationDate: daySchema.optional().describe('Başvuru günü (yalnız başvurulmuş kayıtta)'),
    note: noteSchema.optional(),
    documentFileId: fileSchema
      .nullable()
      .optional()
      .describe('Onay belgesi (`POST /files`, `purpose: document`, PDF); `null` eki kaldırır'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type WorkPermitUpdateFields = z.output<typeof workPermitUpdateSchema>

export const workPermitApplySchema = z.strictObject({
  applicationDate: daySchema.describe('MEBBİS başvuru günü'),
})
export type WorkPermitApplyFields = z.output<typeof workPermitApplySchema>

export const workPermitApproveSchema = z.strictObject({
  approvalDate: daySchema.describe('Onay günü'),
  approvalNumber: z
    .string('Onay sayısını ya da belge numarasını yazın.')
    .trim()
    .min(1, 'Onay sayısını ya da belge numarasını yazın.')
    .max(
      WORK_PERMIT_NUMBER_MAX,
      `Onay sayısı en fazla ${String(WORK_PERMIT_NUMBER_MAX)} karakter olabilir.`,
    )
    .describe('Onay yazısının sayısı ya da belge numarası'),
  validUntil: daySchema
    .nullable()
    .optional()
    .describe(
      'Geçerlilik bitişi (dahil). Verilmezse onay gününün eğitim yılı sonu (K-376); `null` süresiz',
    ),
  documentFileId: fileSchema
    .nullable()
    .default(null)
    .describe('İsteğe bağlı onay belgesi (`POST /files`, `purpose: document`, PDF)'),
})
export type WorkPermitApproveFields = z.output<typeof workPermitApproveSchema>

export const workPermitRejectSchema = z.strictObject({
  decisionDate: daySchema.describe('Ret günü'),
  reason: reasonSchema('Ret gerekçesini yazın.').describe('Ret gerekçesi, 5–500 karakter'),
})
export type WorkPermitRejectFields = z.output<typeof workPermitRejectSchema>

export const workPermitCancelSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini yazın.').describe(
    'İptal gerekçesi; denetim kaydına yazılmaz',
  ),
})
export type WorkPermitCancelFields = z.output<typeof workPermitCancelSchema>

// --- Gün hesapları -------------------------------------------------------------------------------

const DAY_MS = 86_400_000
const dayTime = (day: string) => Date.parse(`${day}T00:00:00.000Z`)

/** İki gün arasındaki fark (`to - from`, gün). */
export const daysBetween = (from: string, to: string) =>
  Math.round((dayTime(to) - dayTime(from)) / DAY_MS)

/** Takvim gününe gün ekler (`YYYY-MM-DD`). */
export function addDayCount(day: string, count: number): string {
  return new Date(dayTime(day) + count * DAY_MS).toISOString().slice(0, 10)
}

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Eğitim yılı aralığı (kurumun yıl kaydı ya da varsayılan 1 Eylül – 31 Ağustos). */
export interface SchoolYearRange {
  startDate: string
  endDate: string
}

function defaultYearOf(day: string): SchoolYearRange {
  const year = Number(day.slice(0, 4))
  const startYear = Number(day.slice(5, 7)) >= 9 ? year : year - 1
  return { startDate: `${String(startYear)}-09-01`, endDate: `${String(startYear + 1)}-08-31` }
}

/** Günden sonra bir yıl içinde başlayan ilk kayıtlı yıl. */
function upcomingYear(day: string, years: readonly SchoolYearRange[]) {
  return [...years]
    .filter((year) => year.startDate > day && year.startDate <= addDayCount(day, 365))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
}

/**
 * Günün eğitim yılı: onu içeren kayıtlı yıl; kayıtlı yılların dışındaki gün (yaz boşluğu) bir yıl
 * içinde başlayan sonraki kayıtlı yıla aittir; kayıt yoksa varsayılan aralık.
 */
function yearOf(day: string, years: readonly SchoolYearRange[]): SchoolYearRange {
  return (
    years.find((year) => year.startDate <= day && day <= year.endDate) ??
    upcomingYear(day, years) ??
    defaultYearOf(day)
  )
}

/**
 * Varsayılan geçerlilik bitişi (K-376): onay gününün içinde bulunduğu eğitim yılının son günü
 * (kurumun yıl kaydı, yoksa 31 Ağustos; kayıtlı yıllar arasındaki yaz boşluğu sonraki yıla aittir).
 * Yılın bitişine 60 günden az kala verilen onay yeni yıl içindir (yaz döneminde işe alım); bitiş bir
 * sonraki eğitim yılının son günüdür.
 */
export function defaultWorkPermitValidUntil(
  approvalDate: string,
  years: readonly SchoolYearRange[],
): string {
  const current = yearOf(approvalDate, years)
  if (daysBetween(approvalDate, current.endDate) >= WORK_PERMIT_NEXT_YEAR_THRESHOLD_DAYS)
    return current.endDate
  // Sonraki yıl: bitişten sonra bir yıl içinde başlayan kayıtlı yıl, yoksa bitiş yılının 1 Eylül'ünde
  // başlayan varsayılan aralık (kayıtlı yıl 30 Haziran'da bitse de yeni yıl Eylül'de başlar).
  return (
    upcomingYear(current.endDate, years) ?? defaultYearOf(`${current.endDate.slice(0, 4)}-09-01`)
  ).endDate
}

// --- Durum ---------------------------------------------------------------------------------------

/** Kaydın durumu hesaplamak için gereken alanları. */
export interface WorkPermitDates {
  status: WorkPermitStatus
  approvalDate: string | null
  validUntil: string | null
}

/** Gösterilen durum (K-376): geçerlilik bitişi bugünden önceki onay "süresi doldu". */
export function workPermitState(permit: WorkPermitDates, today: string): WorkPermitState {
  if (permit.status === 'approved' && permit.validUntil !== null && permit.validUntil < today)
    return 'expired'
  return permit.status
}

const isOpen = (status: WorkPermitStatus) => status === 'preparing' || status === 'applied'

/**
 * Öğretmenin onay özeti (K-376). Geçerli onay, iptal edilmemiş onaylı kayıtların bitişi en geç
 * olanıdır (süresiz en geç sayılır; eşitlikte en son onaylanan). Bitişe kalan gün 30 ya da azsa
 * "dolmak üzere", bitiş geçtiyse "süresi doldu", onaylı kayıt yoksa "onay yok". Açık başvuru ayrıca
 * döner.
 */
export function teacherPermitSummary<T extends WorkPermitDates>(
  permits: readonly T[],
  today: string,
): {
  status: TeacherPermitStatus
  current: T | null
  openApplication: T | null
  daysLeft: number | null
} {
  let current: T | null = null
  for (const permit of permits) {
    if (permit.status !== 'approved') continue
    if (current === null) {
      current = permit
      continue
    }
    const end = permit.validUntil ?? '9999-12-31'
    const best = current.validUntil ?? '9999-12-31'
    if (end > best || (end === best && (permit.approvalDate ?? '') > (current.approvalDate ?? '')))
      current = permit
  }
  const openApplication = permits.find((permit) => isOpen(permit.status)) ?? null
  if (current === null) return { status: 'missing', current, openApplication, daysLeft: null }
  if (current.validUntil === null)
    return { status: 'valid', current, openApplication, daysLeft: null }
  const daysLeft = daysBetween(today, current.validUntil)
  const status: TeacherPermitStatus =
    daysLeft < 0 ? 'expired' : daysLeft <= WORK_PERMIT_EXPIRY_WARNING_DAYS ? 'expiring' : 'valid'
  return { status, current, openApplication, daysLeft }
}

/** Uyarı (K-376): ders programında görevli öğretmenin geçerli onayı yok (yok ya da süresi doldu). */
export const isUnapprovedTeaching = (status: TeacherPermitStatus, teaching: boolean) =>
  teaching && (status === 'missing' || status === 'expired')

/** Takip listesinde dikkat isteyen durumlar: geçerli olmayan her durum. */
export const needsAttention = (status: TeacherPermitStatus) => status !== 'valid'

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

function assertNotFuture(day: string, today: string, path: string, what: string) {
  if (day > today)
    throw ruleError('work_permit_date_in_future', `${what} bugünden sonra olamaz.`, path)
}

/** Yeni kaydın denetimi için servis kurum kilidi altında yükler. */
export interface WorkPermitChecks {
  /** Üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  teacher: { role: string; active: boolean } | null
  /** Öğretmenin iptal edilmemiş kayıtları. */
  permits: readonly { status: WorkPermitStatus }[]
}

/**
 * Yeni kayıt (DOM-FIN-114, K-375). Üyelik kurumun etkin öğretmenidir. Öğretmenin açık (hazırlanan
 * ya da başvurulan) kaydı varken yenisi açılmaz. Yenileme ve branş değişikliği önceden onaylanmış
 * bir kayıt ister. Başvuru günü bugünden sonra olamaz. Dönen durum: başvuru günü varsa
 * `applied`, yoksa `preparing`.
 */
export function planWorkPermit(
  input: WorkPermitFields,
  checks: WorkPermitChecks,
  today: string,
): WorkPermitStatus {
  if (checks.teacher === null)
    throw ruleError('work_permit_teacher_not_found', 'Öğretmen bulunamadı.', 'membershipId')
  if (checks.teacher.role !== WORK_PERMIT_TEACHER_ROLE)
    throw ruleError(
      'work_permit_not_teacher',
      'Çalışma onayı yalnız öğretmen üyeliğine kaydedilir.',
      'membershipId',
    )
  if (!checks.teacher.active)
    throw ruleError(
      'work_permit_teacher_inactive',
      'Pasifleştirilmiş (ayrılan) öğretmene çalışma onayı kaydı açılmaz.',
      'membershipId',
    )
  if (checks.permits.some((permit) => isOpen(permit.status)))
    throw ruleError(
      'work_permit_open_exists',
      'Bu öğretmenin sürmekte olan bir başvurusu var; önce onu sonuçlandırın ya da iptal edin.',
      'membershipId',
    )
  if (
    input.permitType !== 'initial' &&
    !checks.permits.some((permit) => permit.status === 'approved')
  )
    throw ruleError(
      'work_permit_no_prior_approval',
      'Yenileme ve branş değişikliği için öğretmenin onaylanmış bir çalışma onayı olmalı.',
      'permitType',
    )
  if (input.applicationDate !== null) {
    assertNotFuture(input.applicationDate, today, 'applicationDate', 'Başvuru günü')
    return 'applied'
  }
  return 'preparing'
}

/** Değiştirilecek kaydın alanları. */
export interface WorkPermitCurrent {
  status: WorkPermitStatus
  permitType: WorkPermitType
  branch: string
  applicationDate: string | null
  approvalDate: string | null
  note: string | null
  documentFileId: string | null
}

const DECIDED_EDITABLE = new Set(['note', 'documentFileId'])

/**
 * Düzeltme (K-375). Sonuçlanmış (onaylanmış ya da reddedilmiş) kayıtta yalnız not ve onay belgesi
 * değişir; tür, branş ve tarihler değişmez (yanlış kayıt iptal edilip yeniden açılır). Başvuru günü
 * yalnız başvurulmuş kayıtta düzeltilir ve bugünden sonra olamaz. Değişen alanların adları döner;
 * hiçbiri değişmediyse 422.
 */
export function planWorkPermitUpdate(
  current: WorkPermitCurrent,
  changes: WorkPermitUpdateFields,
  today: string,
): (keyof WorkPermitUpdateFields)[] {
  const changed = (Object.keys(changes) as (keyof WorkPermitUpdateFields)[]).filter(
    (key) => changes[key] !== undefined && changes[key] !== current[key],
  )
  const decided = current.status === 'approved' || current.status === 'rejected'
  const locked = changed.find((key) => decided && !DECIDED_EDITABLE.has(key))
  if (locked !== undefined)
    throw ruleError(
      'work_permit_decided',
      'Sonuçlanmış kayıtta yalnız not ve onay belgesi değişir; yanlış kaydı iptal edip yeniden açın.',
      locked,
    )
  if (changed.includes('applicationDate')) {
    if (current.status !== 'applied')
      throw ruleError(
        'work_permit_not_applied',
        'Başvuru günü "Başvuruldu" işaretiyle girilir.',
        'applicationDate',
      )
    assertNotFuture(changes.applicationDate ?? '', today, 'applicationDate', 'Başvuru günü')
  }
  if (changed.length === 0)
    throw ruleError('work_permit_unchanged', 'Kayıtta değişen bir alan yok.', 'permitType')
  return changed
}

/** Başvuru işareti (K-375): yalnız hazırlanan kayıtta; gün bugünden sonra olamaz. */
export function planWorkPermitApply(
  current: Pick<WorkPermitCurrent, 'status'>,
  input: WorkPermitApplyFields,
  today: string,
): void {
  if (current.status !== 'preparing')
    throw ruleError(
      'work_permit_not_preparing',
      'Yalnız hazırlanan kayıt başvuruldu olarak işaretlenir.',
      'applicationDate',
    )
  assertNotFuture(input.applicationDate, today, 'applicationDate', 'Başvuru günü')
}

function assertDecidable(
  current: Pick<WorkPermitCurrent, 'status' | 'applicationDate'>,
  day: string,
  path: string,
  what: string,
  today: string,
) {
  if (current.status !== 'applied')
    throw ruleError(
      'work_permit_not_applied',
      'Yalnız başvurusu yapılmış kayıt sonuçlandırılır; önce başvuru gününü girin.',
      path,
    )
  assertNotFuture(day, today, path, what)
  if (current.applicationDate !== null && day < current.applicationDate)
    throw ruleError(
      'work_permit_decision_before_application',
      `${what} başvuru gününden (${dayText(current.applicationDate)}) önce olamaz.`,
      path,
    )
}

/**
 * Onay (K-375, K-376): yalnız başvurulmuş kayıtta; onay günü başvuru gününden önce ve bugünden
 * sonra olamaz. Geçerlilik bitişi verilmezse `defaultValidUntil` (eğitim yılı sonu), `null`
 * süresizdir; bitiş onay gününden önce olamaz. Yazılacak bitiş döner.
 */
export function planWorkPermitApprove(
  current: Pick<WorkPermitCurrent, 'status' | 'applicationDate'>,
  input: WorkPermitApproveFields,
  today: string,
  defaultValidUntil: (approvalDate: string) => string,
): { validUntil: string | null } {
  assertDecidable(current, input.approvalDate, 'approvalDate', 'Onay günü', today)
  const validUntil =
    input.validUntil === undefined ? defaultValidUntil(input.approvalDate) : input.validUntil
  if (validUntil !== null && validUntil < input.approvalDate)
    throw ruleError(
      'work_permit_valid_until_before_approval',
      'Geçerlilik bitişi onay gününden önce olamaz.',
      'validUntil',
    )
  return { validUntil }
}

/** Ret (K-375): yalnız başvurulmuş kayıtta; ret günü başvuru gününden önce, bugünden sonra olamaz. */
export function planWorkPermitReject(
  current: Pick<WorkPermitCurrent, 'status' | 'applicationDate'>,
  input: WorkPermitRejectFields,
  today: string,
): void {
  assertDecidable(current, input.decisionDate, 'decisionDate', 'Ret günü', today)
}
