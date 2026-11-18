import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { csvAmount, csvCell, CSV_SEPARATOR } from './csv.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'
import {
  assertJoinOpen,
  claimSeat,
  CONSENT_CHANNEL_LABELS,
  CONSENT_STATUS_LABELS,
  joinPlanFor,
  MANUAL_CONSENT_CHANNELS,
  openActivityInvoice,
  PARTICIPATION_PAYMENT_STATUS_LABELS,
  PARTICIPATION_STATUS_LABELS,
  type ConsentChannel,
  type ConsentStatus,
  type JoinPlan,
  type PaidActivityTerms,
  type ParticipationPaymentStatus,
  type ParticipationStatus,
  type SeatCounts,
} from './finance-paid-activities.ts'

/**
 * Gezi katılımcı yönetimi (docs/domain/finans.md DOM-FIN-112; ON-156; K-369…K-371): yedek listesi,
 * yedekten asile geçiş, veli izni şartı, toplu katılım ve basılabilir katılım listesi. Ücret,
 * taksit ve iade kuralları `finance-paid-activities.ts`'tedir (DOM-FIN-098, K-300…K-303).
 *
 * - Yedekten asile geçiş otomatiktir (K-369): yer açıldığı işlemde (katılım iptali, izin geri
 *   çekilmesi, kontenjan artışı) en küçük sıra numaralı yedek asile geçer ve taksiti o anda açılır.
 *   Etkinlik iptal edilmişse ya da günü geçmişse geçiş olmaz.
 * - Veli izni (K-370): izin isteyen etkinlikte asil "izin bekliyor" olur, yerini tutar; taksit izinle
 *   açılır. İzin personelce (kâğıt, telefon, yüz yüze; veren kişinin adıyla) girilir ya da bağlı
 *   dijital izin formundan (IST-067) eşitlenir. İzin geri çekilir ya da formda reddedilirse katılım
 *   iptal edilir; iade K-302 kuralıyladır (katılımcı iptali gibi).
 *
 * Fonksiyonlar saftır; zaman `today` (Europe/Istanbul günü) parametresiyle gelir.
 */

export const PAID_ACTIVITY_BULK_CLASS_MAX = 20
/** Toplu eklemede çözülen öğrenci üst sınırı. */
export const PAID_ACTIVITY_BULK_STUDENT_MAX = 500
export const CONSENT_GRANTOR_MAX = 120

const identifier = (message: string) => z.string(message).trim().min(1, message).max(120)

export const bulkJoinPaidActivitySchema = z.strictObject({
  classIds: z
    .array(identifier('Sınıfı seçin.'), 'Sınıf seçin.')
    .min(1, 'En az bir sınıf seçin.')
    .max(
      PAID_ACTIVITY_BULK_CLASS_MAX,
      `En fazla ${String(PAID_ACTIVITY_BULK_CLASS_MAX)} sınıf seçebilirsiniz.`,
    )
    .refine((list) => new Set(list).size === list.length, 'Aynı sınıf bir kez seçilir.'),
})
export type BulkJoinPaidActivityInput = z.input<typeof bulkJoinPaidActivitySchema>

export const grantConsentSchema = z.strictObject({
  channel: z.enum(MANUAL_CONSENT_CHANNELS, 'İznin geldiği kanalı seçin.'),
  // kvkk: K — izni veren velinin (ya da yetişkin öğrencinin) adı.
  grantorName: z
    .string('İzni veren kişinin adını yazın.')
    .trim()
    .min(2, 'İzni veren kişinin adını yazın.')
    .max(CONSENT_GRANTOR_MAX, `En fazla ${String(CONSENT_GRANTOR_MAX)} karakter girebilirsiniz.`),
})
export type GrantConsentInput = z.input<typeof grantConsentSchema>

export const withdrawConsentSchema = z.strictObject({
  channel: z.enum(MANUAL_CONSENT_CHANNELS, 'Geri çekmenin geldiği kanalı seçin.'),
})
export type WithdrawConsentInput = z.input<typeof withdrawConsentSchema>

// --- Toplu katılım -------------------------------------------------------------------------------

export interface BulkJoinPlan {
  joined: JoinPlan[]
  /** Zaten iptal edilmemiş katılımı olan öğrenciler (yazılmaz). */
  skippedStudentIds: string[]
}

type BulkStudent = { id: string; name: string; classId?: string | null; isActive?: boolean }

