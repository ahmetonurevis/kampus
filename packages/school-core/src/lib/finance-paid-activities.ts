import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { daySchema } from './domain.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'
import { ACTIVITY_FEE_KIND } from './fee-tariffs.ts'
import {
  planRefundPayment,
  type PayRefundOutput,
  type RefundPaymentContext,
} from './withdrawals.ts'

/**
 * Gezi ve etkinlik ücreti (docs/domain/finans.md DOM-FIN-098; ON-142; K-300…K-303). Kurum ücretli
 * bir gezi ya da etkinliği finans tarafında hafif bir kayıtla tanımlar: ad, tür, gün, kişi başı
 * ücret, son katılım ve son iptal günü, kontenjan ve geç iptalin iade kuralı. Gezi planı (ON-155)
 * gelince kayıt dış referansla (`externalRef`) plana bağlanır.
 *
 * Katılım öğrenciye sözleşmesiz tek taksit açar (`feeKind: 'activity'`); ayrı sözleşme yoktur.
 * Katılımın iptali taksiti kapatır ya da tahsil edilmiş tutarı iade kaydına çevirir; iade ayrılış
 * iadesinin kurallarıyla ödenir ve gün sonuna girer (DOM-FIN-041, M-13).
 *
 * Fonksiyonlar saftır; zaman `today` (Europe/Istanbul günü) parametresiyle gelir. State alan
 * işlemler (`applyPaidActivityJoin`, `applyParticipationCancel`) taksitleri yerinde değiştirir.
 */

/** Etkinliği ve katılımcıları okuyan, katılım yazan ve katılımı iptal eden roller (K-300). */
export const PAID_ACTIVITY_READ_ROLES = ['yonetici', 'onburo'] as const
export const PAID_ACTIVITY_JOIN_ROLES = ['yonetici', 'onburo'] as const
/** Etkinliği tanımlayan, düzelten, iptal eden ve iadeyi ödeyen rol (K-300, K-303). */
export const PAID_ACTIVITY_MANAGE_ROLES = ['yonetici'] as const

export const PAID_ACTIVITY_KINDS = ['trip', 'event'] as const
export type PaidActivityKind = (typeof PAID_ACTIVITY_KINDS)[number]
export const PAID_ACTIVITY_KIND_LABELS = {
  trip: 'Gezi',
  event: 'Etkinlik',
} as const satisfies Record<PaidActivityKind, string>

/** Son iptal gününden sonraki iptalin iade kuralı (K-302). */
export const LATE_REFUND_RULES = ['percent', 'cost'] as const
export type LateRefundRule = (typeof LATE_REFUND_RULES)[number]
export const LATE_REFUND_RULE_LABELS = {
  percent: 'Ücretin belirli oranı iade edilir',
  cost: 'Gerçekleşen masraf düşülür',
} as const satisfies Record<LateRefundRule, string>

export const PAID_ACTIVITY_STATUSES = ['open', 'cancelled'] as const
export type PaidActivityStatus = (typeof PAID_ACTIVITY_STATUSES)[number]
export const PAID_ACTIVITY_STATUS_LABELS = {
  open: 'Açık',
  cancelled: 'İptal edildi',
} as const satisfies Record<PaidActivityStatus, string>

/**
 * Katılım durumu (K-301, K-369, K-370): `active` asil ve taksiti açık; `awaiting_consent` asil,
 * yeri ayrılmış ama veli izni gelmediği için taksiti açılmamış; `waitlisted` yedek (yer ve taksit
 * yok); `cancelled` iptal. Kontenjanı asiller ve izin bekleyenler doldurur.
 */
export const PARTICIPATION_STATUSES = [
  'active',
  'awaiting_consent',
  'waitlisted',
  'cancelled',
] as const
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number]
export const PARTICIPATION_STATUS_LABELS = {
  active: 'Asil',
  awaiting_consent: 'İzin bekliyor',
  waitlisted: 'Yedek',
  cancelled: 'İptal',
} as const satisfies Record<ParticipationStatus, string>
/** Kontenjandan yer tutan durumlar (K-369). */
export const SEAT_STATUSES = [
  'active',
  'awaiting_consent',
] as const satisfies readonly ParticipationStatus[]
export const holdsSeat = (status: ParticipationStatus) =>
  (SEAT_STATUSES as readonly ParticipationStatus[]).includes(status)

