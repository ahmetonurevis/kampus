import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import {
  normalizeTripPlate,
  TRIP_PLATE_PATTERN,
  type TripPlanStatus,
} from './finance-trip-plans.ts'

/**
 * Gezi günü yoklaması ve acil kart (docs/domain/finans.md DOM-FIN-154; ON-157; K-517…K-519).
 * Onaylı gezi planının (DOM-FIN-111) katılımcıları araç/gruplara dağıtılır; her grubun sorumlusu
 * planın görevlisidir (üyelik). Grup sorumlusu adlandırılmış kontrol noktalarında (çıkış, varış,
 * dönüş çıkışı, okula varış; sayı serbest) yoklama turu açar ve öğrenci başına var/yok işaretler.
 * **Eksik varken tur "tamam" yapılamaz** (güvenlik); yalnız bütün öğrenciler işaretlendikten sonra
 * gerekçeyle "eksikle devam" denebilir. Acil kart grubun öğrencileri için acil iletişimi (K-501,
 * telefon amaca göre maskeli) ve en az bilgiyle sağlık uyarısını taşır. Fonksiyonlar saftır.
 */

// --- Roller --------------------------------------------------------------------------------------

/** Grup kurar, dağıtır ve bütün grupları okur (gezi planını yazan roller; K-517). */
export const TRIP_DAY_MANAGER_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Gezi günü uçlarına giren personel; öğretmen yalnız sorumlusu olduğu grubu görür (K-517). */
export const TRIP_DAY_ROLES = ['yonetici', 'onburo', 'ogretmen'] as const satisfies readonly Role[]
/** Yoklama turunu yürüten ve acil kartı açan roller: yönetici ve grup sorumlusu (K-517, K-518). */
export const TRIP_DAY_OPERATOR_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]
/** Çocuğunun (kendinin) son kontrol noktasını okuyan roller (K-519). */
export const TRIP_DAY_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

// --- Sabitler ------------------------------------------------------------------------------------

export const TRIP_DAY_CHECK_STATUSES = ['open', 'complete', 'incomplete'] as const
export type TripDayCheckStatus = (typeof TRIP_DAY_CHECK_STATUSES)[number]
export const TRIP_DAY_CHECK_STATUS_LABELS = {
  open: 'Sürüyor',
  complete: 'Tamam',
  incomplete: 'Eksikle devam',
} as const satisfies Record<TripDayCheckStatus, string>

export const TRIP_DAY_MARK_STATUSES = ['present', 'absent'] as const
export type TripDayMarkStatus = (typeof TRIP_DAY_MARK_STATUSES)[number]
/** Turdaki öğrencinin durumu: işaretlenmemiş (`pending`) ya da işaret. */
export const TRIP_DAY_ROSTER_STATUSES = ['pending', ...TRIP_DAY_MARK_STATUSES] as const
export type TripDayRosterStatus = (typeof TRIP_DAY_ROSTER_STATUSES)[number]
export const TRIP_DAY_ROSTER_STATUS_LABELS = {
  pending: 'İşaretlenmedi',
  present: 'Var',
  absent: 'Yok',
} as const satisfies Record<TripDayRosterStatus, string>

/** Önerilen kontrol noktaları (K-517); ad serbesttir, sayı sınırlı değildir. */
export const TRIP_DAY_CHECKPOINT_SUGGESTIONS = [
  'Okuldan çıkış',
  'Varış',
  'Dönüş çıkışı',
  'Okula varış',
] as const

