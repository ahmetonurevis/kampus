import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Burs fonu (docs/domain/finans.md DOM-FIN-068; ON-259, K26). Bağış kaynaklı fon kaydı, fona bağış
 * girişi ve fondan burs ataması. Fondan atama yeni burs vermez: kesin kayıtta ya da yenilemede
 * yapılmış burs atamasının (DOM-FIN-025) fondan karşılanan kısmını işaretler; sözleşme ve taksit
 * değişmez. Bakiye geçerli bağışlar eksi geçerli atamalardır ve eksiye düşmez. Silme yoktur:
 * bağış ve atama gerekçeyle iptal edilir, fon sıfır bakiyede kapanır (K-95…K-99). Bağış makbuzu,
 * vergi indirimi ve muhasebe kaydı varsayılmaz (M-21, M-22, H-26). Fonksiyonlar saftır.
 */

/** Fonu ve raporu yönetici ile ön büro görür (K-98). */
export const SCHOLARSHIP_FUND_READ_ROLES = ['yonetici', 'onburo'] as const
/** Raporda öğrenci adı yalnız yöneticiye döner; muhasebe rolü açılınca o da eklenir (K-98). */
export const SCHOLARSHIP_FUND_NAME_ROLES = ['yonetici'] as const

export const SCHOLARSHIP_FUND_NAME_MAX = 120
export const SCHOLARSHIP_FUND_DESCRIPTION_MAX = 1000
export const SCHOLARSHIP_FUND_DONOR_MAX = 200
export const SCHOLARSHIP_FUND_NOTE_MAX = 200
export const SCHOLARSHIP_FUND_REASON_MAX = 500
/** Tek bağış ya da atama en çok 100 milyon TL (kuruş). */
export const SCHOLARSHIP_FUND_AMOUNT_MAX = 100_000_000_00

export const SCHOLARSHIP_FUND_DONOR_KINDS = ['person', 'organization', 'anonymous'] as const
export type ScholarshipFundDonorKind = (typeof SCHOLARSHIP_FUND_DONOR_KINDS)[number]
export const SCHOLARSHIP_FUND_DONOR_KIND_LABELS: Record<ScholarshipFundDonorKind, string> = {
  person: 'Kişi',
  organization: 'Kurum',
  anonymous: 'Anonim',
}

/** Bağışın geldiği kanal; makbuz ya da banka hesabı eşleşmesi yoktur (M-21). */
export const SCHOLARSHIP_FUND_CHANNELS = ['bank_transfer', 'cash', 'other'] as const
export type ScholarshipFundChannel = (typeof SCHOLARSHIP_FUND_CHANNELS)[number]
export const SCHOLARSHIP_FUND_CHANNEL_LABELS: Record<ScholarshipFundChannel, string> = {
  bank_transfer: 'Banka havalesi / EFT',
  cash: 'Nakit',
  other: 'Diğer',
}

export const SCHOLARSHIP_FUND_STATUSES = ['active', 'closed'] as const
export type ScholarshipFundStatus = (typeof SCHOLARSHIP_FUND_STATUSES)[number]
export const SCHOLARSHIP_FUND_STATUS_LABELS: Record<ScholarshipFundStatus, string> = {
  active: 'Açık',
  closed: 'Kapalı',
}

export const SCHOLARSHIP_FUND_MOVEMENT_LABELS = { donation: 'Bağış', allocation: 'Burs ataması' }

// --- Şemalar -------------------------------------------------------------------------------------

