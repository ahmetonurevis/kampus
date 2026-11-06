import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { daySchema, requiredText } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import {
  groupOccupancy,
  groupStatus,
  isGroupClosed,
  type GroupMember,
  type LanguageGroup,
  type WaitlistEntry,
} from './language-groups.ts'

/**
 * Kayıt dondurma (docs/domain/dil-okulu.md DOM-DIL-052; kayit-ve-crm.md DOM-KAY-024, -026; IST-084).
 * Yalnız `language_school` kurumunda bulunur. Kursiyer (18 yaş altında veli) ya da personel talep
 * açar, yönetici gerekçeyle onaylar veya reddeder. Dondurma ayrılış değildir: öğrenci aktif kalır,
 * kayıt durumu `frozen` olur (`enrollment-status.ts`), grup üyeliği `frozen`'a geçer ve kapasitede yer
 * tutmaz (`groupOccupancy`).
 *
 * - Başlangıç kur sınırındadır; kur ortası (`isMidCourse`) yalnız belge bilgisiyle olur. Belgenin
 *   kendisi saklanmaz: alındı beyanı ve kısa tanımı tutulur.
 * - Etki başlangıç gününde doğar (`applyFreezeStart`): ileri tarihli onay günlük işle başlar.
 * - Dönüş tarihi plandır; kursiyer kendiliğinden dönmez, çünkü aynı grup garanti edilmez. Süre dolunca
 *   personel dönüşü işler ya da ayrılış açar (aşama `overdue`).
 * - Taksit planına bu modül dokunmaz: erteleme var olan ek protokolle yapılır ve kursiyere/veliye
 *   onaylatılır (`lib/contract-approval.ts` `amendContract`). MEBBİS'e etkisi **doğrulanmalı** (H-24);
 *   bu modül MEBBİS kaydına dair hiçbir şey yazmaz.
 *
 * Fonksiyonlar saftır, `now`/`today` dışarıdan gelir; kimlik üretimi ve yazma servistedir.
 */

z.config(z.locales.tr())

export const FREEZE_REASONS = [
  'health',
  'military',
  'relocation',
  'work_school_schedule',
  'other',
] as const
export type FreezeReason = (typeof FREEZE_REASONS)[number]
export const FREEZE_REASON_LABELS: Readonly<Record<FreezeReason, string>> = {
  health: 'Sağlık',
  military: 'Askerlik',
  relocation: 'Taşınma',
  work_school_schedule: 'İş veya okul takvimi',
  other: 'Diğer',
}

/** Saklanan durum. `cancelled` yalnız ayrılışla kapanan, karara bağlanmamış taleptir. */
export const FREEZE_STATUSES = ['requested', 'approved', 'rejected', 'ended', 'cancelled'] as const
export type FreezeStatus = (typeof FREEZE_STATUSES)[number]

/** Görünen aşama: `scheduled`, `frozen` ve `overdue` onaylı talebin tarihlerinden türetilir. */
export const FREEZE_PHASES = [
  'requested',
  'scheduled',
  'frozen',
  'overdue',
  'rejected',
  'ended',
  'cancelled',
] as const
export type FreezePhase = (typeof FREEZE_PHASES)[number]
export const FREEZE_PHASE_LABELS: Readonly<Record<FreezePhase, string>> = {
  requested: 'Onay bekliyor',
  scheduled: 'Başlaması bekleniyor',
  frozen: 'Dondurulmuş',
  overdue: 'Dönüş tarihi geçti',
  rejected: 'Reddedildi',
  ended: 'Sona erdi',
  cancelled: 'İptal edildi',
}

/**
 * Bir kayıtta toplam dondurma üst sınırı (DOM-DIL-052 "6 ay"). Parçalı dondurmalar toplanır, takvim
 * ayı toplanamaz: sınır gün sayısına çevrilir (yılın yarısı).
 */
export const FREEZE_TOTAL_MAX_DAYS = 183
/** Bu süreyi aşan dondurmada dönüşte seviye tespiti yenilenir (DOM-DIL-012, -052). */
export const FREEZE_PLACEMENT_RENEWAL_DAYS = 90
export const FREEZE_NOTE_MAX = 500
export const FREEZE_DOCUMENT_NOTE_MAX = 200

const note = requiredText.max(FREEZE_NOTE_MAX)
const documentNote = z.string().trim().max(FREEZE_DOCUMENT_NOTE_MAX)

