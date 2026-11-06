import type { InstitutionType } from '../modules/collection-modules.ts'
import { DomainError } from './errors.ts'
import { money } from './format.ts'

/**
 * Uzaktan (çevrim içi) satışta cayma hakkı (docs/domain/finans.md DOM-FIN-042; IST-078). Çevrim içi
 * paket satışı yoktur (K-07: satışı yönetici ve ön büro yapar): bu dosya kuralı ve ön bilgilendirme
 * verisini tutar, çağıranı yoktur. Kanal açılırsa ekran ve ayrılış hesabına bağlanma o işle yazılır.
 *
 * **Doğrulanmalı (H-17):** çevrim içi kurs ya da paket satışına uygulanması, süre, istisnalar ve
 * ÖÖKY iade kuralıyla ilişki hukukçu cevabını bekler. 14 gün ister listesi §4.3'teki genel cayma
 * süresidir; sürenin sözleşme gününden sayılması temkinli varsayımdır. Cevap gelene kadar etiket
 * kalkmaz, metin kullanıcıya bu uyarıyla gösterilir.
 */

export const SALE_CHANNELS = ['in_person', 'online'] as const
export type SaleChannel = (typeof SALE_CHANNELS)[number]

/** Kuralın ve doğrulama durumunun verisi; süre kodun başka yerine sabitlenmez. */
export const DISTANCE_SALE_RULE = {
  ruleId: 'DOM-FIN-042',
  /** Kaynak: ister listesi §4.3 "Mesafeli kayıt"; **doğrulanmalı**. */
  withdrawalDays: 14,
  verification: {
    status: 'doğrulanmalı',
    questionId: 'H-17',
    note: 'Süre, istisnalar ve ÖÖKY iade kuralıyla ilişki hukukçu doğrulamasını bekliyor (H-17).',
  },
  /** 6502 ve yönetmelik metni doğrulanmadığı için istisna listesi burada yazılmaz. */
  sources: ['6502 sayılı Kanun', 'Mesafeli Sözleşmeler Yönetmeliği'],
} as const

const DAY_MS = 86_400_000

function requireDay(value: string, path: string): number {
  const time = Date.parse(`${value}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw new DomainError('distance_sale_date_invalid', 'Geçerli bir tarih seçin.', {
      path: [path],
    })
  return time
}

/** Kural yalnız dil okulu paketinin tamamen çevrim içi satışına uygulanır (DOM-FIN-042). */
export function isDistanceSale(input: {
  institutionType: InstitutionType
  channel: SaleChannel
}): boolean {
  return input.institutionType === 'language_school' && input.channel === 'online'
}

/** Cayma süresinin son günü (dahil); gün Europe/Istanbul `YYYY-MM-DD` olarak verilir. */
export function distanceSaleLastWithdrawalDate(contractDate: string): string {
  const start = requireDay(contractDate, 'contractDate')
  return new Date(start + DISTANCE_SALE_RULE.withdrawalDays * DAY_MS).toISOString().slice(0, 10)
}

export type DistanceSaleWithdrawal =
  | { applies: false }
  | {
      applies: true
      lastWithdrawalDate: string
      withinPeriod: boolean
      /** Süre içinde ödenenin tamamı; süre dışında `null`, hesap `DOM-FIN-040`'a kalır. */
      refundCents: number | null
      verification: typeof DISTANCE_SALE_RULE.verification
    }

/**
 * Ayrılışın cayma süresine denk gelip gelmediği (DOM-FIN-042): süre içindeki ayrılışta kesinti
 * yapılmaz ve bu hesap `DOM-FIN-040`'tan önce uygulanır. Süre dışında ya da kapsam dışında normal
 * iade hesabı geçerlidir. Sonuç doğrulanma etiketini taşır; saf fonksiyondur, kayıt yazmaz.
 */
export function distanceSaleWithdrawal(input: {
  institutionType: InstitutionType
  channel: SaleChannel
  contractDate: string
  withdrawalDate: string
  paidCents: number
}): DistanceSaleWithdrawal {
  if (!isDistanceSale(input)) return { applies: false }
  if (!Number.isSafeInteger(input.paidCents) || input.paidCents < 0)
    throw new DomainError('distance_sale_amount_invalid', 'Ödenen tutar geçersiz.', {
      path: ['paidCents'],
    })
  const lastWithdrawalDate = distanceSaleLastWithdrawalDate(input.contractDate)
  const withdrawal = requireDay(input.withdrawalDate, 'withdrawalDate')
  if (withdrawal < requireDay(input.contractDate, 'contractDate'))
    throw new DomainError(
      'distance_sale_withdrawal_before_contract',
      'Ayrılış tarihi sözleşme tarihinden önce olamaz.',
      { path: ['withdrawalDate'] },
    )
  const withinPeriod = input.withdrawalDate <= lastWithdrawalDate
  return {
    applies: true,
    lastWithdrawalDate,
    withinPeriod,
    refundCents: withinPeriod ? input.paidCents : null,
    verification: DISTANCE_SALE_RULE.verification,
  }
}

export interface DistanceSalePreInformation {
  title: string
  /** Ekranda ve sözleşmede sırayla gösterilecek satırlar. */
  lines: readonly { label: string; value: string }[]
  /** Kanal açılırsa metnin yanında gösterilir; kaldırılması hukukçu cevabına bağlıdır. */
  verificationNotice: string
  withdrawalDays: number
  lastWithdrawalDate: string
}

/**
 * Çevrim içi satışta ön bilgilendirme ve sözleşmeye yazılacak cayma verisi (DOM-FIN-042, IST-078).
 * Kural dışı satışta `null`. Metin hukuki görüş değildir; hukukçu metni gelene kadar uyarıyla
 * birlikte gösterilir. Kurum bilgisi ve paket adı ekrandan gelir.
 */
export function distanceSalePreInformation(input: {
  institutionType: InstitutionType
  channel: SaleChannel
  packageName: string
  totalCents: number
  contractDate: string
}): DistanceSalePreInformation | null {
  if (!isDistanceSale(input)) return null
  const lastWithdrawalDate = distanceSaleLastWithdrawalDate(input.contractDate)
  const days = String(DISTANCE_SALE_RULE.withdrawalDays)
  return {
    title: 'Çevrim içi satış ön bilgilendirmesi',
    lines: [
      { label: 'Paket', value: input.packageName },
      { label: 'Toplam bedel', value: money(input.totalCents) },
      { label: 'Cayma süresi', value: `Sözleşme gününden itibaren ${days} gün` },
      { label: 'Cayma süresinin son günü', value: lastWithdrawalDate },
      { label: 'Süre içinde ayrılış', value: 'Kesinti yapılmaz.' },
      { label: 'Süre sonrasında ayrılış', value: 'Kurumun ücret iadesi kuralları uygulanır.' },
    ],
    verificationNotice: DISTANCE_SALE_RULE.verification.note,
    withdrawalDays: DISTANCE_SALE_RULE.withdrawalDays,
    lastWithdrawalDate,
  }
}