/**
 * Seçilen sınıfların etkin öğrencileri, ada göre (tr) ve kimliğe göre sıralı. Sınıf kurumda yoksa
 * 422; öğrenci yoksa ya da üst sınır aşılırsa 422.
 */
export function bulkJoinStudents(
  state: Pick<State, 'students' | 'classes'>,
  input: unknown,
  institutionType?: InstitutionType,
): string[] {
  const { classIds } = bulkJoinPaidActivitySchema.parse(input)
  const known = new Set(state.classes.map((item) => item.id))
  const missing = classIds.findIndex((id) => !known.has(id))
  if (missing >= 0)
    throw new DomainError('paid_activity_class_not_found', 'Seçilen sınıf bulunamadı.', {
      path: ['classIds', String(missing)],
    })
  const wanted = new Set(classIds)
  const students = (state.students as BulkStudent[])
    .filter((item) => item.isActive !== false && wanted.has(item.classId ?? ''))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
  const learner = learnerWords(institutionType)
  if (students.length === 0)
    throw new DomainError(
      'paid_activity_bulk_empty',
      `Seçilen sınıflarda etkin ${learner.noun} yok.`,
      { path: ['classIds'] },
    )
  if (students.length > PAID_ACTIVITY_BULK_STUDENT_MAX)
    throw new DomainError(
      'paid_activity_bulk_too_large',
      `Bir seferde en çok ${String(PAID_ACTIVITY_BULK_STUDENT_MAX)} ${learner.noun} yazılır; daha az sınıf seçin.`,
      { path: ['classIds'] },
    )
  return students.map((item) => item.id)
}

/**
 * Toplu katılım (K-371): seçilen sınıfların etkin öğrencileri ada göre sırayla yazılır; kontenjan
 * dolana kadar asil (izin isteyen etkinlikte izin bekliyor), aşan kısım sıra numarasıyla yedek.
 * Zaten katılımı olan öğrenci atlanır. Yedek listesi dolarsa hiçbiri yazılmaz (409). State'i
 * değiştirir; denetimler yazımdan öncedir.
 */
export function applyPaidActivityBulkJoin(
  state: Pick<State, 'students' | 'classes' | 'invoices'>,
  activity: PaidActivityTerms,
  input: unknown,
  context: {
    today: string
    activeStudentIds: ReadonlySet<string>
    counts: SeatCounts
    makeId: (prefix: string) => string
    institutionType?: InstitutionType
  },
): BulkJoinPlan {
  const studentIds = bulkJoinStudents(state, input, context.institutionType)
  assertJoinOpen(activity, context.today)
  const counts = { ...context.counts }
  const fresh = studentIds.filter((id) => !context.activeStudentIds.has(id))
  const seats = fresh.map((studentId) => ({ studentId, seat: claimSeat(activity, counts) }))
  return {
    joined: seats.map(({ studentId, seat }) =>
      joinPlanFor(state, activity, studentId, seat, context),
    ),
    skippedStudentIds: studentIds.filter((id) => context.activeStudentIds.has(id)),
  }
}

// --- Yedekten asile geçiş ------------------------------------------------------------------------

export interface WaitlistEntry {
  id: string
  studentId: string
  waitlistPosition: number
  consentStatus: ConsentStatus
}

export interface Promotion {
  participantId: string
  studentId: string
  status: 'active' | 'awaiting_consent'
  invoiceId: string | null
}

/**
 * Asile geçecek yedekler (K-369): boş yer kadar, en küçük sıra numarasından. Etkinlik iptal
 * edilmişse ya da günü geçmişse yoktur. Saf seçim; taksit açmaz.
 */
export function promotionCandidates<T extends Pick<WaitlistEntry, 'waitlistPosition'>>(
  activity: Pick<PaidActivityTerms, 'status' | 'activityDate' | 'capacity'>,
  input: { seatCount: number; waitlisted: readonly T[] },
  today: string,
): T[] {
  if (activity.status === 'cancelled' || today > activity.activityDate) return []
  const free = Math.max(0, activity.capacity - input.seatCount)
  return [...input.waitlisted]
    .sort((a, b) => a.waitlistPosition - b.waitlistPosition)
    .slice(0, free)
}

/**
 * Yedekten asile geçiş (K-369, K-370): adaylar asil olur; izin gerekmiyorsa ya da izni alınmışsa
 * taksiti o anda açılır (vade son katılım günü, geçtiyse bugün), izin bekliyorsa "izin bekliyor"
 * olur ve taksit izinle açılır. State'i değiştirir.
 */