export const requestFreezeSchema = z.strictObject({
  studentId: z.string().trim().min(1, 'Kursiyeri seçin.').max(200),
  reason: z.enum(FREEZE_REASONS, 'Dondurma nedenini seçin.'),
  // kvkk: Ç
  reasonNote: note,
  startDate: daySchema,
  returnDate: daySchema,
  /** Kur ortası dondurmada belge alındı beyanı; dosya içeriği alınmaz (DOM-DIL-052). */
  documentReceived: z.boolean().default(false),
  // kvkk: Ç
  documentNote: documentNote.nullable().default(null),
})
export type RequestFreezeInput = z.input<typeof requestFreezeSchema>

export const decideFreezeSchema = z.strictObject({
  // kvkk: Ç
  note,
})
export type DecideFreezeInput = z.input<typeof decideFreezeSchema>

/** Talep formu (web): belge tanımı boş metin olabilir. */
export const freezeFormSchema = z.object({
  studentId: z.string().trim().min(1, 'Kursiyeri seçin.'),
  reason: z.enum(FREEZE_REASONS, 'Dondurma nedenini seçin.'),
  reasonNote: note,
  startDate: daySchema,
  returnDate: daySchema,
  documentReceived: z.boolean(),
  documentNote,
})
export type FreezeFormValues = z.output<typeof freezeFormSchema>

/** Kuralın okuduğu dondurma satırı (`enrollment_freezes`). */
export type FreezeFacts = {
  id: string
  status: FreezeStatus
  startDate: string
  returnDate: string
  endedDate: string | null
  /** Etkinin doğduğu an; `null` ise başlamadı. */
  startedAt: string | null
}

type CourseDates = Pick<LanguageGroup, 'state' | 'startDate' | 'endDate'>

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS

/** İki gün arasındaki gün sayısı; başlangıç dahil, bitiş hariç. */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

const isOpen = (freeze: Pick<FreezeFacts, 'status'>) =>
  freeze.status === 'requested' || freeze.status === 'approved'

/** Dondurma yalnız dil okulundadır (DOM-DIL-052); başka kurum türünde kural yok, uç 404 döner. */
export const freezesAvailableFor = (type: InstitutionType) => type === 'language_school'

export function freezePhase(
  freeze: Pick<FreezeFacts, 'status' | 'returnDate' | 'startedAt'>,
  today: string,
): FreezePhase {
  if (freeze.status !== 'approved') return freeze.status
  if (freeze.startedAt === null) return 'scheduled'
  return today >= freeze.returnDate ? 'overdue' : 'frozen'
}

/**
 * Kullanılmış ya da planlanmış dondurma günleri. Onaylı talep planlanan süreyle, biten talep gerçek
 * süreyle sayılır; hiç başlamadan biten ve reddedilen sayılmaz.
 */
export function frozenDaysUsed(freezes: readonly FreezeFacts[], excludeId?: string): number {
  return freezes.reduce((sum, freeze) => {
    if (freeze.id === excludeId) return sum
    if (freeze.status === 'approved') return sum + daysBetween(freeze.startDate, freeze.returnDate)
    if (freeze.status === 'ended' && freeze.startedAt !== null && freeze.endedDate !== null)
      return sum + Math.max(0, daysBetween(freeze.startDate, freeze.endedDate))
    return sum
  }, 0)
}

/** Kur ortası: gün grubun başlangıcıyla bitişinin arasındadır (iki uç kur sınırıdır). */
export function isMidCourse(startDate: string, groups: readonly CourseDates[]): boolean {
  return groups.some(
    (group) =>
      group.state !== 'cancelled' && group.startDate < startDate && startDate < group.endDate,
  )
}

/**
 * Talebi kim açabilir (DOM-DIL-052): 18 yaş altında veli, üstünde kursiyerin kendisi; personel her
 * ikisinde. Öğrenci ve velinin kayıt kapsamı `requireAuthorized`'dadır.
 */
export function assertFreezeRequester(role: Role, minor: boolean): void {
  if (role === 'ogrenci' && minor)
    throw new DomainError(
      'freeze_guardian_required',
      '18 yaş altındaki kursiyerin dondurma talebini velisi açar.',
      { kind: 'forbidden' },
    )
  if (role === 'veli' && !minor)
    throw new DomainError(
      'freeze_learner_required',
      '18 yaşını dolduran kursiyer dondurma talebini kendisi açar.',
      { kind: 'forbidden' },
    )
}