/**
 * İptali kim yaptı: katılımcı (kural uygulanır), kurum etkinliği iptal etti (tam iade) ya da veli
 * izni geri çekildi ya da reddedildi (katılımcı iptali gibi K-302 kuralı; K-370).
 */
export const PARTICIPATION_CANCEL_KINDS = ['participant', 'activity', 'consent'] as const
export type ParticipationCancelKind = (typeof PARTICIPATION_CANCEL_KINDS)[number]

/**
 * Veli izni (K-370): etkinlik izin istemiyorsa `not_required`; isteniyorsa `pending` (bekliyor),
 * `granted` (alındı) ya da `withdrawn` (geri çekildi ya da reddedildi; katılım iptal edilir).
 */
export const CONSENT_STATUSES = ['not_required', 'pending', 'granted', 'withdrawn'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]
export const CONSENT_STATUS_LABELS = {
  not_required: 'İzin gerekmiyor',
  pending: 'İzin bekleniyor',
  granted: 'İzin alındı',
  withdrawn: 'İzin geri çekildi',
} as const satisfies Record<ConsentStatus, string>
/** İznin geldiği kanal: dijital izin formu (IST-067) ya da personelin girdiği kâğıt, telefon, yüz yüze. */
export const CONSENT_CHANNELS = ['permission_form', 'paper', 'phone', 'in_person'] as const
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number]
export const CONSENT_CHANNEL_LABELS = {
  permission_form: 'Dijital izin formu',
  paper: 'Kâğıt izin dilekçesi',
  phone: 'Telefon',
  in_person: 'Yüz yüze',
} as const satisfies Record<ConsentChannel, string>
/** Personelin elle girebildiği kanallar; dijital form yalnız eşitlemeyle gelir. */
export const MANUAL_CONSENT_CHANNELS = [
  'paper',
  'phone',
  'in_person',
] as const satisfies readonly ConsentChannel[]

/** Katılımcının ödeme durumu; saklanmaz, taksit ve tahsilattan türetilir (DOM-FIN-030). */
export const PARTICIPATION_PAYMENT_STATUSES = ['not_billed', 'unpaid', 'partial', 'paid'] as const
export type ParticipationPaymentStatus = (typeof PARTICIPATION_PAYMENT_STATUSES)[number]
export const PARTICIPATION_PAYMENT_STATUS_LABELS = {
  not_billed: 'Taksit yok',
  unpaid: 'Ödenmedi',
  partial: 'Kısmi',
  paid: 'Ödendi',
} as const satisfies Record<ParticipationPaymentStatus, string>

export const PARTICIPATION_REFUND_STATUSES = ['none', 'pending', 'paid'] as const
export type ParticipationRefundStatus = (typeof PARTICIPATION_REFUND_STATUSES)[number]
export const PARTICIPATION_REFUND_STATUS_LABELS = {
  none: 'İade yok',
  pending: 'İade bekliyor',
  paid: 'İade ödendi',
} as const satisfies Record<ParticipationRefundStatus, string>

export const PAID_ACTIVITY_NAME_MAX = 120
export const PAID_ACTIVITY_REF_MAX = 120
export const PAID_ACTIVITY_CAPACITY_MAX = 2000
export const PAID_ACTIVITY_FEE_MAX = 10_000_000
export const PAID_ACTIVITY_CANCEL_REASON_MIN = 5
export const PAID_ACTIVITY_CANCEL_REASON_MAX = 500
/** Etkinlik başına iptal edilmemiş yedek üst sınırı (K-369). */
export const PAID_ACTIVITY_WAITLIST_MAX = 500

const DAY_TIME = 'T09:00:00.000Z'

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Etkinlik adını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(
    PAID_ACTIVITY_NAME_MAX,
    `En fazla ${String(PAID_ACTIVITY_NAME_MAX)} karakter girebilirsiniz.`,
  )
const capacitySchema = z
  .number('Kontenjanı girin.')
  .int('Kontenjan tam sayı olmalıdır.')
  .min(1, 'Kontenjan en az 1 olmalıdır.')
  .max(
    PAID_ACTIVITY_CAPACITY_MAX,
    `Kontenjan en çok ${String(PAID_ACTIVITY_CAPACITY_MAX)} olabilir.`,
  )