export function applyWaitlistPromotions(
  state: Pick<State, 'invoices'>,
  activity: PaidActivityTerms,
  input: { seatCount: number; waitlisted: readonly WaitlistEntry[] },
  context: { today: string; makeId: (prefix: string) => string },
): Promotion[] {
  return promotionCandidates(activity, input, context.today).map((entry) => {
    const awaiting = activity.requiresConsent === true && entry.consentStatus !== 'granted'
    return {
      participantId: entry.id,
      studentId: entry.studentId,
      status: awaiting ? 'awaiting_consent' : 'active',
      invoiceId: awaiting ? null : openActivityInvoice(state, activity, entry.studentId, context),
    }
  })
}

// --- Veli izni -----------------------------------------------------------------------------------

export interface ConsentParticipation {
  studentId: string
  status: ParticipationStatus
  consentStatus: ConsentStatus
}

function assertConsentApplies(
  activity: Pick<PaidActivityTerms, 'status' | 'requiresConsent'>,
  participation: Pick<ConsentParticipation, 'status'>,
): asserts participation is { status: Exclude<ParticipationStatus, 'cancelled'> } {
  if (activity.requiresConsent !== true)
    throw new DomainError('paid_activity_consent_not_required', 'Bu etkinlik veli izni istemiyor.')
  if (activity.status === 'cancelled')
    throw new DomainError('paid_activity_cancelled', 'Etkinlik iptal edilmiş.', {
      kind: 'conflict',
    })
  if (participation.status === 'cancelled')
    throw new DomainError('paid_activity_participation_cancelled', 'Bu katılım iptal edilmiş.', {
      kind: 'conflict',
    })
}

export interface ConsentGrantPlan {
  status: Exclude<ParticipationStatus, 'cancelled'>
  invoiceId: string | null
  channel: ConsentChannel
  grantorName: string | null
}

/**
 * Veli izninin kaydı (K-370): etkinlik izin istemeli, açık olmalı ve günü geçmemiş olmalı; katılım
 * iptal edilmemiş ve izni bekliyor olmalıdır. İzin bekleyen asil asil olur ve taksiti açılır;
 * yedeğin izni kaydedilir, taksiti asile geçince açılır. State'i değiştirir.
 */
export function applyConsentGrant(
  state: Pick<State, 'invoices'>,
  activity: PaidActivityTerms,
  participation: ConsentParticipation,
  grant: { channel: ConsentChannel; grantorName: string | null },
  context: { today: string; makeId: (prefix: string) => string },
): ConsentGrantPlan {
  assertConsentApplies(activity, participation)
  if (participation.consentStatus !== 'pending')
    throw new DomainError(
      'paid_activity_consent_recorded',
      'Bu katılımın veli izni zaten kayıtlı.',
      { kind: 'conflict' },
    )
  if (context.today > activity.activityDate)
    throw new DomainError('paid_activity_consent_closed', 'Etkinlik günü geçti; izin kaydedilmez.')
  return {
    status: participation.status === 'awaiting_consent' ? 'active' : participation.status,
    invoiceId:
      participation.status === 'awaiting_consent'
        ? openActivityInvoice(state, activity, participation.studentId, context)
        : null,
    channel: grant.channel,
    grantorName: grant.grantorName,
  }
}

/** Personelin girdiği izin (kanal ve izni verenin adı). */
export function planManualConsent(input: unknown) {
  return grantConsentSchema.parse(input)
}

/**
 * İznin geri çekilmesi (K-370): etkinlik izin istemeli ve açık olmalı, katılım iptal edilmemiş
 * olmalıdır. Katılım "izin geri çekildi" gerekçesiyle (`consent`) iptal edilir; iade K-302'yle
 * hesaplanır (servis `applyParticipationCancel`).
 */
export function planConsentWithdrawal(
  activity: Pick<PaidActivityTerms, 'status' | 'requiresConsent'>,
  participation: Pick<ConsentParticipation, 'status'>,
  input: unknown,
) {
  const data = input === undefined ? null : withdrawConsentSchema.parse(input)
  assertConsentApplies(activity, participation)
  return { channel: data?.channel ?? ('permission_form' as ConsentChannel) }
}

/** Formda öğrencinin izin durumu; öğrenci formun hedefinde değilse `not_targeted`. */
export type FormConsentStatus = 'pending' | 'approved' | 'rejected' | 'not_targeted'

