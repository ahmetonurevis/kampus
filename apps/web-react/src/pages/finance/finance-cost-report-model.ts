// Öğrenci başı maliyet ve kampüs karşılaştırması ekranının gösterim modeli (ON-249, ON-250;
// DOM-FIN-065). Hesap sunucudadır; burada yalnız seçim varsayılanı ve gösterim metni üretilir.
import { COST_CENTER_TYPE_LABELS } from '@kampus/school-core/lib/finance-cost-centers.ts'
import {
  COST_ALLOCATION_KEY_LABELS,
  type CostAllocationKey,
} from '@kampus/school-core/lib/finance-cost-per-student.ts'
import { money, number } from '@kampus/school-core/lib/format.ts'
import type { CostCenterType } from '@kampus/school-core/lib/finance-cost-centers.ts'

import { percentLabel } from './finance-forecast-model.ts'

export const SUPPRESSED_LABEL = 'Küçük grup'
const DASH = '—'

/** Varsayılan dönem: ilk açık dönem, yoksa listenin ilki (yeni başlayan önce). */
export function defaultPeriodId(
  periods: readonly { id: string; status: string }[] | undefined,
): string | null {
  if (periods === undefined || periods.length === 0) return null
  return (periods.find((period) => period.status === 'open') ?? periods[0])?.id ?? null
}

/** Öğrenci başı tutar: küçük grupta "Küçük grup", öğrencisizse tire. */
export const perStudentLabel = (value: number | null, suppressed: boolean) =>
  suppressed ? SUPPRESSED_LABEL : value === null ? DASH : money(value)

export const shareLabel = (basisPoints: number | null) =>
  basisPoints === null ? DASH : percentLabel(basisPoints)

export const centerTypeLabel = (type: CostCenterType, shared: boolean) =>
  shared ? `${COST_CENTER_TYPE_LABELS[type]} · paylaştırıldı` : COST_CENTER_TYPE_LABELS[type]

export const studentCountLabel = (count: number | null) => (count === null ? DASH : number(count))

interface CostTotals {
  key: CostAllocationKey
  minGroupSize: number
  totals: { unallocatedCents: number; studentsWithoutCampus: number }
}

/** Öğrenci başı maliyet tablosunun altındaki açıklamalar. */
export function costNotes(report: CostTotals): string[] {
  return [
    `Ortak (birim) gider ${COST_ALLOCATION_KEY_LABELS[report.key].toLocaleLowerCase('tr-TR')} kapsamındaki öğrencili kampüs ve program merkezlerine paylaştırılır.`,
    'Öğrenci, dönemde kayıtlıysa sayılır; kampüs ve sınıf düzeyi güncel sınıftan, kur bağı dönemdeki gruptan okunur.',
    `${String(report.minGroupSize)} öğrenciden küçük grupta öğrenci başı değer gösterilmez.`,
    'Yalnız bütçe gider satırları girer; gerçekleşen gider kaydı yoktur.',
    ...(report.totals.unallocatedCents > 0
      ? [
          `${money(report.totals.unallocatedCents)} ortak gider öğrencili merkez olmadığı için paylaştırılamadı.`,
        ]
      : []),
    ...(report.totals.studentsWithoutCampus > 0
      ? [
          `${number(report.totals.studentsWithoutCampus)} öğrencinin sınıfı ya da sınıfının kampüsü yok; kampüs merkezlerine sayılmadı.`,
        ]
      : []),
  ]
}

/** Kampüs karşılaştırması açıklamaları. */
export function consolidationNotes(report: { minGroupSize: number }): string[] {
  return [
    'Tahakkuk vade gününde, tahsilat ödeme gününde, iptal ve iade kendi gününde sayılır; toplam muhasebe aktarımıyla aynıdır.',
    'Öğrencinin hareketi güncel sınıfının kampüsüne yazılır; kampüsü olmayan hareket ve kampüs merkezine bağlanmamış gider ayrı satırdadır.',
    'Bütçe gideri ortak giderden kampüse düşen payı da içerir.',
    `${String(report.minGroupSize)} öğrenciden küçük grupta öğrenci başı değer gösterilmez.`,
  ]
}