const centsSchema = (label: string) =>
  z
    .number(`${label} girin.`)
    .int(`${label} kuruş cinsinden tam sayı olmalıdır.`)
    .max(PAID_ACTIVITY_FEE_MAX, `${label} en çok 100.000 ₺ olabilir.`)
const permissionFormIdSchema = z
  .string('İzin formunu seçin.')
  .trim()
  .min(1, 'İzin formunu seçin ya da boş bırakın.')
  .max(PAID_ACTIVITY_REF_MAX, 'İzin formu kimliği geçersiz.')
  .nullable()
const externalRefSchema = z
  .string()
  .trim()
  .min(1, 'Dış referansı yazın ya da boş bırakın.')
  .max(PAID_ACTIVITY_REF_MAX, `En fazla ${String(PAID_ACTIVITY_REF_MAX)} karakter girebilirsiniz.`)
  .nullable()

export const paidActivitySchema = z
  .strictObject({
    name: nameSchema,
    kind: z.enum(PAID_ACTIVITY_KINDS, 'Türü seçin.'),
    activityDate: daySchema,
    feeCents: centsSchema('Kişi başı ücreti').min(1, 'Kişi başı ücret sıfırdan büyük olmalıdır.'),
    joinDeadline: daySchema,
    cancelDeadline: daySchema,
    capacity: capacitySchema,
    lateRefundRule: z.enum(LATE_REFUND_RULES, 'Geç iptalin iade kuralını seçin.'),
    /** Oran kuralında son iptal gününden sonra iade edilen yüzde (0–100). */
    lateRefundPercent: z
      .number('İade oranını girin.')
      .int('İade oranı tam sayı olmalıdır.')
      .min(0, 'İade oranı 0 ile 100 arasında olmalıdır.')
      .max(100, 'İade oranı 0 ile 100 arasında olmalıdır.')
      .nullable(),
    /** Masraf kuralında kişi başı düşülen gerçekleşen masraf (kuruş). */
    lateCostCents: centsSchema('Kişi başı masrafı').min(0, 'Masraf eksi olamaz.').nullable(),
    /** Gezi planı (ON-155) ya da başka kaynak kaydı; plan gelince bağlanır. */
    externalRef: externalRefSchema.default(null),
    /** Katılım veli izni ister (K-370): izinsiz asil "izin bekliyor" olur, taksiti izinle açılır. */
    requiresConsent: z.boolean('Veli izni seçeneğini belirtin.').default(false),
    /** İznin okunacağı dijital izin formu (IST-067, `permissionForms`); yalnız izin isteyen etkinlikte. */
    permissionFormId: permissionFormIdSchema.default(null),
  })
  .superRefine((value, ctx) => {
    if (value.permissionFormId !== null && !value.requiresConsent)
      ctx.addIssue({
        code: 'custom',
        path: ['permissionFormId'],
        message: 'İzin formu yalnız veli izni isteyen etkinliğe bağlanır.',
      })
    if (value.joinDeadline > value.activityDate)
      ctx.addIssue({
        code: 'custom',
        path: ['joinDeadline'],
        message: 'Son katılım günü etkinlik gününden sonra olamaz.',
      })
    if (value.cancelDeadline > value.activityDate)
      ctx.addIssue({
        code: 'custom',
        path: ['cancelDeadline'],
        message: 'Son iptal günü etkinlik gününden sonra olamaz.',
      })
    if (value.lateRefundRule === 'percent' && value.lateRefundPercent === null)
      ctx.addIssue({
        code: 'custom',
        path: ['lateRefundPercent'],
        message: 'Geç iptalde iade edilecek oranı girin.',
      })
    if (value.lateRefundRule === 'percent' && value.lateCostCents !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['lateCostCents'],
        message: 'Oran kuralında masraf girilmez.',
      })
    if (value.lateRefundRule === 'cost' && value.lateCostCents === null)
      ctx.addIssue({
        code: 'custom',
        path: ['lateCostCents'],
        message: 'Geç iptalde düşülecek kişi başı masrafı girin.',
      })
    if (value.lateRefundRule === 'cost' && value.lateRefundPercent !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['lateRefundPercent'],
        message: 'Masraf kuralında oran girilmez.',
      })
    if (value.lateCostCents !== null && value.lateCostCents > value.feeCents)
      ctx.addIssue({
        code: 'custom',
        path: ['lateCostCents'],
        message: 'Masraf kişi başı ücretten büyük olamaz.',
      })
  })