export const TRIP_DAY_GROUP_NAME_MIN = 2
export const TRIP_DAY_GROUP_NAME_MAX = 60
export const TRIP_DAY_CHECKPOINT_MIN = 2
export const TRIP_DAY_CHECKPOINT_MAX = 60
export const TRIP_DAY_GROUPS_MAX = 30
export const TRIP_DAY_CHECKS_MAX = 50
export const TRIP_DAY_BATCH_MAX = 200
export const TRIP_DAY_REASON_MIN = 5
export const TRIP_DAY_REASON_MAX = 500
/** Cihaz saatinin sunucudan ileri olabileceği pay: çevrimdışı işaret bu kadar ileri olabilir. */
export const TRIP_DAY_MARK_CLOCK_SKEW_MS = 5 * 60 * 1000
/** Çevrimdışı kuyruktan gelen işaretin en çok bu kadar eski olabileceği süre. */
export const TRIP_DAY_MARK_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Turların açılabildiği plan durumu: onaylanmış (K-517). */
export const TRIP_DAY_RUNNABLE_STATUSES = ['approved'] as const satisfies readonly TripPlanStatus[]
/** Grup ve dağıtımın değişebildiği plan durumları: tamamlanmamış ve iptal edilmemiş (K-517). */
export const TRIP_DAY_EDITABLE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
] as const satisfies readonly TripPlanStatus[]

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`
const groupName = z
  .string('Grubun adını yazın.')
  .trim()
  .min(TRIP_DAY_GROUP_NAME_MIN, 'Grubun adını en az 2 karakterle yazın (ör. 1. otobüs).')
  .max(TRIP_DAY_GROUP_NAME_MAX, maxMessage(TRIP_DAY_GROUP_NAME_MAX))
  .describe('Araç ya da grup adı (`1. otobüs`, `Mavi grup`)')
const plate = z
  .string()
  .transform(normalizeTripPlate)
  .transform((value) => (value === '' ? null : value))
  .pipe(z.string().regex(TRIP_PLATE_PATTERN, 'Plakayı 34 ABC 123 biçiminde girin.').nullable())
  .nullable()
  .describe('Grubun aracının plakası; boşluksuz büyük harfle saklanır, araçsız grupta boş')
const leader = z
  .string('Grup sorumlusunu seçin.')
  .trim()
  .min(1, 'Grup sorumlusunu seçin.')
  .max(100, 'Grup sorumlusu geçersiz.')
  .describe('Grup sorumlusunun kurum üyeliği; planın görevlisi olmalı')
const studentId = z
  .string('Öğrenciyi seçin.')
  .trim()
  .min(1, 'Öğrenciyi seçin.')
  .max(100, 'Öğrenci geçersiz.')

/** Grup açma (K-517): ad, isteğe bağlı plaka ve sorumlu. */
export const tripDayGroupSchema = z.strictObject({
  name: groupName,
  vehiclePlate: plate.default(null),
  leaderMembershipId: leader,
})
export type TripDayGroupInput = z.input<typeof tripDayGroupSchema>
export type TripDayGroupFields = z.output<typeof tripDayGroupSchema>

/** Grup düzeltme: verilen alanlar değişir, en az biri gerekir. */
export const tripDayGroupUpdateSchema = z
  .strictObject({
    name: groupName.optional(),
    vehiclePlate: plate.optional(),
    leaderMembershipId: leader.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
    path: ['name'],
  })
export type TripDayGroupChanges = z.output<typeof tripDayGroupUpdateSchema>

/** Dağıtım (K-517): öğrencileri bir gruba taşır; `groupId: null` gruptan çıkarır. */
export const tripDayAssignSchema = z.strictObject({
  groupId: z
    .uuid('Grubu seçin.')
    .nullable()
    .describe('Hedef grup; `null` öğrencileri gruptan çıkarır'),
  studentIds: z
    .array(studentId, 'Öğrencileri seçin.')
    .min(1, 'En az bir öğrenci seçin.')
    .max(TRIP_DAY_BATCH_MAX, `Bir seferde en fazla ${String(TRIP_DAY_BATCH_MAX)} öğrenci taşınır.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı öğrenci iki kez seçilemez.')
    .describe('Gezinin katılımcıları (bağlı ücretli etkinlikte asil katılım)'),
})
export type TripDayAssignFields = z.output<typeof tripDayAssignSchema>

/** Tur açma (K-517): kontrol noktasının adı. */
export const tripDayCheckStartSchema = z.strictObject({
  checkpoint: z
    .string('Kontrol noktasını yazın.')
    .trim()
    .min(TRIP_DAY_CHECKPOINT_MIN, 'Kontrol noktasını en az 2 karakterle yazın (ör. Varış).')
    .max(TRIP_DAY_CHECKPOINT_MAX, maxMessage(TRIP_DAY_CHECKPOINT_MAX))
    .describe('Kontrol noktası (`Okuldan çıkış`, `Varış`, `Dönüş çıkışı`, `Okula varış`)'),
})
export type TripDayCheckStartFields = z.output<typeof tripDayCheckStartSchema>

