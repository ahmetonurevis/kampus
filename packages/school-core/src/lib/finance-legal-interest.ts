import { DomainError } from './errors.ts'

/**
 * Kanuni faiz (3095 sayılı Kanuni Faiz ve Temerrüt Faizine İlişkin Kanun md. 1). Oran Cumhurbaşkanı
 * (önceden Bakanlar Kurulu) kararıyla değişir; tablo yürürlük günüyle tutulur, geçmiş dönem oranı
 * değişmez, yeni oran yeni satırdır. Faiz basit faizdir: anapara × yıllık oran × gün / 365; oran
 * değişen aralık gün gün bölünür. Gerçek dışı beyanla iptal edilen bursun geri istenmesinde
 * kullanılır (DOM-FIN-025, ON-283; K-266). Oranlar ve gün sayımı **doğrulanmalı** (H-32).
 */

export interface LegalInterestRate {
  /** Yürürlük günü (`YYYY-MM-DD`, dahil). */
  from: string
  /** Yıllık oran, on binde birlik (%9 → 900). */
  basisPoints: number
  /** Dayanak; belgede ve önizlemede gösterilir. */
  source: string
}

/**
 * Yürürlük sırasıyla. Kaynaklar Resmî Gazete'den alınmıştır; güncel oran ve karar sayıları
 * pilottan önce hukukçuyla doğrulanmalıdır (H-32):
 * - 1 Ocak 2006'dan itibaren yıllık %9: Bakanlar Kurulu Kararı 2005/9831.
 * - 1 Haziran 2024'ten itibaren yıllık %24: Cumhurbaşkanı Kararı 8484 (Resmî Gazete 25.05.2024).
 */
export const LEGAL_INTEREST_RATES: readonly LegalInterestRate[] = [
  { from: '2006-01-01', basisPoints: 900, source: 'BKK 2005/9831' },
  { from: '2024-06-01', basisPoints: 2_400, source: 'CBK 8484' },
]

/** Yıl 365 gün sayılır (artık yılda da); kanuni faiz uygulamasındaki yaygın sayım. */
export const LEGAL_INTEREST_DAYS_PER_YEAR = 365

export interface LegalInterestSegment {
  from: string
  /** Aralığın sonu (hariç). */
  to: string
  days: number
  basisPoints: number
  source: string
}

export interface LegalInterest {
  interestCents: number
  days: number
  segments: LegalInterestSegment[]
}

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS
const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from))
const later = (a: string, b: string) => (a > b ? a : b)
const earlier = (a: string, b: string) => (a < b ? a : b)

/**
 * `fromDay` (dahil) ile `toDay` (hariç) arasındaki kanuni faiz. Aralık boşsa ya da tersse faiz
 * sıfırdır. Kuruş aşağı yuvarlanır (borçlu lehine); ara toplam tam sayıyla tutulur, oran değişen
 * aralıkta her parça ayrıca yuvarlanmaz. Tablonun ilk gününden önceki gün oransızdır, reddedilir.
 */
export function legalInterest(
  principalCents: number,
  fromDay: string,
  toDay: string,
  rates: readonly LegalInterestRate[] = LEGAL_INTEREST_RATES,
): LegalInterest {
  if (!Number.isSafeInteger(principalCents) || principalCents < 0)
    throw new RangeError('principalCents must be a non-negative safe integer')
  if (principalCents === 0 || fromDay >= toDay) return { interestCents: 0, days: 0, segments: [] }
  const first = rates[0]
  if (first === undefined || fromDay < first.from)
    throw new DomainError(
      'legal_interest_rate_missing',
      'Bu tarih için kanuni faiz oranı tanımlı değil.',
    )
  const segments: LegalInterestSegment[] = []
  rates.forEach((rate, index) => {
    const next = rates[index + 1]
    const from = later(fromDay, rate.from)
    const to = next === undefined ? toDay : earlier(toDay, next.from)
    if (from >= to) return
    segments.push({
      from,
      to,
      days: daysBetween(from, to),
      basisPoints: rate.basisPoints,
      source: rate.source,
    })
  })
  // Anapara × oran × gün 2^53'ü aşabilir; ara toplam BigInt'tir.
  const weighted = segments.reduce(
    (total, segment) => total + BigInt(segment.days) * BigInt(segment.basisPoints),
    0n,
  )
  const interest =
    (BigInt(principalCents) * weighted) / (10_000n * BigInt(LEGAL_INTEREST_DAYS_PER_YEAR))
  return {
    interestCents: Number(interest),
    days: segments.reduce((total, segment) => total + segment.days, 0),
    segments,
  }
}