type FreezeTerms = {
  startDate: string
  returnDate: string
  documentReceived: boolean
}

/** Talep ve onayda aynı koşullar: güncel veriyle yeniden denetlenir. */
function assertTerms(
  terms: FreezeTerms,
  context: {
    freezes: readonly FreezeFacts[]
    groups: readonly CourseDates[]
    today: string
    excludeId?: string
  },
): { midCourse: boolean } {
  if (terms.startDate < context.today)
    throw new DomainError('freeze_start_past', 'Dondurma başlangıcı geçmiş bir gün olamaz.', {
      path: ['startDate'],
    })
  if (terms.returnDate <= terms.startDate)
    throw new DomainError(
      'freeze_return_before_start',
      'Dönüş tarihi başlangıçtan sonra olmalıdır.',
      { path: ['returnDate'] },
    )
  const used = frozenDaysUsed(context.freezes, context.excludeId)
  if (used + daysBetween(terms.startDate, terms.returnDate) > FREEZE_TOTAL_MAX_DAYS)
    throw new DomainError(
      'freeze_limit_exceeded',
      'Bir kayıtta toplam dondurma 6 ayı geçemez; kursiyer döner ya da ayrılış işlemi açılır.',
      { path: ['returnDate'] },
    )
  const midCourse = isMidCourse(terms.startDate, context.groups)
  if (midCourse && !terms.documentReceived)
    throw new DomainError(
      'freeze_document_required',
      'Kur ortasında dondurma yalnız belgeli nedenle olur; belgenin alındığını belirtin.',
      { path: ['documentReceived'] },
    )
  return { midCourse }
}

function assertLearnerActive(student: { isActive?: boolean } | undefined) {
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError(
      'freeze_student_inactive',
      'Ayrılmış ya da mezun kursiyerin kaydı dondurulamaz.',
      { kind: 'conflict' },
    )
}

/** Dondurma talebi: kursiyerin açık kaydı varsa ikincisi açılmaz (mükerrer işlem). */
export function planFreezeRequest(context: {
  input: unknown
  student: { isActive?: boolean } | undefined
  freezes: readonly FreezeFacts[]
  groups: readonly CourseDates[]
  today: string
}): z.output<typeof requestFreezeSchema> & { midCourse: boolean } {
  const data = requestFreezeSchema.parse(context.input)
  assertLearnerActive(context.student)
  if (context.freezes.some(isOpen))
    throw new DomainError('enrollment_freeze_open', 'Bu kursiyerin açık bir dondurma kaydı var.', {
      kind: 'conflict',
    })
  const { midCourse } = assertTerms(data, context)
  return { ...data, documentNote: data.documentNote || null, midCourse }
}

function assertRequested(freeze: Pick<FreezeFacts, 'status'>) {
  if (freeze.status !== 'requested')
    throw new DomainError('enrollment_freeze_decided', 'Bu talep zaten karara bağlanmış.', {
      kind: 'conflict',
    })
}

/**
 * Onay: koşullar onay anındaki veriyle yeniden denetlenir (talepten sonra grup başlamış olabilir).
 * Başlangıç günü geldiyse `startsNow` döner; ileri tarihli onay günlük işle başlar.
 */
export function planFreezeApproval(context: {
  freeze: FreezeFacts & { documentReceived: boolean }
  input: unknown
  student: { isActive?: boolean } | undefined
  freezes: readonly FreezeFacts[]
  groups: readonly CourseDates[]
  today: string
}): { note: string; midCourse: boolean; startsNow: boolean } {
  const { note: decisionNote } = decideFreezeSchema.parse(context.input)
  assertRequested(context.freeze)
  assertLearnerActive(context.student)
  const { midCourse } = assertTerms(context.freeze, {
    freezes: context.freezes,
    groups: context.groups,
    today: context.today,
    excludeId: context.freeze.id,
  })
  return { note: decisionNote, midCourse, startsNow: context.freeze.startDate <= context.today }
}

export function planFreezeRejection(context: {
  freeze: Pick<FreezeFacts, 'status'>
  input: unknown
}): { note: string } {
  const { note: decisionNote } = decideFreezeSchema.parse(context.input)
  assertRequested(context.freeze)
  return { note: decisionNote }
}