const markSchema = z.strictObject({
  studentId: studentId.describe('Grubun öğrencisi'),
  status: z
    .enum(TRIP_DAY_MARK_STATUSES, 'Var ya da yok seçin.')
    .describe('`present` var, `absent` yok'),
  markedAt: z.iso
    .datetime({ offset: true, error: 'Saati ISO 8601 biçiminde gönderin.' })
    .optional()
    .describe(
      'İşaret anı (ISO 8601). Verilmezse sunucu anı; çevrimdışı yeniden denemede cihazın işaret anı gönderilir.',
    ),
})

/** Tur işaretleri: 1–200 öğrenci, aynı öğrenci bir kez (toplu "hepsi burada" ve tek dokunuş). */
export const tripDayMarksSchema = z.strictObject({
  marks: z
    .array(markSchema, 'İşaretleri gönderin.')
    .min(1, 'En az bir işaret gönderin.')
    .max(
      TRIP_DAY_BATCH_MAX,
      `Bir seferde en fazla ${String(TRIP_DAY_BATCH_MAX)} işaret gönderilir.`,
    )
    .refine(
      (marks) => new Set(marks.map((mark) => mark.studentId)).size === marks.length,
      'Aynı öğrenci bir istekte iki kez işaretlenemez.',
    ),
})
export type TripDayMarksFields = z.output<typeof tripDayMarksSchema>

/** Turu tamamlama gövdesi boştur; sürüm `If-Match` ile gelir. */
export const tripDayCheckCompleteSchema = z.strictObject({})

/** Eksikle devam (K-517): gerekçe zorunlu. */
export const tripDayCheckProceedSchema = z.strictObject({
  reason: z
    .string('Eksikle devam gerekçesini yazın.')
    .trim()
    .min(TRIP_DAY_REASON_MIN, `Gerekçe en az ${String(TRIP_DAY_REASON_MIN)} karakter olmalı.`)
    .max(TRIP_DAY_REASON_MAX, maxMessage(TRIP_DAY_REASON_MAX))
    .describe(
      'Eksik öğrencinin durumu ve alınan önlem (ör. "Ece veliyle ayrıldı, müdür bilgilendirildi")',
    ),
})
export type TripDayCheckProceedFields = z.output<typeof tripDayCheckProceedSchema>

export const TRIP_DAY_CARD_PURPOSES = ['office', 'emergency'] as const
export type TripDayCardPurpose = (typeof TRIP_DAY_CARD_PURPOSES)[number]
export const TRIP_DAY_CARD_PURPOSE_LABELS = {
  office: 'Telefonlar maskeli',
  emergency: 'Acil durum için tam telefon',
} as const satisfies Record<TripDayCardPurpose, string>
export const tripDayCardPurposeSchema = z
  .enum(TRIP_DAY_CARD_PURPOSES, 'Kart amacı `office` ya da `emergency` olmalıdır.')
  .default('office')
  .describe(
    '`office` veli telefonu maskeli (varsayılan); `emergency` tam telefon (yönetici her zaman, grup sorumlusu yalnız gezi günlerinde; K-518)',
  )

// --- Gün -----------------------------------------------------------------------------------------

/** Gezinin günleri (Europe/Istanbul): çıkış günü ile dönüş günü arası, uçlar dahil. */
export function tripDayRange(plan: { departureAt: string; returnAt: string }) {
  return { from: dayKey(plan.departureAt), to: dayKey(plan.returnAt) }
}

/** Bugün (İstanbul) gezinin günlerinden biri mi. */
export function isTripDay(plan: { departureAt: string; returnAt: string }, now: Date): boolean {
  const today = dayKey(now)
  const { from, to } = tripDayRange(plan)
  return from <= today && today <= to
}

// --- Erişim --------------------------------------------------------------------------------------