export type PaidActivityInput = z.input<typeof paidActivitySchema>
export type PaidActivityOutput = z.output<typeof paidActivitySchema>

/** Düzeltilebilen alanlar (K-300): ücret, gün ve iade koşulları katılımcı bağladığı için değişmez. */
export const updatePaidActivitySchema = z
  .strictObject({
    name: nameSchema.optional(),
    capacity: capacitySchema.optional(),
    joinDeadline: daySchema.optional(),
    externalRef: externalRefSchema.optional(),
    permissionFormId: permissionFormIdSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdatePaidActivityInput = z.input<typeof updatePaidActivitySchema>

export const joinPaidActivitySchema = z.strictObject({
  studentId: z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(120),
})
export type JoinPaidActivityInput = z.input<typeof joinPaidActivitySchema>

export const cancelPaidActivitySchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(
      PAID_ACTIVITY_CANCEL_REASON_MIN,
      `En az ${String(PAID_ACTIVITY_CANCEL_REASON_MIN)} karakter girin.`,
    )
    .max(
      PAID_ACTIVITY_CANCEL_REASON_MAX,
      `En fazla ${String(PAID_ACTIVITY_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelPaidActivityInput = z.input<typeof cancelPaidActivitySchema>

// --- Etkinlik ------------------------------------------------------------------------------------

export interface PaidActivityTerms {
  status: PaidActivityStatus
  name: string
  activityDate: string
  feeCents: number
  joinDeadline: string
  cancelDeadline: string
  capacity: number
  lateRefundRule: LateRefundRule
  lateRefundPercent: number | null
  lateCostCents: number | null
  /** Katılım veli izni ister (K-370); alanı olmayan etkinlik istemez. */
  requiresConsent?: boolean
}

/** Etkinlik tanımı (K-300): etkinlik günü geçmiş olamaz; kurallar şemadadır. */
export function planPaidActivity(input: unknown, today: string): PaidActivityOutput {
  const data = paidActivitySchema.parse(input)
  if (data.activityDate < today)
    throw new DomainError('paid_activity_date_past', 'Etkinlik günü geçmiş bir gün olamaz.', {
      path: ['activityDate'],
    })
  return data
}

/**
 * Etkinlik düzeltmesi (K-300): ad, kontenjan, son katılım günü, dış referans ve izin formu.
 * Kontenjan yer tutan katılımcı (asil ve izin bekleyen) sayısının altına inemez; artarsa yedekler
 * sırayla asile geçer (K-369, servis). Son katılım günü etkinlik gününü geçemez. İzin formu yalnız
 * veli izni isteyen etkinliğe bağlanır (K-370). İptal edilmiş etkinlik düzeltilmez.
 */
export function planPaidActivityUpdate(
  activity: Pick<PaidActivityTerms, 'status' | 'activityDate' | 'capacity' | 'joinDeadline'> & {
    name: string
    externalRef: string | null
    requiresConsent?: boolean
    permissionFormId?: string | null
  },
  input: unknown,
  context: { activeCount: number },
) {
  const data = updatePaidActivitySchema.parse(input)
  if (activity.status === 'cancelled')
    throw new DomainError('paid_activity_cancelled', 'İptal edilmiş etkinlik düzeltilemez.', {
      kind: 'conflict',
    })
  if (data.capacity !== undefined && data.capacity < context.activeCount)
    throw new DomainError(
      'paid_activity_capacity_below_participants',
      `Kontenjan katılımcı sayısının (${String(context.activeCount)}) altına inemez.`,
      { path: ['capacity'] },
    )
  if (data.joinDeadline !== undefined && data.joinDeadline > activity.activityDate)
    throw new DomainError(
      'paid_activity_join_after_date',
      'Son katılım günü etkinlik gününden sonra olamaz.',
      { path: ['joinDeadline'] },
    )
  if (
    data.permissionFormId !== undefined &&
    data.permissionFormId !== null &&
    activity.requiresConsent !== true
  )
    throw new DomainError(
      'paid_activity_consent_not_required',
      'İzin formu yalnız veli izni isteyen etkinliğe bağlanır.',
      { path: ['permissionFormId'] },
    )
  const next = {
    name: data.name ?? activity.name,
    capacity: data.capacity ?? activity.capacity,
    joinDeadline: data.joinDeadline ?? activity.joinDeadline,
    externalRef: data.externalRef === undefined ? activity.externalRef : data.externalRef,
    permissionFormId:
      data.permissionFormId === undefined
        ? (activity.permissionFormId ?? null)
        : data.permissionFormId,
  }
  const current = { ...activity, permissionFormId: activity.permissionFormId ?? null }
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (field) => next[field] !== current[field],
  )
  if (changed.length === 0)
    throw new DomainError('paid_activity_unchanged', 'Değişiklik yok.', { kind: 'rule' })
  return { ...next, changed }
}

/** Etkinliğin iptali (K-302): gerekçe zorunlu; iptal edilmiş etkinlik yeniden iptal edilmez. */
export function planPaidActivityCancel(
  activity: Pick<PaidActivityTerms, 'status'>,
  input: unknown,
) {
  const data = cancelPaidActivitySchema.parse(input)
  if (activity.status === 'cancelled')
    throw new DomainError('paid_activity_cancelled', 'Bu etkinlik zaten iptal edilmiş.', {
      kind: 'conflict',
    })
  return data
}

// --- Katılım -------------------------------------------------------------------------------------

type Invoice = State['invoices'][number]

/** Öğrencinin sözleşmesiz taksitlerinde sıradaki numara (geri isteme alacağıyla aynı kural). */
function nextInstallment(state: Pick<State, 'invoices'>, studentId: string): number {
  return (
    state.invoices
      .filter((invoice) => invoice.studentId === studentId)
      .reduce((highest, invoice) => Math.max(highest, invoice.installment), 0) + 1
  )
}

/** Katılım taksiti (K-301): sözleşmesiz, tür `activity`, numara öğrencinin taksitlerinden devam eder. */
export function activityInvoice(
  state: Pick<State, 'invoices'>,
  input: { id: string; studentId: string; amount: number; dueDate: string },
): Invoice {
  return {
    id: input.id,
    studentId: input.studentId,
    installment: nextInstallment(state, input.studentId),
    amount: input.amount,
    dueDate: `${input.dueDate}${DAY_TIME}`,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: ACTIVITY_FEE_KIND,
  }
}

/**
 * Katılım taksitini State'e yazar; vade son katılım günü, o gün geçtiyse (yedekten geçiş ya da geç
 * gelen izin) bugündür (K-369, K-370).
 */
export function openActivityInvoice(
  state: Pick<State, 'invoices'>,
  activity: Pick<PaidActivityTerms, 'feeCents' | 'joinDeadline'>,
  studentId: string,
  context: { today: string; makeId: (prefix: string) => string },
): string {
  const invoice = activityInvoice(state, {
    id: context.makeId('inv'),
    studentId,
    amount: activity.feeCents,
    dueDate: context.today > activity.joinDeadline ? context.today : activity.joinDeadline,
  })
  state.invoices.push(invoice)
  return invoice.id
}

/** Yazılan katılımın durumu: asil, izin bekleyen asil ya da yedek. */
export type JoinedStatus = Exclude<ParticipationStatus, 'cancelled'>

export interface JoinPlan {
  studentId: string
  status: JoinedStatus
  consentStatus: Extract<ConsentStatus, 'not_required' | 'pending'>
  /** Yalnız izin gerekmeyen ya da izni alınmış asilde açılan taksit; yedekte ve izin bekleyende yok. */
  invoiceId: string | null
  feeCents: number
  /** Yedek sıra numarası (etkinlikte artan, yeniden kullanılmaz); asilde `null`. */
  waitlistPosition: number | null
}

/** Etkinliğin o anki yer durumu (kurum kilidi altında okunur). */
export interface SeatCounts {
  /** Yer tutan (asil ve izin bekleyen) katılım sayısı. */
  seatCount: number
  /** İptal edilmemiş yedek sayısı. */
  waitlistCount: number
  /** Sıradaki yedek numarası. */
  nextWaitlistPosition: number
}

/** Katılım yazılabilir mi (K-301): etkinlik açık ve son katılım günü geçmemiş. */
export function assertJoinOpen(
  activity: Pick<PaidActivityTerms, 'status' | 'joinDeadline'>,
  today: string,
) {
  if (activity.status === 'cancelled')
    throw new DomainError('paid_activity_cancelled', 'İptal edilmiş etkinliğe katılım yazılmaz.', {
      kind: 'conflict',
    })
  if (today > activity.joinDeadline)
    throw new DomainError(
      'paid_activity_join_closed',
      'Son katılım günü geçti; bu etkinliğe katılım yazılmaz.',
    )
}

/**
 * Yeni katılımın yeri (K-369, K-370): kontenjanda yer varsa asil (izin istenen etkinlikte "izin
 * bekliyor"), yoksa sıradaki numarayla yedek. Yedek listesi doluysa 409. `counts` yerinde artar
 * (toplu eklemede sıradaki öğrenci güncel sayıyı görür).
 */
export function claimSeat(
  activity: Pick<PaidActivityTerms, 'capacity' | 'requiresConsent'>,
  counts: SeatCounts,
): { status: JoinedStatus; waitlistPosition: number | null } {
  if (counts.seatCount < activity.capacity) {
    counts.seatCount += 1
    return {
      status: activity.requiresConsent === true ? 'awaiting_consent' : 'active',
      waitlistPosition: null,
    }
  }
  if (counts.waitlistCount >= PAID_ACTIVITY_WAITLIST_MAX)
    throw new DomainError(
      'paid_activity_waitlist_full',
      `Kontenjan ve yedek listesi dolu (en çok ${String(PAID_ACTIVITY_WAITLIST_MAX)} yedek); katılım yazılmaz.`,
      { kind: 'conflict' },
    )
  const waitlistPosition = counts.nextWaitlistPosition
  counts.waitlistCount += 1
  counts.nextWaitlistPosition += 1
  return { status: 'waitlisted', waitlistPosition }
}

/** Yeri belli katılımın planı; asilde izin gerekmiyorsa taksit açılır. */
export function joinPlanFor(
  state: Pick<State, 'invoices'>,
  activity: PaidActivityTerms,
  studentId: string,
  seat: { status: JoinedStatus; waitlistPosition: number | null },
  context: { today: string; makeId: (prefix: string) => string },
): JoinPlan {
  return {
    studentId,
    status: seat.status,
    consentStatus: activity.requiresConsent === true ? 'pending' : 'not_required',
    invoiceId:
      seat.status === 'active' ? openActivityInvoice(state, activity, studentId, context) : null,
    feeCents: activity.feeCents,
    waitlistPosition: seat.waitlistPosition,
  }
}

/**
 * Katılım (K-301, K-369, K-370): etkinlik açık, bugün son katılım gününü geçmemiş, öğrenci kurumda
 * etkin olmalıdır; aynı öğrencinin iptal edilmemiş (asil, izin bekleyen ya da yedek) ikinci katılımı
 * yazılmaz. Kontenjanda yer varsa asil olur ve öğrenciye kişi başı ücret kadar sözleşmesiz taksit
 * açılır (vade son katılım günü); etkinlik veli izni istiyorsa taksit izinle açılır, katılım "izin
 * bekliyor" olur. Kontenjan doluysa yedek sıra numarasıyla yazılır, taksit açılmaz. State'i
 * değiştirir; denetimler yazımdan öncedir.
 */
export function applyPaidActivityJoin(
  state: Pick<State, 'students' | 'invoices'>,
  activity: PaidActivityTerms,
  input: unknown,
  context: {
    today: string
    /** İptal edilmemiş katılımı olan öğrenciler. */
    activeStudentIds: ReadonlySet<string>
    /** Yer durumu; verilmezse bütün iptal edilmemiş katılımlar yer tutar, yedek yoktur. */
    counts?: SeatCounts
    makeId: (prefix: string) => string
    institutionType?: InstitutionType
  },
): JoinPlan {
  const { studentId } = joinPaidActivitySchema.parse(input)
  const learner = learnerWords(context.institutionType)
  assertJoinOpen(activity, context.today)
  const student = state.students.find((item) => item.id === studentId)
  if (!student || (student as { isActive?: boolean }).isActive === false)
    throw new DomainError(
      'paid_activity_student_not_found',
      `${learner.title} bulunamadı ya da etkin değil.`,
      { path: ['studentId'] },
    )
  if (context.activeStudentIds.has(studentId))
    throw new DomainError(
      'paid_activity_participant_exists',
      `${learner.title} bu etkinliğe zaten yazılı.`,
      { kind: 'conflict', path: ['studentId'] },
    )
  const counts = context.counts ?? {
    seatCount: context.activeStudentIds.size,
    waitlistCount: 0,
    nextWaitlistPosition: 1,
  }
  const seat = claimSeat(activity, { ...counts })
  return joinPlanFor(state, activity, studentId, seat, context)
}

/**
 * İptalde katılımcının yükleneceği tutar (K-302). Son iptal günü (dahil) içinde ya da etkinliği
 * kurum iptal ettiyse kesinti yoktur. Sonrasında oran kuralında ücretin iade edilmeyen kısmı
 * (iade edilen tutar kuruşa yuvarlanır), masraf kuralında kişi başı masraf (en çok ücret) kalır.
 */
export function retainedOnCancel(
  activity: Pick<
    PaidActivityTerms,
    'feeCents' | 'cancelDeadline' | 'lateRefundRule' | 'lateRefundPercent' | 'lateCostCents'
  >,
  cancelledDate: string,
  kind: ParticipationCancelKind,
  feeCents = activity.feeCents,
): number {
  if (kind === 'activity' || cancelledDate <= activity.cancelDeadline) return 0
  if (activity.lateRefundRule === 'cost') return Math.min(feeCents, activity.lateCostCents ?? 0)
  const refundable = Math.round((feeCents * (activity.lateRefundPercent ?? 0)) / 100)
  return feeCents - refundable
}

export interface ParticipationCancelPlan {
  cancelKind: ParticipationCancelKind
  cancelledDate: string
  /** Taksite iptal anına dek alınmış tutar. */
  paidCents: number
  /** Katılımcıda kalan kesinti (K-302). */
  retainedCents: number
  /** İade edilecek tutar: alınan tutarın kesintiyi aşan kısmı. */
  refundCents: number
  /** Kapanan (listeden düşen) taksit; tam ödenmiş taksit kalır. */
  closedInvoiceId: string | null
  /** Kesinti alınandan fazlaysa farkın yeni taksiti. */
  debtInvoiceId: string | null
}

/**
 * Katılımın iptali (K-302). Tam ödenmiş taksit kalır ve ödenenin kesintiyi aşan kısmı iade kaydı
 * olur. Bütünüyle ödenmemiş taksit kapanır (ücretsiz okutma ve ayrılıştaki gibi listeden düşer):
 * alınmış kısım kesintiyi aşıyorsa fark iade edilir, kesintiden azsa kalan kesinti aynı gün vadeli
 * yeni taksit olur. Taksiti açılmamış katılım (yedek ve izin bekleyen, K-369, K-370) parasız
 * kapanır. Katılım iptal edilmişse ya da taksiti bulunamazsa hiçbir şey değişmez.
 */
export function applyParticipationCancel(
  state: Pick<State, 'invoices'>,
  activity: Pick<
    PaidActivityTerms,
    'cancelDeadline' | 'lateRefundRule' | 'lateRefundPercent' | 'lateCostCents' | 'feeCents'
  >,
  participation: {
    studentId: string
    status: ParticipationStatus
    invoiceId: string | null
    feeCents: number
  },
  context: {
    today: string
    kind: ParticipationCancelKind
    allocated: ReadonlyMap<string, number>
    makeId: (prefix: string) => string
  },
): ParticipationCancelPlan {
  if (participation.status === 'cancelled')
    throw new DomainError(
      'paid_activity_participation_cancelled',
      'Bu katılım zaten iptal edilmiş.',
      {
        kind: 'conflict',
      },
    )
  if (participation.invoiceId === null)
    return {
      cancelKind: context.kind,
      cancelledDate: context.today,
      paidCents: 0,
      retainedCents: 0,
      refundCents: 0,
      closedInvoiceId: null,
      debtInvoiceId: null,
    }
  const invoice = state.invoices.find((item) => item.id === participation.invoiceId)
  if (!invoice)
    throw new DomainError(
      'paid_activity_invoice_missing',
      'Katılımın taksiti bulunamadı; finans kayıtlarını denetleyin.',
      { kind: 'conflict' },
    )
  const retainedCents = retainedOnCancel(
    activity,
    context.today,
    context.kind,
    participation.feeCents,
  )
  const plan = {
    cancelKind: context.kind,
    cancelledDate: context.today,
    retainedCents,
  }
  if (invoice.paidAt) {
    return {
      ...plan,
      paidCents: invoice.amount,
      refundCents: Math.max(0, invoice.amount - retainedCents),
      closedInvoiceId: null,
      debtInvoiceId: null,
    }
  }
  const paidCents = Math.min(invoice.amount, context.allocated.get(invoice.id) ?? 0)
  state.invoices = state.invoices.filter((item) => item.id !== invoice.id)
  const debtCents = Math.max(0, retainedCents - paidCents)
  let debtInvoiceId: string | null = null
  if (debtCents > 0) {
    const debt = activityInvoice(state, {
      id: context.makeId('inv'),
      studentId: participation.studentId,
      amount: debtCents,
      dueDate: context.today,
    })
    state.invoices.push(debt)
    debtInvoiceId = debt.id
  }
  return {
    ...plan,
    paidCents,
    refundCents: Math.max(0, paidCents - retainedCents),
    closedInvoiceId: invoice.id,
    debtInvoiceId,
  }
}

/** Ödeme durumu; taksiti açılmamış katılım (yedek, izin bekleyen) `not_billed`. */
export const participationPaymentStatus = (
  amountCents: number,
  paidCents: number,
  billed = true,
): ParticipationPaymentStatus =>
  !billed ? 'not_billed' : paidCents >= amountCents ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid'

export const participationRefundStatus = (row: {
  refundCents: number
  refundPaidDate: string | null
}): ParticipationRefundStatus =>
  row.refundPaidDate !== null ? 'paid' : row.refundCents > 0 ? 'pending' : 'none'

/**
 * İadeyi alacak kişi (K-303): öğrencinin kayıtlı velisi; velisi olmayan öğrenci (yetişkin
 * kursiyer) kendisi.
 */
export function activityPayerName(
  student: { name: string } | undefined,
  parent: { name: string } | undefined,
): string {
  return parent?.name ?? student?.name ?? ''
}

/**
 * Katılım iadesinin ödemesi (K-303): ayrılış iadesinin kuralları (`planRefundPayment`, DOM-FIN-041):
 * hesap sahibi iadeyi alacak kişi, kurumun bildirilmiş hesabı, kapalı güne yazılmaz, ileri gün
 * olmaz. Ödeme günü iptal gününden önce olamaz.
 */
export function planParticipationRefund(
  participation: {
    refundCents: number
    refundPaidDate: string | null
    cancelledDate: string | null
    payerName: string
  },
  input: unknown,
  context: RefundPaymentContext,
): PayRefundOutput {
  if (participation.cancelledDate === null || participation.refundCents === 0)
    throw new DomainError('paid_activity_refund_not_due', 'Bu katılımda iade edilecek tutar yok.', {
      kind: 'conflict',
    })
  const paidDate: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'paidDate') : undefined
  if (
    participation.refundPaidDate === null &&
    typeof paidDate === 'string' &&
    paidDate < participation.cancelledDate
  )
    throw new DomainError(
      'paid_activity_refund_before_cancel',
      'İade ödeme tarihi iptal tarihinden önce olamaz.',
      { path: ['paidDate'] },
    )
  try {
    return planRefundPayment(
      {
        refundCents: participation.refundCents,
        refundPaidDate: participation.refundPaidDate,
        payerName: participation.payerName,
        withdrawalDate: participation.cancelledDate,
      },
      input,
      context,
    )
  } catch (error) {
    if (error instanceof DomainError && error.code === 'refund_holder_mismatch')
      throw new DomainError(
        'refund_holder_mismatch',
        'Hesap sahibi öğrencinin kayıtlı velisi (velisi yoksa kendisi) olmalıdır.',
        { path: ['accountHolder'], cause: error },
      )
    throw error
  }
}
