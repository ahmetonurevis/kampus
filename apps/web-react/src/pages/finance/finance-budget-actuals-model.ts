// Bütçe–gerçekleşen görünümünün satır ve açıklama modeli (ON-244; DOM-FIN-066). Hesap sunucudadır;
// burada yalnız seçilen ayın ya da dönemin değerleri ve gösterim metni üretilir.
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { BUDGET_ITEM_KIND_LABELS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  actualCenterLabel,
  BUDGET_ACTUAL_BASIS_LABELS,
  BUDGET_ACTUAL_STATUS_LABELS,
  unmatchedLabel,
  type BudgetActuals,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { percentLabel } from './finance-forecast-model.ts'

/** Görünüm seçimi: dönem toplamı ya da bir takvim ayı (`YYYY-MM`). */
export const PERIOD_TOTAL = 'donem'

export type ActualsTableRow = {
  key: string
  item: string
  kind: string
  center: string
  planned: string
  actual: string
  variance: string
  realization: string
  /** Gerçekleşen hesaplanmadıysa nedeni ("Gerçekleşen verisi yok" …); hesaplandıysa boş. */
  note: string
}

const dash = '—'
const amount = (cents: number | null) => (cents === null ? dash : money(cents))
const rate = (points: number | null) => (points === null ? dash : percentLabel(points))

/** Seçilen ayın ya da dönemin satırları; dönem görünümünde plan tam dönem planıdır. */
export function actualsTableRows(
  report: Pick<BudgetActuals, 'rows' | 'unmatched'>,
  view: string,
): ActualsTableRow[] {
  const rows = report.rows.map((row): ActualsTableRow => {
    const month = view === PERIOD_TOTAL ? null : row.months.find((item) => item.month === view)
    const values = month ?? {
      plannedCents: row.plannedCents,
      actualCents: row.actualCents,
      varianceCents: row.varianceCents,
      realizationBasisPoints: row.realizationBasisPoints,
    }
    return {
      key: row.key,
      item: `${row.itemCode} · ${row.itemName}`,
      kind: BUDGET_ITEM_KIND_LABELS[row.itemKind],
      center: actualCenterLabel(row),
      planned: values.plannedCents === null ? 'Dağılım yok' : money(values.plannedCents),
      actual: amount(values.actualCents),
      variance: amount(values.varianceCents),
      realization: rate(values.realizationBasisPoints),
      note: row.status === 'mapped' ? '' : BUDGET_ACTUAL_STATUS_LABELS[row.status],
    }
  })
  const unmatched = report.unmatched.map((entry): ActualsTableRow => {
    const actual =
      view === PERIOD_TOTAL
        ? entry.actualCents
        : (entry.months.find((item) => item.month === view)?.actualCents ?? null)
    return {
      key: `unmatched:${entry.feeKind ?? 'none'}`,
      item: unmatchedLabel(entry.feeKind),
      kind: BUDGET_ITEM_KIND_LABELS.income,
      center: dash,
      planned: dash,
      actual: amount(actual),
      variance: dash,
      realization: dash,
      note: 'Eşlenmemiş gelir',
    }
  })
  return [...rows, ...unmatched]
}

const dayText = (day: string) => dateLabel(`${day}T12:00:00.000Z`, { year: 'numeric' })

/** Raporun varsayım açıklamaları (DOM-FIN-066). */
export function actualsNotes(
  report: Pick<
    BudgetActuals,
    'basis' | 'asOfDate' | 'expenseData' | 'openingImportCents' | 'unmatched'
  >,
): string[] {
  const notes = [
    report.basis === 'accrual'
      ? `${BUDGET_ACTUAL_BASIS_LABELS.accrual}: taksit vade gününde sayılır; ayrılışta hak edilmeyen tutar ayrılış gününde düşülür.`
      : `${BUDGET_ACTUAL_BASIS_LABELS.cash}: tahsilat ödeme gününde sayılır; iptal edilen tahsilat ve ödenen iade kendi gününde düşülür.`,
    report.asOfDate === null
      ? 'Dönem henüz başlamadı; gerçekleşen yok.'
      : `Gerçekleşen ${dayText(report.asOfDate)} gününe kadardır; gelmemiş aylar boştur.`,
    'Gerçekleşen, öğrencinin kampüs ve program bağına uyan merkeze, o kalem için satırı olan en yakın üst merkeze yazılır; uyan merkez yoksa "Dağıtılmamış" satırındadır.',
  ]
  if (report.expenseData === 'none')
    notes.push(
      'Gider gerçekleşeni yok: satın alma ve gider kaydı modülü kurulunca gider satırları doldurulacak.',
    )
  if (report.unmatched.some((entry) => entry.feeKind !== null))
    notes.push(
      `Kaleme eşlenmemiş ücret türleri: ${report.unmatched
        .flatMap((entry) => (entry.feeKind === null ? [] : [FEE_ITEM_KIND_LABELS[entry.feeKind]]))
        .join(', ')}. Bütçe kaleminde ücret türünü seçerek eşleyin.`,
    )
  if (report.openingImportCents !== 0)
    notes.push(
      `Dosyadan aktarılan geçmiş ödeme ${money(report.openingImportCents)} tahsilata dahildir.`,
    )
  return notes
}