export interface TripDayActor {
  role: Role
  membershipId: string
}

export interface TripDayGroupAccess {
  /** Grubu, öğrencilerini ve turlarını görür. */
  read: boolean
  /** Tur açar, işaretler, tamamlar ya da eksikle devam eder. */
  operate: boolean
  /** Acil kartı açar (K-518). */
  card: boolean
}

/**
 * Grup yetkisi (K-517, K-518): yönetici her grubu görür ve yürütür; grup sorumlusu (öğretmen ya da
 * yönetici üyeliği) yalnız kendi grubunu. Ön büro bütün grupları okur, yürütmez ve acil kartı
 * açmaz (sağlık bilgisine erişimi yoktur, DOM-ILT-035). Öğretmen sorumlusu olmadığı grubu görmez.
 */
export function tripDayGroupAccess(
  actor: TripDayActor,
  leaderMembershipId: string,
): TripDayGroupAccess {
  const lead = leaderMembershipId === actor.membershipId
  if (actor.role === 'yonetici') return { read: true, operate: true, card: true }
  if (actor.role === 'onburo') return { read: true, operate: false, card: false }
  if (actor.role === 'ogretmen') return { read: lead, operate: lead, card: lead }
  return { read: false, operate: false, card: false }
}

/** Grup kurma ve dağıtım yetkisi: yönetici ve ön büro (K-517). */
export const canManageTripDay = (role: string) =>
  (TRIP_DAY_MANAGER_ROLES as readonly string[]).includes(role)

/**
 * Tam telefonlu acil kart (K-518): yönetici her zaman; grup sorumlusu yalnız gezi günlerinde ve
 * kendi grubunda (`access.card`). Diğer durumlarda 403.
 */
export function canUseTripDayCardPurpose(
  actor: TripDayActor,
  access: TripDayGroupAccess,
  purpose: TripDayCardPurpose,
  tripDay: boolean,
): boolean {
  if (!access.card) return false
  if (purpose === 'office') return true
  return actor.role === 'yonetici' || tripDay
}