/**
 * Dijital izin formundan eşitleme planı (K-370; IST-067): formda onaylanan ve izni bekleyen
 * katılımların izni alınır; formda reddedilen katılımlar (izin bekleyen ya da izni formdan gelmiş
 * olan) iptal edilir. Personelin elle girdiği izin formdaki retle düşmez (çelişki listede görünür,
 * H-74). Form kararı düşmüşse (DOM-ILT-032, durum yeniden `pending`) alınmış izin kendiliğinden
 * geri alınmaz.
 */
export function planConsentSync<
  T extends {
    id: string
    studentId: string
    status: ParticipationStatus
    consentStatus: ConsentStatus
    consentChannel: ConsentChannel | null
  },
>(participants: readonly T[], statuses: ReadonlyMap<string, FormConsentStatus>) {
  const live = participants.filter((item) => item.status !== 'cancelled')
  return {
    grant: live.filter(
      (item) => item.consentStatus === 'pending' && statuses.get(item.studentId) === 'approved',
    ),
    withdraw: live.filter(
      (item) =>
        statuses.get(item.studentId) === 'rejected' &&
        (item.consentStatus === 'pending' ||
          (item.consentStatus === 'granted' && item.consentChannel === 'permission_form')),
    ),
  }
}

// --- Katılım listesi -----------------------------------------------------------------------------

export interface RosterRow {
  studentName: string
  className: string | null
  /** Veli telefonu yalnız maskeli (KVKK; `maskPhone`). */
  guardianPhoneMasked: string | null
  status: Exclude<ParticipationStatus, 'cancelled'>
  /** Yedeğin güncel sırası (1'den); asilde `null`. */
  waitlistRank: number | null
  consentStatus: ConsentStatus
  consentChannel: ConsentChannel | null
  paymentStatus: ParticipationPaymentStatus
  amountCents: number
  collectedCents: number
}

const STATUS_ORDER: Record<RosterRow['status'], number> = {
  active: 0,
  awaiting_consent: 0,
  waitlisted: 1,
}

/** Liste sırası: asiller ada göre (tr), sonra yedekler sıralarına göre. */
export function compareRosterRows(a: RosterRow, b: RosterRow): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (a.waitlistRank ?? 0) - (b.waitlistRank ?? 0) ||
    a.studentName.localeCompare(b.studentName, 'tr')
  )
}

/** Satırın katılım metni: "Asil", "İzin bekliyor", "Yedek 2". */
export function rosterStatusText(row: Pick<RosterRow, 'status' | 'waitlistRank'>): string {
  return row.status === 'waitlisted' && row.waitlistRank !== null
    ? `${PARTICIPATION_STATUS_LABELS.waitlisted} ${String(row.waitlistRank)}`
    : PARTICIPATION_STATUS_LABELS[row.status]
}

/** İzin metni: durum ve varsa kanal ("İzin alındı · Kâğıt izin dilekçesi"). */
export function rosterConsentText(row: Pick<RosterRow, 'consentStatus' | 'consentChannel'>) {
  return row.consentStatus === 'granted' && row.consentChannel !== null
    ? `${CONSENT_STATUS_LABELS.granted} · ${CONSENT_CHANNEL_LABELS[row.consentChannel]}`
    : CONSENT_STATUS_LABELS[row.consentStatus]
}

/**
 * Katılım listesi CSV'si (K-371): sıra, öğrenci, sınıf, maskeli veli telefonu, katılım, veli izni,
 * ödeme, tutar ve alınan; `;` ayırıcı, formül kaçışı. Tam telefon, IBAN ve izni verenin adı yazılmaz.
 */
export function paidActivityRosterCsv(rows: readonly RosterRow[]): string {
  const header = [
    'Sıra',
    'Öğrenci',
    'Sınıf',
    'Veli telefonu',
    'Katılım',
    'Veli izni',
    'Ödeme',
    'Tutar',
    'Alınan',
  ]
  const lines = [header.map(csvCell).join(CSV_SEPARATOR)]
  ;[...rows].sort(compareRosterRows).forEach((row, index) => {
    lines.push(
      [
        String(index + 1),
        csvCell(row.studentName),
        csvCell(row.className ?? ''),
        csvCell(row.guardianPhoneMasked ?? ''),
        csvCell(rosterStatusText(row)),
        csvCell(rosterConsentText(row)),
        csvCell(PARTICIPATION_PAYMENT_STATUS_LABELS[row.paymentStatus]),
        csvAmount(row.amountCents),
        csvAmount(row.collectedCents),
      ].join(CSV_SEPARATOR),
    )
  })
  return `${lines.join('\r\n')}\r\n`
}