/** Etki doğarken dondurulacak gruplar: kapanmamış grubun aktif üyelikleri. */
export function groupsToFreeze(
  members: readonly Pick<GroupMember, 'groupId' | 'status'>[],
  groups: readonly (CourseDates & Pick<LanguageGroup, 'id'>)[],
  now: string,
): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  return members
    .filter((member) => {
      const group = byId.get(member.groupId)
      return (
        member.status === 'active' && group !== undefined && !isGroupClosed(groupStatus(group, now))
      )
    })
    .map((member) => member.groupId)
}

function freezeStudent(state: Pick<State, 'students'>, studentId: string) {
  const student = state.students.find((item) => item.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  return student
}

/** Kayıt durumunu `frozen` yapan bayrağı yazar (DOM-KAY-026); `isActive` değişmez. */
export function applyFreezeStart(
  state: Pick<State, 'students'>,
  studentId: string,
  now: string,
): void {
  freezeStudent(state, studentId).frozenAt = now
}

/** Dönüşte bayrağı kaldırır; kursiyer yeniden aktif sayılır. */
export function clearFreezeFlag(state: Pick<State, 'students'>, studentId: string): void {
  const student = freezeStudent(state, studentId)
  if (student.frozenAt) student.frozenAt = null
}

/** Dönüşte seviye tespiti yenilenir mi: 90 günü aşan dondurma (DOM-DIL-012, -052). */
export function placementRenewalRequired(
  freeze: Pick<FreezeFacts, 'startDate' | 'startedAt' | 'endedDate'>,
): boolean {
  return (
    freeze.startedAt !== null &&
    freeze.endedDate !== null &&
    daysBetween(freeze.startDate, freeze.endedDate) > FREEZE_PLACEMENT_RENEWAL_DAYS
  )
}

/**
 * Dönüş (DOM-DIL-052): aynı grup garanti edilmez. Yalnız henüz başlamamış ve boş yeri olan gruptaki
 * üyelik geri açılır; başlamış, kapanmış ya da dolu grupta üyelik kapanır ve kursiyer yeniden
 * yerleştirilir (`planGroupPlacement`). Hiç başlamadan biten dondurmada üyelik değişmemiştir.
 */
export function planFreezeReturn(context: {
  freeze: FreezeFacts
  learnerGroupIds: readonly string[]
  groups: readonly LanguageGroup[]
  members: readonly GroupMember[]
  waitlist: readonly WaitlistEntry[]
  now: string
}): {
  endedDate: string
  started: boolean
  restoreGroupIds: string[]
  releaseGroupIds: string[]
  needsPlacement: boolean
} {
  const { freeze, now } = context
  if (freeze.status !== 'approved')
    throw new DomainError('enrollment_freeze_not_active', 'Bu dondurma etkin değil.', {
      kind: 'conflict',
    })
  const started = freeze.startedAt !== null
  const restoreGroupIds: string[] = []
  const releaseGroupIds: string[] = []
  const byId = new Map(context.groups.map((group) => [group.id, group]))
  for (const groupId of started ? context.learnerGroupIds : []) {
    const group = byId.get(groupId)
    const status = group === undefined ? 'cancelled' : groupStatus(group, now)
    const seat =
      group !== undefined &&
      (status === 'planned' || status === 'open') &&
      groupOccupancy(group, context.members, context.waitlist, now).free > 0
    if (seat) restoreGroupIds.push(groupId)
    else releaseGroupIds.push(groupId)
  }
  return {
    endedDate: dayKey(now),
    started,
    restoreGroupIds,
    releaseGroupIds,
    needsPlacement: releaseGroupIds.length > 0,
  }
}

/**
 * Dondurma aralığında vadesi gelen açık taksit sayısı. Yalnız bilgidir: plan burada değişmez, erteleme
 * ek protokolle yapılır (DOM-DIL-052; `lib/contract-approval.ts` `amendContract`).
 */
export function openInstallmentsDuring(
  invoices: readonly { id: string; amount: number; dueDate: string; paidAt?: string | null }[],
  allocated: ReadonlyMap<string, number>,
  freeze: Pick<FreezeFacts, 'startDate' | 'returnDate'>,
): number {
  return invoices.filter((invoice) => {
    const paid = invoice.paidAt ? invoice.amount : (allocated.get(invoice.id) ?? 0)
    const due = dayKey(invoice.dueDate)
    return paid < invoice.amount && due >= freeze.startDate && due < freeze.returnDate
  }).length
}