export function assertTripDayCardPurpose(
  actor: TripDayActor,
  access: TripDayGroupAccess,
  purpose: TripDayCardPurpose,
  tripDay: boolean,
): void {
  if (!access.card)
    throw new DomainError(
      'trip_day_card_forbidden',
      'Acil kartı yalnız grup sorumlusu ya da yönetici açar.',
      { kind: 'forbidden' },
    )
  if (!canUseTripDayCardPurpose(actor, access, purpose, tripDay))
    throw new DomainError(
      'trip_day_card_full_forbidden',
      'Tam telefonlu acil kartı grup sorumlusu yalnız gezi günü açabilir.',
      { kind: 'forbidden' },
    )
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

function assertManager(role: string): void {
  if (!canManageTripDay(role))
    throw new DomainError(
      'trip_day_manage_forbidden',
      'Grupları ve dağıtımı yönetici ya da ön büro düzenler.',
      { kind: 'forbidden' },
    )
}

function assertEditable(status: TripPlanStatus): void {
  if (!(TRIP_DAY_EDITABLE_STATUSES as readonly string[]).includes(status))
    throw ruleError(
      'trip_day_plan_closed',
      'Tamamlanmış ya da iptal edilmiş gezinin grupları değiştirilemez.',
    )
}

export interface TripDayGroupChecks {
  role: string
  planStatus: TripPlanStatus
  /** Planın etkin görevlilerinin üyelikleri. */
  staffMembershipIds: readonly string[]
  /** Aynı plandaki diğer etkin grupların adları (büyük/küçük harf duyarsız karşılaştırılır). */
  otherGroupNames: readonly string[]
  groupCount: number
  /** Düzeltmede grubun önceki sorumlusu (açık turu varken sorumlu değişmez). */
  hasOpenCheck?: boolean
}

const sameName = (a: string, b: string) =>
  a.toLocaleLowerCase('tr-TR') === b.toLocaleLowerCase('tr-TR')

/**
 * Grup açma ve düzeltme (K-517): yönetici ya da ön büro; plan tamamlanmamış ve iptal edilmemiş;
 * sorumlu planın görevlisi (422 `trip_day_leader_not_staff`); ad planda tekil (409
 * `trip_day_group_name_taken`); planda en çok 30 grup. Açık turu olan grubun sorumlusu değişmez
 * (422 `trip_day_check_open`).
 */
export function planTripDayGroup(
  fields: { name?: string | undefined; leaderMembershipId?: string | undefined },
  checks: TripDayGroupChecks,
  mode: 'create' | 'update',
): void {
  assertManager(checks.role)
  assertEditable(checks.planStatus)
  if (mode === 'create' && checks.groupCount >= TRIP_DAY_GROUPS_MAX)
    throw ruleError(
      'trip_day_groups_full',
      `Bir gezide en fazla ${String(TRIP_DAY_GROUPS_MAX)} grup olur.`,
    )
  if (
    fields.leaderMembershipId !== undefined &&
    !checks.staffMembershipIds.includes(fields.leaderMembershipId)
  )
    throw ruleError(
      'trip_day_leader_not_staff',
      'Grup sorumlusu gezi planının görevlilerinden biri olmalı.',
      ['leaderMembershipId'],
    )
  if (mode === 'update' && fields.leaderMembershipId !== undefined && checks.hasOpenCheck === true)
    throw ruleError(
      'trip_day_check_open',
      'Grubun süren yoklama turu var; sorumlu tur bitince değiştirilir.',
      ['leaderMembershipId'],
    )
  const name = fields.name
  if (name !== undefined && checks.otherGroupNames.some((other) => sameName(other, name)))
    throw new DomainError('trip_day_group_name_taken', 'Bu gezide aynı adlı bir grup var.', {
      kind: 'conflict',
      path: ['name'],
    })
}

/** Grup arşivleme (K-517): yoklama turu açılmış grup arşivlenmez; öğrencileri gruptan çıkar. */
export function planTripDayGroupArchive(checks: {
  role: string
  planStatus: TripPlanStatus
  checkCount: number
}): void {
  assertManager(checks.role)
  assertEditable(checks.planStatus)
  if (checks.checkCount > 0)
    throw ruleError(
      'trip_day_group_has_checks',
      'Yoklama turu açılmış grup kaldırılamaz; öğrencileri başka gruba taşıyın.',
    )
}

export interface TripDayAssignChecks {
  role: string
  planStatus: TripPlanStatus
  /** Hedef grup etkin ve bu planda mı (`groupId: null` ise yok sayılır). */
  targetExists: boolean
  /** Gezinin katılımcıları (bağlı etkinlikte asil katılım, etkinliksiz planda kayıtlı öğrenci). */
  eligible: ReadonlySet<string>
  /** Öğrencinin şimdiki grubu (yoksa yok). */
  currentGroup: ReadonlyMap<string, string>
  /** Süren turu olan gruplar. */
  openGroups: ReadonlySet<string>
}

export type TripDayAssignPlan = {
  /** Gruba eklenecek (grubu olmayan) öğrenciler. */
  add: string[]
  /** Başka gruptan taşınacaklar. */
  move: string[]
  /** Gruptan çıkarılacaklar. */
  remove: string[]
}

/**
 * Dağıtım (K-517): yalnız katılımcı (422 `trip_day_student_not_participant`); hedefte ya da
 * öğrencinin şimdiki grubunda süren tur varken dağıtım değişmez (422 `trip_day_check_open`: turun
 * listesi tur boyunca sabit kalır). Zaten aynı gruptaki öğrenci için bir şey yazılmaz.
 */
export function planTripDayAssign(
  input: TripDayAssignFields,
  checks: TripDayAssignChecks,
): TripDayAssignPlan {
  assertManager(checks.role)
  assertEditable(checks.planStatus)
  if (input.groupId !== null && !checks.targetExists)
    throw ruleError('trip_day_group_not_found', 'Grup bu gezide bulunamadı.', ['groupId'])
  const plan: TripDayAssignPlan = { add: [], move: [], remove: [] }
  input.studentIds.forEach((id, index) => {
    const current = checks.currentGroup.get(id)
    if (input.groupId === null) {
      if (current === undefined) return
      if (checks.openGroups.has(current))
        throw ruleError(
          'trip_day_check_open',
          'Öğrencinin grubunda süren yoklama turu var; tur bitince çıkarın.',
          ['studentIds', String(index)],
        )
      plan.remove.push(id)
      return
    }
    if (!checks.eligible.has(id))
      throw ruleError('trip_day_student_not_participant', 'Öğrenci bu gezinin katılımcısı değil.', [
        'studentIds',
        String(index),
      ])
    if (current === input.groupId) return
    if (
      checks.openGroups.has(input.groupId) ||
      (current !== undefined && checks.openGroups.has(current))
    )
      throw ruleError(
        'trip_day_check_open',
        'Grupta süren yoklama turu var; dağıtım tur bitince değişir.',
        ['studentIds', String(index)],
      )
    if (current === undefined) plan.add.push(id)
    else plan.move.push(id)
  })
  return plan
}

function assertOperator(access: TripDayGroupAccess): void {
  if (!access.operate)
    throw new DomainError(
      'trip_day_not_leader',
      'Yoklamayı yalnız grubun sorumlusu ya da yönetici yürütür.',
      { kind: 'forbidden' },
    )
}

/**
 * Tur açma (K-517): grup sorumlusu ya da yönetici; plan onaylı (422 `trip_day_plan_not_approved`);
 * bugün gezinin günlerinden biri (422 `trip_day_not_today`); grupta öğrenci var (422
 * `trip_day_group_empty`); süren tur yok (409 `trip_day_check_open`); grupta en çok 50 tur.
 */
export function planTripDayCheckStart(checks: {
  access: TripDayGroupAccess
  planStatus: TripPlanStatus
  tripDay: boolean
  memberCount: number
  hasOpenCheck: boolean
  checkCount: number
}): void {
  assertOperator(checks.access)
  if (!(TRIP_DAY_RUNNABLE_STATUSES as readonly string[]).includes(checks.planStatus))
    throw ruleError('trip_day_plan_not_approved', 'Yoklama yalnız onaylanmış gezide yapılır.')
  if (!checks.tripDay)
    throw ruleError('trip_day_not_today', 'Yoklama yalnız gezi günlerinde yapılır.')
  if (checks.memberCount === 0)
    throw ruleError('trip_day_group_empty', 'Grupta öğrenci yok; önce öğrencileri dağıtın.')
  if (checks.hasOpenCheck)
    throw new DomainError(
      'trip_day_check_open',
      'Grubun süren yoklama turu var; önce onu bitirin.',
      { kind: 'conflict' },
    )
  if (checks.checkCount >= TRIP_DAY_CHECKS_MAX)
    throw ruleError(
      'trip_day_checks_full',
      `Bir grupta en fazla ${String(TRIP_DAY_CHECKS_MAX)} yoklama turu olur.`,
    )
}

export interface TripDayMarkState {
  status: TripDayMarkStatus
  markedAt: Date
}

export type TripDayMarkWrite = {
  studentId: string
  next: TripDayMarkState
  /** Öğrencinin önceki işareti yoksa ekleme. */
  insert: boolean
}

/**
 * Tur işaretleri (K-517): süren turda (422 `trip_day_check_closed`), sorumlu ya da yönetici; yalnız
 * turun listesindeki öğrenci (422 `trip_day_student_not_in_group`). İşaret anı verilmezse sunucu
 * anıdır; ileri olamaz (5 dk pay; 422 `trip_day_mark_future`), 24 saatten eski olamaz (422
 * `trip_day_mark_too_old`). Aynı durumun yinelenmesi bir şey yazmaz (çift dokunma ve çevrimdışı
 * yeniden deneme güvenli); var işaretli öğrenci yok, yok işaretli öğrenci var yapılabilir.
 */
export function planTripDayMarks(
  input: TripDayMarksFields,
  checks: {
    access: TripDayGroupAccess
    status: TripDayCheckStatus
    roster: ReadonlySet<string>
    current: ReadonlyMap<string, TripDayMarkState>
    now: Date
  },
): TripDayMarkWrite[] {
  assertOperator(checks.access)
  if (checks.status !== 'open')
    throw ruleError('trip_day_check_closed', 'Yoklama turu bitti; işaret değiştirilemez.')
  const writes: TripDayMarkWrite[] = []
  input.marks.forEach((mark, index) => {
    if (!checks.roster.has(mark.studentId))
      throw ruleError('trip_day_student_not_in_group', 'Öğrenci bu grupta değil.', [
        'marks',
        String(index),
        'studentId',
      ])
    const markedAt = mark.markedAt === undefined ? checks.now : new Date(mark.markedAt)
    if (markedAt.getTime() > checks.now.getTime() + TRIP_DAY_MARK_CLOCK_SKEW_MS)
      throw ruleError('trip_day_mark_future', 'İşaret saati ileri bir zaman olamaz.', [
        'marks',
        String(index),
        'markedAt',
      ])
    if (markedAt.getTime() < checks.now.getTime() - TRIP_DAY_MARK_MAX_AGE_MS)
      throw ruleError('trip_day_mark_too_old', 'İşaret saati 24 saatten eski olamaz.', [
        'marks',
        String(index),
        'markedAt',
      ])
    const current = checks.current.get(mark.studentId)
    if (current?.status === mark.status) return
    writes.push({
      studentId: mark.studentId,
      next: { status: mark.status, markedAt },
      insert: current === undefined,
    })
  })
  return writes
}

export interface TripDayCheckCounts {
  total: number
  present: number
  absent: number
  pending: number
}

export function tripDayCheckCounts(statuses: readonly TripDayRosterStatus[]): TripDayCheckCounts {
  const count = (status: TripDayRosterStatus) => statuses.filter((value) => value === status).length
  return {
    total: statuses.length,
    present: count('present'),
    absent: count('absent'),
    pending: count('pending'),
  }
}

/**
 * Turu "tamam" yapma (K-517, güvenlik): bütün öğrenciler "var" olmalı. Yok ya da işaretlenmemiş
 * öğrenci varken 422 `trip_day_check_missing`; eksikle devam ayrı ve gerekçeli adımdır. Biten tur
 * 409 `trip_day_check_already_closed`.
 */
export function planTripDayCheckComplete(checks: {
  access: TripDayGroupAccess
  status: TripDayCheckStatus
  roster: readonly TripDayRosterStatus[]
}): void {
  assertOperator(checks.access)
  if (checks.status !== 'open')
    throw new DomainError('trip_day_check_already_closed', 'Yoklama turu zaten bitti.', {
      kind: 'conflict',
    })
  const counts = tripDayCheckCounts(checks.roster)
  const missing = counts.absent + counts.pending
  if (missing > 0)
    throw ruleError(
      'trip_day_check_missing',
      `${String(missing)} öğrenci eksik ya da işaretlenmedi; tur tamam yapılamaz. Eksik varsa gerekçeyle "Eksikle devam" seçin.`,
    )
}

/**
 * Eksikle devam (K-517, karar): bütün öğrenciler işaretlenmiş olmalı (422 `trip_day_check_unmarked`:
 * eksik öğrenci açıkça "yok" işaretlenir) ve en az biri "yok" olmalı (422
 * `trip_day_check_no_missing`: herkes varsa tur "tamam" yapılır). Gerekçe zorunludur (şemada).
 */
export function planTripDayCheckProceed(checks: {
  access: TripDayGroupAccess
  status: TripDayCheckStatus
  roster: readonly TripDayRosterStatus[]
}): TripDayCheckCounts {
  assertOperator(checks.access)
  if (checks.status !== 'open')
    throw new DomainError('trip_day_check_already_closed', 'Yoklama turu zaten bitti.', {
      kind: 'conflict',
    })
  const counts = tripDayCheckCounts(checks.roster)
  if (counts.pending > 0)
    throw ruleError(
      'trip_day_check_unmarked',
      `${String(counts.pending)} öğrenci işaretlenmedi; eksik öğrenciyi "Yok" olarak işaretleyin.`,
    )
  if (counts.absent === 0)
    throw ruleError('trip_day_check_no_missing', 'Eksik öğrenci yok; turu "Tamam" olarak bitirin.')
  return counts
}

// --- Acil kart -----------------------------------------------------------------------------------

export const TRIP_DAY_HEALTH_KINDS = ['allergy', 'chronic', 'medication'] as const
export type TripDayHealthKind = (typeof TRIP_DAY_HEALTH_KINDS)[number]
export const TRIP_DAY_HEALTH_KIND_LABELS = {
  allergy: 'alerji',
  chronic: 'kronik durum',
  medication: 'ilaç',
} as const satisfies Record<TripDayHealthKind, string>

/** Sağlık uyarısının kaynağı: sağlık profili okundu mu (K-518). */
export const TRIP_DAY_HEALTH_SOURCES = ['profile', 'unavailable'] as const
export type TripDayHealthSource = (typeof TRIP_DAY_HEALTH_SOURCES)[number]

/** Acil eylem metninin kartta en çok uzunluğu (sağlık profilindeki acil talimattan). */
export const TRIP_DAY_ACTION_MAX = 200

export interface TripDayHealthAlert {
  /** En az bir uyarı var. */
  alert: boolean
  /** Uyarı türleri (ad, şiddet ya da ilaç adı yok). */
  kinds: TripDayHealthKind[]
  /** Kısa acil eylem metni (ör. "Oto-enjektör çantada"); yoksa `null`. */
  action: string | null
  /** Revirde bu gün için onaylı ilaç talebi var (DOM-FIN-151; ilaç adı yok). */
  medicationToday: boolean
  source: TripDayHealthSource
}

/**
 * En az bilgiyle sağlık uyarısı (K-518, KVKK md. 6): profilden yalnız "alerji / kronik durum / ilaç
 * var" işareti ve kısaltılmış acil talimat; alerjen, şiddet, ilaç adı ve doz karta girmez. Profil
 * okunamadıysa (`profile: null`; okuyanın sağlık erişimi yok) yalnız revirdeki onaylı ilaç işareti
 * kalır.
 */
export function tripDayHealthAlert(input: {
  profile: {
    allergies: number
    chronicConditions: number | null
    medications: number | null
    emergencyInstructions: string
  } | null
  medicationToday: boolean
}): TripDayHealthAlert {
  const kinds: TripDayHealthKind[] = []
  const profile = input.profile
  if (profile !== null) {
    if (profile.allergies > 0) kinds.push('allergy')
    if ((profile.chronicConditions ?? 0) > 0) kinds.push('chronic')
    if ((profile.medications ?? 0) > 0) kinds.push('medication')
  }
  const instructions = profile?.emergencyInstructions.trim() ?? ''
  const action =
    instructions === ''
      ? null
      : instructions.length > TRIP_DAY_ACTION_MAX
        ? `${instructions.slice(0, TRIP_DAY_ACTION_MAX - 1).trimEnd()}…`
        : instructions
  return {
    alert: kinds.length > 0 || action !== null || input.medicationToday,
    kinds,
    action,
    medicationToday: input.medicationToday,
    source: profile === null ? 'unavailable' : 'profile',
  }
}

/** Uyarı metni: `Dikkat: alerji, ilaç var · bugün ilaç var`; uyarı yoksa `null`. */
export function tripDayHealthLabel(alert: Pick<TripDayHealthAlert, 'kinds' | 'medicationToday'>) {
  const parts: string[] = []
  if (alert.kinds.length > 0)
    parts.push(
      `Dikkat: ${alert.kinds.map((kind) => TRIP_DAY_HEALTH_KIND_LABELS[kind]).join(', ')} var`,
    )
  if (alert.medicationToday) parts.push('Bugün ilaç var')
  return parts.length === 0 ? null : parts.join(' · ')
}

/** Tur özeti: `12 var · 1 yok · 2 işaretlenmedi`. */
export function tripDayCountsLabel(counts: TripDayCheckCounts): string {
  const parts = [`${String(counts.present)} var`, `${String(counts.absent)} yok`]
  if (counts.pending > 0) parts.push(`${String(counts.pending)} işaretlenmedi`)
  return parts.join(' · ')
}