const text = (required: string, min: number, max: number) =>
  z
    .string(required)
    .trim()
    .min(min, min <= 2 ? 'En az 2 karakter girin.' : `En az ${String(min)} karakter girin.`)
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value))
const amountSchema = z
  .number('Tutarı girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(1, 'Tutar sıfırdan büyük olmalıdır.')
  .max(SCHOLARSHIP_FUND_AMOUNT_MAX, 'Tutar çok büyük.')

/**
 * Fon kaydı. Bağışçı en az veriyle tutulur (K-95): kişi ya da kurum adı; anonim bağışta ad
 * saklanmaz. İletişim ve kimlik numarası alınmaz.
 */
export const createScholarshipFundSchema = z
  .strictObject({
    name: text('Fon adını yazın.', 2, SCHOLARSHIP_FUND_NAME_MAX),
    description: optionalText(SCHOLARSHIP_FUND_DESCRIPTION_MAX),
    donorKind: z.enum(SCHOLARSHIP_FUND_DONOR_KINDS, 'Bağışçı türünü seçin.'),
    donorName: optionalText(SCHOLARSHIP_FUND_DONOR_MAX),
  })
  .superRefine((data, context) => {
    if (data.donorKind === 'anonymous' && data.donorName !== undefined)
      context.addIssue({
        code: 'custom',
        message: 'Anonim bağışta bağışçı adı yazılmaz.',
        path: ['donorName'],
      })
    if (data.donorKind !== 'anonymous' && (data.donorName ?? '').length < 2)
      context.addIssue({
        code: 'custom',
        message: 'Bağışçının adını ya da kurum adını yazın.',
        path: ['donorName'],
      })
  })
export type CreateScholarshipFundInput = z.input<typeof createScholarshipFundSchema>

export const scholarshipFundDonationSchema = z.strictObject({
  amountCents: amountSchema,
  donatedOn: daySchema,
  channel: z.enum(SCHOLARSHIP_FUND_CHANNELS, 'Bağışın kaynağını seçin.'),
  note: optionalText(SCHOLARSHIP_FUND_NOTE_MAX),
})
export type ScholarshipFundDonationInput = z.input<typeof scholarshipFundDonationSchema>

export const scholarshipFundAllocationSchema = z.strictObject({
  awardId: z.uuid('Burs atamasını seçin.'),
  amountCents: amountSchema,
})
export type ScholarshipFundAllocationInput = z.input<typeof scholarshipFundAllocationSchema>

export const scholarshipFundCancelSchema = z.strictObject({
  reason: text('İptal gerekçesini yazın.', 5, SCHOLARSHIP_FUND_REASON_MAX),
})
export type ScholarshipFundCancelInput = z.input<typeof scholarshipFundCancelSchema>

// --- Kurallar ------------------------------------------------------------------------------------

export interface ScholarshipFundState {
  closedAt: string | null
}

/** Aynı adla iki açık fon olmaz; karşılaştırma Türkçe küçük harfle. */
export function planScholarshipFundCreate(input: unknown, openNames: readonly string[]) {
  const data = createScholarshipFundSchema.parse(input)
  const key = data.name.toLocaleLowerCase('tr')
  if (openNames.some((name) => name.toLocaleLowerCase('tr') === key))
    throw new DomainError('scholarship_fund_exists', 'Bu adla açık bir burs fonu var.', {
      kind: 'conflict',
      path: ['name'],
    })
  return {
    name: data.name,
    description: data.description ?? null,
    donorKind: data.donorKind,
    donorName: data.donorKind === 'anonymous' ? null : (data.donorName ?? null),
  }
}

function requireOpen(fund: ScholarshipFundState) {
  if (fund.closedAt !== null)
    throw new DomainError('scholarship_fund_closed', 'Kapalı burs fonuna işlem yapılamaz.')
}

/** Bağış girişi: açık fon, geçmiş ya da bugünkü gün. */
export function planScholarshipFundDonation(
  fund: ScholarshipFundState,
  input: unknown,
  today: string,
) {
  const data = scholarshipFundDonationSchema.parse(input)
  requireOpen(fund)
  if (data.donatedOn > today)
    throw new DomainError('scholarship_fund_date_future', 'Gelecek bir tarih girilemez.', {
      path: ['donatedOn'],
    })
  return { ...data, note: data.note ?? null }
}

/** Fondan karşılanacak burs ataması (DOM-FIN-025 kaydı); servis kurum kilidi altında yükler. */
export interface FundableAward {
  id: string
  studentId: string
  academicYear: number
  amountCents: number
}

/**
 * Fondan burs ataması (K-96): atama, burs atamasının henüz hiçbir fondan karşılanmamış kısmını ve
 * fonun bakiyesini aşamaz; aynı fondan aynı bursa ikinci geçerli atama yapılmaz. `coveredCents`
 * bursun bütün fonlardaki geçerli atamaları, `balanceCents` fonun bugünkü bakiyesidir.
 */
export function planScholarshipFundAllocation(
  fund: ScholarshipFundState,
  award: FundableAward | null,
  context: { balanceCents: number; coveredCents: number; alreadyFromFund: boolean },
  input: unknown,
) {
  const data = scholarshipFundAllocationSchema.parse(input)
  requireOpen(fund)
  if (award === null)
    throw new DomainError('scholarship_award_not_found', 'Burs ataması bulunamadı.', {
      kind: 'not_found',
      path: ['awardId'],
    })
  if (context.alreadyFromFund)
    throw new DomainError(
      'scholarship_fund_allocation_exists',
      'Bu burs bu fondan zaten karşılanıyor; önce mevcut atamayı iptal edin.',
      { kind: 'conflict', path: ['awardId'] },
    )
  const uncovered = award.amountCents - context.coveredCents
  if (data.amountCents > uncovered)
    throw new DomainError(
      'scholarship_fund_exceeds_award',
      'Tutar bursun fonlardan karşılanmamış kısmını aşıyor.',
      { path: ['amountCents'] },
    )
  if (data.amountCents > context.balanceCents)
    throw new DomainError('scholarship_fund_insufficient', 'Fon bakiyesi yetersiz.', {
      path: ['amountCents'],
    })
  return {
    awardId: award.id,
    studentId: award.studentId,
    academicYear: award.academicYear,
    amountCents: data.amountCents,
  }
}

/**
 * Atama iptali bakiyeyi geri verir; iptal edilmiş atama yeniden iptal edilmez. Kapalı fonda atama
 * iptal edilmez: kapanış sıfır bakiyeyle kesinleşmiştir, iptal kapalı fona bakiye açardı (K-97).
 */
export function planScholarshipFundAllocationCancel(
  fund: ScholarshipFundState,
  allocation: { cancelledAt: string | null },
  input: unknown,
) {
  const data = scholarshipFundCancelSchema.parse(input)
  requireOpen(fund)
  if (allocation.cancelledAt !== null)
    throw new DomainError('scholarship_fund_allocation_cancelled', 'Bu atama zaten iptal edildi.', {
      kind: 'conflict',
    })
  return data
}

/** Burs ataması kendiliğinden değişince fondan karşılanan payın sistem gerekçesi (K-117). */
export const SCHOLARSHIP_FUND_RELEASE_REASONS = {
  renewal_cancelled:
    'Burs ataması arşivlendi: öğrenci ayrıldı, burslu yenileme iptal edildi (sistem).',
} as const
export type ScholarshipFundReleaseCause = keyof typeof SCHOLARSHIP_FUND_RELEASE_REASONS

/** Bursun bir fondaki ataması; `fundClosedAt` atamanın fonunun kapanış anıdır. */
export interface ReleasableFundAllocation {
  id: string
  amountCents: number
  allocatedOn: string
  createdAt: string
  cancelledAt: string | null
  fundClosedAt: string | null
}

/**
 * Burs ataması arşivlenince ya da tutarı düşünce fondan karşılanan payın hangi atamalarla bırakılacağı
 * (K-117…K-119). Geçerli atamaların toplamı `keepCents`'i (arşivde 0, azaltmada yeni burs tutarı)
 * aşmayana dek en yeni atamadan başlayarak iptal edilir; atama bölünmez, açılan pay elle yeniden
 * atanır. Kapalı fondaki atama iptal edilmez: kapanış sıfır bakiyeyle kesinleşmiştir (K-97, K-118);
 * toplama yine girer. Dönen atamalar iptal sırasıdır.
 */
export function planAwardFundRelease<T extends ReleasableFundAllocation>(
  allocations: readonly T[],
  keepCents: number,
): T[] {
  const live = allocations.filter((row) => row.cancelledAt === null)
  let covered = live.reduce((total, row) => total + row.amountCents, 0)
  const newestFirst = live
    .filter((row) => row.fundClosedAt === null)
    .map((row) => ({ row, key: `${row.allocatedOn}|${row.createdAt}|${row.id}` }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  const released: T[] = []
  for (const { row } of newestFirst) {
    if (covered <= Math.max(0, keepCents)) break
    released.push(row)
    covered -= row.amountCents
  }
  return released
}

/** Bağış iptali bakiyeyi eksiye düşürecekse reddedilir; önce atama iptal edilir (K-97). */
export function planScholarshipFundDonationCancel(
  donation: { cancelledAt: string | null; amountCents: number },
  balanceCents: number,
  input: unknown,
) {
  const data = scholarshipFundCancelSchema.parse(input)
  if (donation.cancelledAt !== null)
    throw new DomainError('scholarship_fund_donation_cancelled', 'Bu bağış zaten iptal edildi.', {
      kind: 'conflict',
    })
  if (balanceCents - donation.amountCents < 0)
    throw new DomainError(
      'scholarship_fund_donation_in_use',
      'Bağış burs atamalarında kullanılıyor; önce atamaları iptal edin.',
    )
  return data
}

/** Fon yalnız sıfır bakiyede kapanır; kapalı fona bağış ve atama yapılmaz (K-97). */
export function planScholarshipFundClose(fund: ScholarshipFundState, balanceCents: number) {
  if (fund.closedAt !== null)
    throw new DomainError('scholarship_fund_already_closed', 'Bu fon zaten kapalı.', {
      kind: 'conflict',
    })
  if (balanceCents !== 0)
    throw new DomainError(
      'scholarship_fund_balance_not_zero',
      'Bakiyesi olan fon kapatılamaz; önce bakiyeyi atayın ya da bağışı iptal edin.',
    )
}

// --- Bakiye ve rapor -----------------------------------------------------------------------------

export interface FundMovementAmount {
  amountCents: number
  cancelledAt: string | null
}

const sumActive = (rows: readonly FundMovementAmount[]) =>
  rows.reduce((total, row) => (row.cancelledAt === null ? total + row.amountCents : total), 0)

export interface ScholarshipFundTotals {
  donatedCents: number
  allocatedCents: number
  balanceCents: number
  donationCount: number
  allocationCount: number
}

/** Bakiye = geçerli bağışlar − geçerli atamalar; iptal edilen hareket sayılmaz. */
export function scholarshipFundTotals(
  donations: readonly FundMovementAmount[],
  allocations: readonly FundMovementAmount[],
): ScholarshipFundTotals {
  const donatedCents = sumActive(donations)
  const allocatedCents = sumActive(allocations)
  return {
    donatedCents,
    allocatedCents,
    balanceCents: donatedCents - allocatedCents,
    donationCount: donations.filter((row) => row.cancelledAt === null).length,
    allocationCount: allocations.filter((row) => row.cancelledAt === null).length,
  }
}

export interface StoredFundDonation extends FundMovementAmount {
  id: string
  donatedOn: string
  channel: ScholarshipFundChannel
  note: string | null
  createdAt: string
  cancelReason: string | null
  version: number
}

export interface StoredFundAllocation extends FundMovementAmount {
  id: string
  awardId: string
  studentId: string
  academicYear: number
  allocatedOn: string
  createdAt: string
  cancelReason: string | null
  version: number
}

export type ScholarshipFundMovement = {
  id: string
  kind: 'donation' | 'allocation'
  day: string
  amountCents: number
  /** Bakiyeye etkisi: geçerli bağış artı, geçerli atama eksi, iptal edilen sıfır. */
  effectCents: number
  /** Gün sırasıyla geçerli hareketlerden sonraki bakiye; iptal edilen satırda önceki bakiye. */
  balanceAfterCents: number
  channel: ScholarshipFundChannel | null
  note: string | null
  awardId: string | null
  studentId: string | null
  studentName: string | null
  academicYear: number | null
  cancelledAt: string | null
  cancelReason: string | null
  version: number
}

/**
 * Hareket dökümü: bağış ve atamalar gün, sonra giriş anı sırasıyla. `names` yalnız yetkili rolde
 * doludur; yoksa atama satırında öğrenci adı, öğrenci ve burs kimliği ve iptal gerekçesi boştur
 * (K-98). Bağış satırının notu ve gerekçesi öğrenciye bağlı olmadığı için kalır.
 */
export function scholarshipFundMovements(
  donations: readonly StoredFundDonation[],
  allocations: readonly StoredFundAllocation[],
  names: ReadonlyMap<string, string | null> | null,
): ScholarshipFundMovement[] {
  const rows = [
    ...donations.map((row) => ({
      sortKey: `${row.donatedOn}|${row.createdAt}|0|${row.id}`,
      movement: {
        id: row.id,
        kind: 'donation' as const,
        day: row.donatedOn,
        amountCents: row.amountCents,
        effectCents: row.cancelledAt === null ? row.amountCents : 0,
        balanceAfterCents: 0,
        channel: row.channel,
        note: row.note,
        awardId: null,
        studentId: null,
        studentName: null,
        academicYear: null,
        cancelledAt: row.cancelledAt,
        cancelReason: row.cancelReason,
        version: row.version,
      },
    })),
    ...allocations.map((row) => ({
      sortKey: `${row.allocatedOn}|${row.createdAt}|1|${row.id}`,
      movement: {
        id: row.id,
        kind: 'allocation' as const,
        day: row.allocatedOn,
        amountCents: row.amountCents,
        effectCents: row.cancelledAt === null ? -row.amountCents : 0,
        balanceAfterCents: 0,
        channel: null,
        note: null,
        // Ad gizlenen rolde öğrenciyi tanıtan her alan boştur: kimlik öğrenci listesinden, gerekçe
        // serbest metinden adı açardı (K-98).
        awardId: names === null ? null : row.awardId,
        studentId: names === null ? null : row.studentId,
        studentName: names === null ? null : (names.get(row.studentId) ?? null),
        academicYear: row.academicYear,
        cancelledAt: row.cancelledAt,
        cancelReason: names === null ? null : row.cancelReason,
        version: row.version,
      },
    })),
  ].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
  let balance = 0
  return rows.map(({ movement }) => {
    balance += movement.effectCents
    return { ...movement, balanceAfterCents: balance }
  })
}

const MOVEMENT_COLUMNS = [
  'Fon',
  'Tarih',
  'Hareket',
  'Durum',
  'Kaynak / öğrenci',
  'Eğitim yılı',
  'Tutar',
  'Bakiye',
]

const movementSource = (row: ScholarshipFundMovement) =>
  row.kind === 'donation'
    ? [row.channel === null ? '' : SCHOLARSHIP_FUND_CHANNEL_LABELS[row.channel], row.note]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
    : (row.studentName ?? '')

/** Fon raporu CSV'si: hareketler ve son satırlarda toplamlar (`;`, ondalık virgül, formül kaçışı). */
export function scholarshipFundCsv(
  fund: { name: string },
  totals: ScholarshipFundTotals,
  movements: readonly ScholarshipFundMovement[],
): string {
  const rows = movements.map((row) => [
    csvCell(fund.name),
    csvCell(row.day),
    csvCell(SCHOLARSHIP_FUND_MOVEMENT_LABELS[row.kind]),
    csvCell(row.cancelledAt === null ? 'Geçerli' : 'İptal edildi'),
    csvCell(movementSource(row)),
    csvCell(row.academicYear ?? ''),
    csvAmount(row.kind === 'donation' ? row.amountCents : -row.amountCents),
    csvAmount(row.balanceAfterCents),
  ])
  const total = (label: string, cents: number) => [
    csvCell(fund.name),
    csvCell(''),
    csvCell(label),
    csvCell(''),
    csvCell(''),
    csvCell(''),
    csvAmount(cents),
    csvCell(''),
  ]
  return [
    MOVEMENT_COLUMNS.map(csvCell),
    ...rows,
    total('Toplam bağış', totals.donatedCents),
    total('Toplam atama', -totals.allocatedCents),
    total('Bakiye', totals.balanceCents),
  ]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}
